import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import {
  processStripeWebhook,
  verifyStripeEvent
} from "../src/billing/stripe-webhook.js";

const webhookSecret = "whsec_standalone_test_secret";
const nowSeconds = 1788523200;
const sign = (rawBody, timestamp = nowSeconds) => {
  const signature = createHmac("sha256", webhookSecret)
    .update(timestamp + "." + rawBody)
    .digest("hex");
  return "t=" + timestamp + ",v1=" + signature;
};

const config = () =>
  loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "stripe-test-auth-secret",
    IABT_STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_configured",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_BUILDER_PRICE_ID: "price_builder",
    STRIPE_PRO_PRICE_ID: "price_pro",
    STRIPE_AGENCY_PRICE_ID: "price_agency",
    STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_credit_pack",
    IABT_CREDIT_PACK_SIZE: "100"
  });

test("Stripe webhook signature rejects tampering before any billing mutation", () => {
  const rawBody = JSON.stringify({ id: "evt_tampered", livemode: false });
  assert.throws(
    () =>
      verifyStripeEvent({
        rawBody,
        signatureHeader: sign(rawBody + "tampered"),
        webhookSecret,
        nowSeconds
      }),
    (error) => error.code === "stripe_signature_invalid"
  );
});

test("verified credit-pack events grant once and replay safely", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({
    email: "stripe-credit@example.com",
    passwordHash: "unused",
    emailVerified: true
  });
  const event = {
    id: "evt_credit_pack_1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_credit_1",
        mode: "payment",
        client_reference_id: user.id,
        payment_status: "paid",
        customer_details: { email: user.email },
        metadata: {
          base44_app_id: "6a849bcd3e04d068553b4af7",
          product_type: "ai_credit_pack",
          credits: "100",
          user_id: user.id,
          user_email: user.email
        }
      }
    }
  };
  const rawBody = JSON.stringify(event);
  const first = await processStripeWebhook({
    rawBody,
    signatureHeader: sign(rawBody),
    repository,
    config: config(),
    nowSeconds
  });
  assert.equal(first.action, "credit_pack_granted");
  assert.equal(first.credits_granted, 100);
  const replay = await processStripeWebhook({
    rawBody,
    signatureHeader: sign(rawBody),
    repository,
    config: config(),
    nowSeconds
  });
  assert.equal(replay.reused, true);
  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 100);
  assert.equal(
    repository.creditEntries.filter((entry) => entry.entry_type === "grant").length,
    1
  );
  const billingEvents = await repository.listRecords("BillingEvent", user, {
    query: { event_id: event.id }
  });
  assert.equal(billingEvents.length, 1);
  assert.equal(repository.stripeEvents.get(event.id).status, "succeeded");
});

test("verified subscription events map configured prices to server-owned entitlements", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({
    email: "stripe-pro@example.com",
    passwordHash: "unused",
    emailVerified: true
  });
  const event = {
    id: "evt_subscription_1",
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: "sub_test_1",
        customer: "cus_test_1",
        status: "active",
        cancel_at_period_end: false,
        current_period_end: 1791201600,
        metadata: {
          base44_app_id: "6a849bcd3e04d068553b4af7",
          user_id: user.id,
          user_email: user.email
        },
        items: { data: [{ price: { id: "price_pro" } }] }
      }
    }
  };
  const rawBody = JSON.stringify(event);
  const result = await processStripeWebhook({
    rawBody,
    signatureHeader: sign(rawBody),
    repository,
    config: config(),
    nowSeconds,
    fetchImpl: async () => ({ ok: true, json: async () => event.data.object })
  });
  assert.equal(result.action, "subscription_entitlement_updated");

  const entitlements = await repository.listRecords("AccountEntitlement", user, {
    query: { user_id: user.id }
  });
  assert.equal(entitlements.length, 1);
  assert.equal(entitlements[0].plan, "pro");
  assert.equal(entitlements[0].status, "active");
  assert.equal(entitlements[0].react_export_enabled, true);
  assert.equal(entitlements[0].commercial_use_enabled, true);
  assert.equal(entitlements[0].provider_subscription_id, "sub_test_1");
});

const makeFixture = async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "billing@example.test", passwordHash: "unused", emailVerified: true });
  const metadata = { iabt_app_id: config().providers.stripe.metadataAppId, user_id: user.id, user_email: user.email };
  const subscription = { id: "sub_cycle", customer: "cus_cycle", status: "active", livemode: false, metadata,
    current_period_end: nowSeconds + 30 * 86400, items: { data: [{ price: { id: "price_pro" } }] } };
  const session = { id: "cs_test_cycle", mode: "payment", payment_status: "paid", metadata: { ...metadata, product_type: "ai_credit_pack", credits: "100" } };
  const invoice = { id: "in_cycle", customer: "cus_cycle", status: "paid", billing_reason: "subscription_cycle",
    parent: { type: "subscription_details", subscription_details: { subscription: subscription.id, metadata } },
    lines: { has_more: false, data: [{ amount: 7900, quantity: 1,
      parent: { type: "subscription_item_details", subscription_item_details: { proration: false, subscription: subscription.id } },
      pricing: { price_details: { price: "price_pro" } }, period: { start: nowSeconds, end: nowSeconds + 30 * 86400 }
    }] }
  };
  const deliver = (id, type, object, options = {}) => {
    const rawBody = JSON.stringify({ id, type, livemode: false, created: nowSeconds, data: { object } });
    return processStripeWebhook({ rawBody, signatureHeader: sign(rawBody), repository, config: config(), nowSeconds,
      fetchImpl: async () => ({ ok: true, json: async () => structuredClone(subscription) }), ...options });
  };
  return { repository, user, metadata, subscription, session, invoice, deliver };
};

test("current Stripe item-boundary cancellation is projected without changing access or credits, and resumption clears it", async () => {
  const f = await makeFixture();
  const end = 1792523684;
  delete f.subscription.current_period_end;
  f.subscription.items.data[0].current_period_end = end;
  f.subscription.cancel_at_period_end = false;
  f.subscription.cancel_at = end;
  await f.deliver("evt_schedule_funding", "checkout.session.completed", f.session);
  await f.deliver("evt_schedule_current", "customer.subscription.updated", f.subscription);
  const read = async () => (await f.repository.listRecords("AccountEntitlement", f.user))[0];
  let entitlement = await read();
  assert.equal(entitlement.plan, "pro");
  assert.equal(entitlement.status, "active");
  assert.equal(entitlement.cancel_at, new Date(end * 1000).toISOString());
  assert.equal(entitlement.current_period_end, entitlement.cancel_at);
  assert.equal(entitlement.cancellation_scheduled, true);
  assert.equal(entitlement.cancel_at_period_end, true);
  assert.equal(entitlement.provider_cancel_at_period_end, false);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 100);

  // A stale event carries a schedule, but the current provider object is resumed.
  const scheduledSnapshot = structuredClone(f.subscription);
  f.subscription.cancel_at = null;
  await f.deliver("evt_schedule_resumed", "customer.subscription.updated", scheduledSnapshot);
  entitlement = await read();
  assert.equal(entitlement.plan, "pro");
  assert.equal(entitlement.cancel_at, null);
  assert.equal(entitlement.cancellation_scheduled, false);
  assert.equal(entitlement.cancel_at_period_end, false);

  // Effective cancellation changes access only after Stripe reports canceled.
  f.subscription.cancel_at = end;
  f.subscription.status = "canceled";
  await f.deliver("evt_schedule_effective", "customer.subscription.deleted", f.subscription);
  entitlement = await read();
  assert.equal(entitlement.plan, "free");
  assert.equal(entitlement.cancellation_scheduled, false);
  assert.equal(entitlement.cancel_at_period_end, false);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 100);
  assert.equal(f.repository.creditEntries.length, 1);
});

test("custom and legacy cancellation schedules retain their meaning and malformed timestamps do not schedule cancellation", async () => {
  const f = await makeFixture();
  const end = f.subscription.current_period_end;
  const cases = [
    { name: "custom", cancel_at: end - 86400, cancel_at_period_end: false, scheduled: true, atEnd: false },
    { name: "legacy", cancel_at: null, cancel_at_period_end: true, scheduled: true, atEnd: true },
    { name: "zero", cancel_at: 0, cancel_at_period_end: false, scheduled: false, atEnd: false },
    { name: "negative", cancel_at: -1, cancel_at_period_end: false, scheduled: false, atEnd: false },
    { name: "invalid", cancel_at: "invalid", cancel_at_period_end: false, scheduled: false, atEnd: false },
    { name: "overflow", cancel_at: Number.MAX_SAFE_INTEGER, cancel_at_period_end: false, scheduled: false, atEnd: false }
  ];
  for (const example of cases) {
    f.subscription.cancel_at = example.cancel_at;
    f.subscription.cancel_at_period_end = example.cancel_at_period_end;
    await f.deliver("evt_schedule_" + example.name, "customer.subscription.updated", f.subscription);
    const entitlement = (await f.repository.listRecords("AccountEntitlement", f.user))[0];
    assert.equal(entitlement.cancellation_scheduled, example.scheduled, example.name);
    assert.equal(entitlement.cancel_at_period_end, example.atEnd, example.name);
    assert.equal(entitlement.provider_cancel_at_period_end, example.cancel_at_period_end, example.name);
    assert.equal(entitlement.cancel_at, example.name === "custom" ? new Date(example.cancel_at * 1000).toISOString() : null, example.name);
    assert.equal(entitlement.plan, "pro", example.name);
  }
  assert.equal(f.repository.creditEntries.length, 0);
});

test("different event IDs and delayed-success events fulfill one Checkout session only once", async () => {
  const f = await makeFixture();
  const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => f.deliver(`evt_pack_${i}`,
    i % 2 ? "checkout.session.completed" : "checkout.session.async_payment_succeeded", f.session)));
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 100);
  assert.equal(outcomes.reduce((sum, result) => sum + result.credits_granted, 0), 100);
  assert.equal(f.repository.creditEntries.length, 1);
});

test("unpaid checkout is acknowledged pending; later success grants the purchased quantity despite config changes", async () => {
  const f = await makeFixture();
  f.session.metadata.credits = "75";
  const pending = await f.deliver("evt_pending", "checkout.session.completed", { ...f.session, payment_status: "unpaid" });
  assert.equal(pending.action, "credit_pack_payment_pending");
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0);
  const result = await f.deliver("evt_paid", "checkout.session.async_payment_succeeded", f.session);
  assert.equal(result.credits_granted, 75);
});

test("credit fulfillment resumes safely after ledger grant succeeds and receipt completion fails", async () => {
  const f = await makeFixture();
  const original = f.repository.grantCredits.bind(f.repository);
  let failOnce = true;
  f.repository.grantCredits = async (input) => {
    const result = await original(input);
    if (failOnce) { failOnce = false; throw new Error("simulated process interruption after commit"); }
    return result;
  };
  await assert.rejects(f.deliver("evt_retry", "checkout.session.completed", f.session));
  const retried = await f.deliver("evt_retry", "checkout.session.completed", f.session);
  assert.equal(retried.credits_granted, 100);
  assert.equal(f.repository.creditEntries.length, 1);
  assert.equal((await f.repository.listRecords("BillingFulfillment", f.user))[0].status, "granted");
});

test("credit packs reject missing or tampered quantities and cannot reassign an already fulfilled purchase", async () => {
  const f = await makeFixture();
  for (const [i, credits] of [undefined, "0", "-1", "1.2", "NaN", "1000001"].entries()) {
    await assert.rejects(f.deliver(`evt_bad_${i}`, "checkout.session.completed", { ...f.session, metadata: { ...f.session.metadata, credits } }), { code: "stripe_credit_quantity_invalid" });
  }
  await f.deliver("evt_original", "checkout.session.completed", f.session);
  const other = await f.repository.createUser({ email: "other@example.test", passwordHash: "unused", emailVerified: true });
  await assert.rejects(f.deliver("evt_foreign", "checkout.session.completed", { ...f.session,
    metadata: { ...f.session.metadata, user_id: other.id, user_email: other.email } }), { code: "record_conflict" });
  assert.equal((await f.repository.getCreditAccount(other.id)).available_credits, 0);
});

test("paid monthly invoices grant one allowance per subscription period, preserve prior credits and renew", async () => {
  const f = await makeFixture();
  await f.repository.grantCredits({ ownerId: f.user.id, amount: 25, idempotencyKey: "prior_purchase" });
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, i) => f.deliver(`evt_invoice_${i}`, "invoice.paid", { ...f.invoice, id: `in_retry_${i}` })));
  assert.equal(outcomes.reduce((sum, result) => sum + result.credits_granted, 0), 500);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 525);
  const next = structuredClone(f.invoice);
  next.id = "in_next";
  next.lines.data[0].period.start += 30 * 86400;
  next.lines.data[0].period.end += 30 * 86400;
  await f.deliver("evt_next", "invoice.paid", next);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 1025);
  assert.equal((await f.repository.listRecords("AccountEntitlement", f.user)).length, 0, "invoice arrival need not wait for subscription event");
});

test("pre-Basil invoice fields grant configured plan credits, not caller metadata credits", async () => {
  const f = await makeFixture();
  const legacy = { ...f.invoice, parent: undefined, subscription: "sub_cycle", subscription_details: { metadata: { ...f.metadata, credits: "99999" } },
    lines: { data: [{ type: "subscription", price: { id: "price_builder" }, proration: false, amount: 2900, quantity: 1, period: f.invoice.lines.data[0].period }] } };
  assert.equal((await f.deliver("evt_legacy", "invoice.paid", legacy)).credits_granted, 100);
});

test("trials, unpaid invoices and mid-cycle proration bills do not refill allowances", async () => {
  const f = await makeFixture();
  const trial = structuredClone(f.invoice);
  trial.lines.data[0].amount = 0;
  for (const [i, invoice] of [trial, { ...f.invoice, status: "open" }, { ...f.invoice, billing_reason: "subscription_update" }].entries()) {
    assert.equal((await f.deliver(`evt_no_refill_${i}`, "invoice.paid", invoice)).credits_granted, 0);
  }
  await f.deliver("evt_active", "customer.subscription.created", f.subscription);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0, "active status alone never funds provider work");
});

test("ambiguous, unmapped, truncated and non-monthly paid invoices require reconciliation", async () => {
  const f = await makeFixture();
  const variants = [
    (v) => { v.lines.has_more = true; },
    (v) => { v.lines.data.push(structuredClone(v.lines.data[0])); },
    (v) => { v.lines.data[0].pricing.price_details.price = "price_unknown"; },
    (v) => { v.lines.data[0].quantity = 2; },
    (v) => { v.lines.data[0].period.end += 365 * 86400; },
    (v) => { v.lines.data[0].parent.subscription_item_details.subscription = "sub_other"; }
  ];
  for (const [i, mutate] of variants.entries()) {
    const invoice = structuredClone(f.invoice); mutate(invoice);
    await assert.rejects(f.deliver(`evt_invalid_invoice_${i}`, "invoice.paid", invoice), (error) => error.status === 422);
  }
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0);
});

test("stale subscription snapshots reconcile current provider status, including same-timestamp updates", async () => {
  const f = await makeFixture();
  await f.deliver("evt_active_state", "customer.subscription.created", f.subscription);
  const stale = structuredClone(f.subscription);
  f.subscription.status = "canceled";
  await f.deliver("evt_old_update", "customer.subscription.updated", stale);
  const [entitlement] = await f.repository.listRecords("AccountEntitlement", f.user);
  assert.equal(entitlement.plan, "free");
  assert.equal(entitlement.status, "canceled");
  assert.equal(entitlement.provider_subscription_id, "sub_cycle");
});

test("failed subscription verification preserves the paid account and can be retried", async () => {
  const f = await makeFixture();
  await f.deliver("evt_current", "customer.subscription.created", f.subscription);
  const canceled = { ...f.subscription, status: "canceled" };
  await assert.rejects(f.deliver("evt_fetch_retry", "customer.subscription.deleted", canceled, {
    fetchImpl: async () => { throw new Error("network error containing a secret"); }
  }), (error) => error.code === "stripe_subscription_unavailable" && !error.message.includes("secret"));
  assert.equal((await f.repository.listRecords("AccountEntitlement", f.user))[0].plan, "pro");
  f.subscription.status = "canceled";
  await f.deliver("evt_fetch_retry", "customer.subscription.deleted", canceled);
  assert.equal((await f.repository.listRecords("AccountEntitlement", f.user))[0].plan, "free");
});

test("a slower old subscription retrieval cannot overwrite a newer reconciliation", async () => {
  const f = await makeFixture();
  let release, fetched;
  const fetching = new Promise((resolve) => { fetched = resolve; });
  const stale = structuredClone(f.subscription);
  const older = f.deliver("evt_slow", "customer.subscription.created", stale, {
    fetchImpl: async () => { fetched(); await new Promise((resolve) => { release = resolve; }); return { ok: true, json: async () => stale }; }
  });
  await fetching;
  f.subscription.status = "canceled";
  await f.deliver("evt_new", "customer.subscription.deleted", f.subscription);
  release();
  assert.equal((await older).action, "subscription_sync_superseded");
  assert.equal((await f.repository.listRecords("AccountEntitlement", f.user))[0].status, "canceled");
});

test("old subscription cancellation cannot revoke a newer subscription and customer mismatch cannot grant credits", async () => {
  const f = await makeFixture();
  await f.deliver("evt_first", "customer.subscription.created", f.subscription);
  const canceledOld = { ...f.subscription, id: "sub_old", status: "canceled" };
  assert.equal((await f.deliver("evt_old_canceled", "customer.subscription.deleted", canceledOld, {
    fetchImpl: async () => ({ ok: true, json: async () => canceledOld })
  })).action, "ignored_other_subscription");
  assert.equal((await f.repository.listRecords("AccountEntitlement", f.user))[0].plan, "pro");
  await assert.rejects(f.deliver("evt_bad_customer", "invoice.paid", { ...f.invoice, customer: "cus_other" }), { code: "stripe_customer_mismatch" });
});

test("an old subscription refresh cannot suppress a different new subscription being reconciled concurrently", async () => {
  const f = await makeFixture();
  const old = { ...f.subscription, id: "sub_old", status: "canceled" };
  const oldFetch = async () => ({ ok: true, json: async () => old });
  await f.deliver("evt_old_seed", "customer.subscription.deleted", old, { fetchImpl: oldFetch });
  let release, fetched;
  const fetching = new Promise((resolve) => { fetched = resolve; });
  const newer = f.deliver("evt_new_pending", "customer.subscription.created", f.subscription, {
    fetchImpl: async () => { fetched(); await new Promise((resolve) => { release = resolve; }); return { ok: true, json: async () => f.subscription }; }
  });
  await fetching;
  await f.deliver("evt_old_again", "customer.subscription.updated", old, { fetchImpl: oldFetch });
  release();
  assert.equal((await newer).action, "subscription_entitlement_updated");
  assert.equal((await f.repository.listRecords("AccountEntitlement", f.user))[0].provider_subscription_id, "sub_cycle");
});

test("subscription reconciliation is read-only, bounded and fails closed on provider identity or mode mismatch", async () => {
  const f = await makeFixture();
  for (const [index, providerObject] of [{ ...f.subscription, id: "sub_wrong" }, { ...f.subscription, livemode: true }].entries()) {
    await assert.rejects(f.deliver(`evt_wrong_provider_${index}`, "customer.subscription.updated", f.subscription, {
      fetchImpl: async (url, request) => {
        assert.equal(url, "https://api.stripe.com/v1/subscriptions/sub_cycle");
        assert.equal(request.method, "GET");
        assert.equal(request.redirect, "error");
        assert.equal(request.headers["Stripe-Version"], "2026-08-26.dahlia");
        assert.ok(request.signal);
        return { ok: true, json: async () => providerObject };
      }
    }), { code: "stripe_subscription_unavailable" });
  }
  assert.equal((await f.repository.listRecords("AccountEntitlement", f.user)).length, 0);
});

test("a different event for a previously fulfilled legacy Checkout session adopts its grant without funding it twice", async () => {
  const f = await makeFixture();
  await f.repository.grantCredits({ ownerId: f.user.id, amount: 100, idempotencyKey: "stripe:evt_pre_upgrade",
    metadata: { event_id: "evt_pre_upgrade", checkout_session_id: f.session.id, product_type: "ai_credit_pack" } });
  await f.repository.startStripeEvent({ eventId: "evt_pre_upgrade", eventType: "checkout.session.completed", livemode: false, payloadSha256: "fixture" });
  await f.repository.finishStripeEvent("evt_pre_upgrade");
  assert.equal((await f.deliver("evt_pre_upgrade", "checkout.session.completed", f.session)).reused, true);
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    f.deliver(`evt_post_upgrade_${i}`, "checkout.session.async_payment_succeeded", f.session)));
  assert.ok(outcomes.every((outcome) => outcome.credits_granted === 0));
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 100);
  assert.equal(f.repository.creditEntries.length, 1);
  const [receipt] = await f.repository.listRecords("BillingFulfillment", f.user);
  assert.equal(receipt.status, "granted");
  assert.equal(receipt.legacy_grant_id, f.repository.creditEntries[0].id);
  assert.equal(receipt.legacy_event_id, "evt_pre_upgrade");
});

test("legacy session conflicts fail closed for duplicate grants, changed amounts, foreign owners or malformed provenance", async () => {
  for (const variant of ["duplicate", "amount", "owner", "provenance"]) {
    const f = await makeFixture();
    const other = await f.repository.createUser({ email: "old-owner@example.test", passwordHash: "unused", emailVerified: true });
    const metadata = { event_id: "evt_legacy", checkout_session_id: f.session.id, product_type: "ai_credit_pack" };
    if (variant === "provenance") metadata.event_id = "evt_wrong";
    await f.repository.grantCredits({ ownerId: variant === "owner" ? other.id : f.user.id,
      amount: variant === "amount" ? 75 : 100, idempotencyKey: "stripe:evt_legacy", metadata });
    if (variant === "duplicate") await f.repository.grantCredits({ ownerId: f.user.id, amount: 100,
      idempotencyKey: "stripe:evt_old_second", metadata: { ...metadata, event_id: "evt_old_second" } });
    const before = await f.repository.getCreditAccount(f.user.id);
    await assert.rejects(f.deliver("evt_after_upgrade", "checkout.session.completed", f.session), { code: "billing_legacy_fulfillment_conflict" });
    assert.deepEqual(await f.repository.getCreditAccount(f.user.id), before);
    assert.equal((await f.repository.listRecords("BillingFulfillment", f.user)).length, 0);
  }
});

test("legacy lookup matches only the exact Checkout session and remains required for new pack fulfillment", async () => {
  const f = await makeFixture();
  await f.repository.grantCredits({ ownerId: f.user.id, amount: 50, idempotencyKey: "stripe:evt_unrelated",
    metadata: { event_id: "evt_unrelated", checkout_session_id: f.session.id + "_other", product_type: "ai_credit_pack" } });
  assert.equal((await f.deliver("evt_current_session", "checkout.session.completed", f.session)).credits_granted, 100);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 150);
  f.repository.findLegacyStripeCreditGrants = undefined;
  await assert.rejects(f.deliver("evt_missing_lookup", "checkout.session.completed", { ...f.session, id: "cs_test_another" }), { code: "billing_legacy_lookup_unavailable" });
});

test("processing redelivery requests retry, stale processing is reclaimed, and succeeded events remain terminal", async () => {
  const f = await makeFixture();
  const first = await f.repository.startStripeEvent({ eventId: "evt_interrupted", eventType: "checkout.session.completed", livemode: false, payloadSha256: "0".repeat(64) });
  await assert.rejects(f.deliver("evt_interrupted", "checkout.session.completed", f.session),
    (error) => error.code === "stripe_event_processing" && error.status === 503 && error.retryable === true);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0);
  f.repository.stripeEvents.get("evt_interrupted").updated_date = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  assert.equal((await f.deliver("evt_interrupted", "checkout.session.completed", f.session)).credits_granted, 100);
  assert.equal(await f.repository.finishStripeEvent("evt_interrupted", { claimToken: first.event.claim_token }), null);
  assert.equal(await f.repository.failStripeEvent("evt_interrupted", "late_failure", { claimToken: first.event.claim_token }), null);
  f.repository.stripeEvents.get("evt_interrupted").updated_date = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  assert.equal((await f.deliver("evt_interrupted", "checkout.session.completed", f.session)).reused, true);
  assert.equal(f.repository.stripeEvents.get("evt_interrupted").status, "succeeded");
  assert.equal(f.repository.creditEntries.length, 1);
});

test("concurrent identical event redelivery cannot acknowledge unfinished fulfillment", async () => {
  const f = await makeFixture();
  const originalGrant = f.repository.grantCredits.bind(f.repository);
  let entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  f.repository.grantCredits = async (input) => {
    entered(); await new Promise((resolve) => { release = resolve; });
    return originalGrant(input);
  };
  const first = f.deliver("evt_concurrent_delivery", "checkout.session.completed", f.session);
  await waiting;
  await assert.rejects(f.deliver("evt_concurrent_delivery", "checkout.session.completed", f.session), { code: "stripe_event_processing" });
  release();
  assert.equal((await first).credits_granted, 100);
  assert.equal((await f.deliver("evt_concurrent_delivery", "checkout.session.completed", f.session)).reused, true);
  assert.equal(f.repository.creditEntries.length, 1);
});
