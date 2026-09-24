import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createCreditCheckout } from "../src/billing/stripe-checkout.js";
import { processStripeWebhook } from "../src/billing/stripe-webhook.js";
import { createCreationPlan } from "../src/creation/planner.js";
import { createJobWorker } from "../src/worker.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";

// These are local contract checks using signed synthetic Stripe events. They
// are not hosted Checkout, card-network, bank-refund or sandbox acceptance.
async function fixture(t) {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "billing-acceptance@example.test", passwordHash: "unused", emailVerified: true });
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "billing-acceptance-fixture", IABT_PUBLIC_ORIGIN: "https://staging.example.test",
    IABT_STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_BUILDER_PRICE_ID: "price_builder", STRIPE_PRO_PRICE_ID: "price_pro", STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_pack" });
  const directory = await mkdtemp(join(tmpdir(), "iabt-billing-acceptance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new LocalObjectStorage({ rootDirectory: directory, apiOrigin: "http://127.0.0.1", signingSecret: config.authSecret });
  await storage.ready();
  const now = Math.floor(Date.now() / 1000);
  const metadata = { iabt_app_id: config.providers.stripe.metadataAppId, user_id: user.id, user_email: user.email };
  const subscription = { id: "sub_acceptance", customer: "cus_acceptance", status: "active", livemode: false, metadata,
    cancel_at_period_end: false, current_period_end: now + 30 * 86400, items: { data: [{ price: { id: "price_pro" } }] } };
  const invoice = { id: "in_acceptance", customer: subscription.customer, status: "paid", billing_reason: "subscription_cycle",
    parent: { subscription_details: { subscription: subscription.id, metadata } },
    lines: { has_more: false, data: [{ type: "subscription", price: { id: "price_pro" }, amount: 7900, quantity: 1,
      period: { start: now, end: now + 30 * 86400 } }] } };
  const calls = [];
  const providers = {
    readiness: () => ({ stripe: { configured: true, checkout_ready: true, mode: "test" } }),
    execute: async (provider, operation, payload) => {
      assert.equal(provider, "stripe"); assert.equal(operation, "post"); assert.equal(payload.path, "/checkout/sessions");
      calls.push(payload);
      return { data: { id: "cs_test_acceptance", url: "https://checkout.example.test/synthetic-session" } };
    }
  };
  const deliver = (id, type, object) => {
    const rawBody = JSON.stringify({ id, type, livemode: false, created: now, data: { object } });
    const signature = createHmac("sha256", config.providers.stripe.webhookSecret).update(now + "." + rawBody).digest("hex");
    return processStripeWebhook({ repository, config, rawBody, signatureHeader: `t=${now},v1=${signature}`, nowSeconds: now,
      fetchImpl: async () => ({ ok: true, json: async () => structuredClone(subscription) }) });
  };
  const entitlement = async () => (await repository.listRecordsExact("AccountEntitlement", user, { limit: 1 }))[0];
  return { repository, user, config, storage, metadata, subscription, invoice, providers, calls, deliver, entitlement };
}

test("local billing contract: a signed purchase funds verified private delivery and failed delivery restores only IABT credits", async (t) => {
  const f = await fixture(t);
  const checkout = await createCreditCheckout({ ...f, idempotencyKey: "acceptance-checkout" });
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0, "Creating Checkout must not grant credits");
  const params = f.calls[0].params;
  const metadata = Object.fromEntries(Object.entries(params).filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
  const session = { id: checkout.session_id, mode: "payment", payment_status: "paid", metadata };
  assert.equal((await f.deliver("evt_acceptance_purchase", "checkout.session.completed", session)).credits_granted, 100);
  const planned = await createCreationPlan({ ...f, automatic: true, submissionId: "acceptance-document", requestText: "Create a document describing the purchased-credit delivery check." });
  assert.equal(planned.job.status, "queued");
  const worker = createJobWorker({ ...f, workerId: "billing-acceptance-worker" });
  t.after(() => worker.stop());
  await worker.runOnce();
  const job = await f.repository.getJob(planned.job.id, f.user);
  assert.equal(job.status, "succeeded");
  assert.equal(job.output.verified, true);
  const completedBalance = await f.repository.getCreditAccount(f.user.id);
  assert.equal(completedBalance.available_credits, 100 - job.credit_amount);
  assert.equal(completedBalance.reserved_credits, 0);
  const [entry] = job.output.artifact_manifest;
  const object = await f.repository.getStoredObject(entry.id, f.user);
  assert.equal((await f.storage.read(object.storage_key)).length, entry.size_bytes);
  await f.deliver("evt_acceptance_purchase_replay", "checkout.session.async_payment_succeeded", session);
  assert.deepEqual(await f.repository.getCreditAccount(f.user.id), completedBalance);

  const queued = await f.repository.enqueueJob({ ownerId: f.user.id, jobType: "artifact.echo", input: { content: "A delivery failure" }, idempotencyKey: "acceptance-storage-failure", creditAmount: 1 });
  const failingWorker = createJobWorker({ ...f, storage: { kind: "test", put: async () => { throw new Error("Simulated permanent storage failure"); } }, workerId: "billing-failure-worker" });
  t.after(() => failingWorker.stop());
  await failingWorker.runOnce();
  const failed = await f.repository.getJob(queued.id, f.user);
  assert.equal(failed.status, "failed");
  assert.equal(failed.output.released_credits, 1);
  const restored = await f.repository.getCreditAccount(f.user.id);
  assert.equal(restored.available_credits, completedBalance.available_credits);
  assert.equal(restored.reserved_credits, 0);
  assert.equal(f.calls.length, 1, "Internal credit restoration never calls Stripe refunds");
  assert.equal(f.repository.creditEntries.filter((item) => item.job_id === queued.id && item.entry_type === "release").length, 1);
});

test("local billing contract: declined renewal grants nothing, grace follows verified subscription state, and recovery grants once", async (t) => {
  const f = await fixture(t);
  await f.deliver("evt_initial_subscription", "customer.subscription.created", f.subscription);
  await f.deliver("evt_initial_invoice", "invoice.paid", f.invoice);
  const opening = await f.repository.getCreditAccount(f.user.id);
  const next = structuredClone(f.invoice);
  next.id = "in_declined_cycle";
  next.lines.data[0].period.start += 30 * 86400;
  next.lines.data[0].period.end += 30 * 86400;
  const declined = await f.deliver("evt_declined_cycle", "invoice.payment_failed", { ...next, status: "open" });
  assert.equal(declined.action, "ignored", "Failure events alone are not an entitlement reconciliation path");
  assert.deepEqual(await f.repository.getCreditAccount(f.user.id), opening);
  for (const [status, plan] of [["past_due", "pro"], ["unpaid", "free"], ["active", "pro"]]) {
    f.subscription.status = status;
    await f.deliver("evt_subscription_" + status, "customer.subscription.updated", f.subscription);
    assert.equal((await f.entitlement()).plan, plan);
    assert.deepEqual(await f.repository.getCreditAccount(f.user.id), opening);
  }
  assert.equal((await f.deliver("evt_recovered_cycle", "invoice.paid", next)).credits_granted, 500);
  assert.equal((await f.deliver("evt_recovered_cycle_again", "invoice.paid", next)).credits_granted, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 1000);
});

test("local billing contract: period-end cancellation preserves paid access until canceled and never refunds purchased credits", async (t) => {
  const f = await fixture(t);
  await f.deliver("evt_start", "customer.subscription.created", f.subscription);
  await f.deliver("evt_fund", "invoice.paid", f.invoice);
  f.subscription.cancel_at_period_end = true;
  await f.deliver("evt_cancel_scheduled", "customer.subscription.updated", f.subscription);
  assert.equal((await f.entitlement()).plan, "pro");
  assert.equal((await f.entitlement()).cancel_at_period_end, true);
  const before = await f.repository.getCreditAccount(f.user.id);
  f.subscription.status = "canceled";
  await f.deliver("evt_cancel_effective", "customer.subscription.deleted", f.subscription);
  assert.equal((await f.entitlement()).plan, "free");
  assert.deepEqual(await f.repository.getCreditAccount(f.user.id), before);
  assert.equal(f.repository.creditEntries.filter((item) => item.entry_type !== "grant").length, 0);
});

test("known unsupported behavior: refund events are acknowledged but do not reconcile cash refunds or credit clawback", async (t) => {
  const f = await fixture(t);
  await f.deliver("evt_refund_subscription", "customer.subscription.created", f.subscription);
  await f.deliver("evt_refund_funding", "invoice.paid", f.invoice);
  const before = await f.repository.getCreditAccount(f.user.id);
  const entitlement = await f.entitlement();
  const billingEvents = await f.repository.listRecordsExact("BillingEvent", f.user);
  const receipt = await f.repository.listRecordsExact("BillingFulfillment", f.user);
  for (const [index, type] of ["refund.created", "refund.updated", "refund.failed", "charge.refunded"].entries()) {
    const result = await f.deliver("evt_refund_unhandled_" + index, type, { id: "re_synthetic", payment_intent: "pi_synthetic", charge: "ch_synthetic", status: ["pending", "succeeded", "failed", "succeeded"][index], amount: index ? 7900 : 3950, currency: "usd", metadata: f.metadata });
    assert.equal(result.action, "ignored");
    assert.equal(result.credits_granted, 0);
    assert.equal(f.repository.stripeEvents.get("evt_refund_unhandled_" + index).status, "succeeded", "Transport success is not refund reconciliation");
  }
  assert.deepEqual(await f.repository.getCreditAccount(f.user.id), before);
  assert.deepEqual(await f.entitlement(), entitlement);
  assert.deepEqual(await f.repository.listRecordsExact("BillingEvent", f.user), billingEvents);
  assert.deepEqual(await f.repository.listRecordsExact("BillingFulfillment", f.user), receipt);
});
