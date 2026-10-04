import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createIabtHandler } from "../src/app.js";
import { createOpaqueToken, hashToken } from "../src/security.js";
import { processStripeWebhook } from "../src/billing/stripe-webhook.js";
import { prepareStripeRefundObservation } from "../src/billing/refund-events.js";

const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "refund-fixture", STRIPE_WEBHOOK_SECRET: "whsec_refund_fixture" });
const now = 1790784000;
const refund = { id: "re_fixture", payment_intent: "pi_fixture", charge: "ch_fixture", amount: 500, currency: "usd", status: "succeeded" };
const event = (id, type = "refund.updated", object = refund, extra = {}) => ({ id, type, created: now, livemode: false, data: { object }, ...extra });
const deliver = (repository, value, signatureOverride) => {
  const rawBody = JSON.stringify(value);
  const signature = createHmac("sha256", config.providers.stripe.webhookSecret).update(now + "." + rawBody).digest("hex");
  return processStripeWebhook({ repository, config, rawBody, nowSeconds: now,
    signatureHeader: signatureOverride || `t=${now},v1=${signature}`,
    fetchImpl: async () => { throw new Error("Refund inbox must not call Stripe or another provider"); } });
};

test("refund snapshots preserve partial, multiple, failed/canceled and out-of-order evidence without projecting final state", async () => {
  const repository = new MemoryRepository();
  for (const [index, status] of ["succeeded", "pending", "failed", "canceled", "requires_action", "future_provider_state"].entries()) {
    const value = event(`evt_refund_${index}`, index === 2 ? "refund.failed" : "refund.updated", { ...refund, status }, { created: now - index });
    const response = await deliver(repository, value);
    assert.equal(response.reconciliation_required, true);
    assert.equal(response.action, "refund_reconciliation_required");
    assert.equal((await repository.getStripeRefundObservation(value.id)).observation.observed_status, index === 5 ? "unknown" : status);
  }
  await deliver(repository, event("evt_second_partial", "refund.created", { ...refund, id: "re_second", amount: 200 }));
  await deliver(repository, event("evt_legacy_refund", "charge.refund.updated", refund));
  await deliver(repository, event("evt_charge_total", "charge.refunded", {
    id: "ch_fixture", payment_intent: "pi_fixture", amount: 1000, amount_refunded: 700, currency: "usd", refunds: { has_more: true, data: [refund] }
  }));
  const cumulative = (await repository.getStripeRefundObservation("evt_charge_total")).observation;
  assert.equal(cumulative.amount, 700);
  assert.equal(cumulative.amount_kind, "charge_cumulative_refunded");
  assert.equal(cumulative.refund_id, null);
  assert.equal(repository.stripeRefundObservations.size, 9);
  assert.equal(repository.records.size, 0);
  assert.equal(repository.creditEntries.length, 0);
  assert.equal(repository.creditAccounts.size, 0);
});

test("refund inbox strips metadata and sensitive provider fields; matching metadata never associates an owner", async () => {
  const repository = new MemoryRepository();
  for (const [index, marker, classification] of [[0, undefined, "unattributed"], [1, config.providers.stripe.metadataAppId, "matching_metadata"], [2, "another-app", "other_metadata"]]) {
    const object = { ...refund, charge: { id: "ch_fixture", billing_details: { email: "private@example.test" } },
      metadata: { ...(marker ? { iabt_app_id: marker } : {}), user_id: "do-not-associate", email: "private@example.test", secret: "secret-value" },
      failure_reason: "arbitrary private provider prose", destination_details: { card: { reference: "private-value" } } };
    await deliver(repository, event(`evt_private_${index}`, "refund.updated", object, { account: "acct_fixture" }));
    const stored = (await repository.getStripeRefundObservation(`evt_private_${index}`)).observation;
    assert.equal(stored.app_attribution, classification);
    assert.equal(stored.connected_account_id, "acct_fixture");
    assert.equal(stored.charge_id, "ch_fixture");
    assert.doesNotMatch(JSON.stringify(stored), /private@example|private-value|private provider|secret-value|do-not-associate|another-app/);
    assert.equal(stored.owner_id, undefined);
  }
});

test("refund receipt is durable before transport completion and a failed completion safely reuses it", async () => {
  const repository = new MemoryRepository();
  const value = event("evt_interrupted_refund");
  const finish = repository.finishStripeEvent.bind(repository);
  repository.finishStripeEvent = async () => { throw Object.assign(new Error("interrupted"), { code: "simulated_interruption" }); };
  await assert.rejects(deliver(repository, value), { code: "simulated_interruption" });
  const receipt = await repository.getStripeRefundObservation(value.id);
  assert.equal(receipt.reconciliation_status, "required");
  assert.equal(repository.stripeEvents.get(value.id).status, "failed");
  repository.finishStripeEvent = finish;
  assert.equal((await deliver(repository, value)).reconciliation_required, true);
  assert.deepEqual(await repository.getStripeRefundObservation(value.id), receipt);
  const replay = await deliver(repository, value);
  assert.equal(replay.reused, true);
  assert.equal(replay.action, "refund_reconciliation_required");
  assert.equal(replay.reconciliation_required, true);
  await assert.rejects(deliver(repository, { ...value, data: { object: { ...refund, amount: 600 } } }), { code: "stripe_refund_observation_conflict" });
  assert.deepEqual(await repository.getStripeRefundObservation(value.id), receipt);
});

test("refund persistence outages and old ignored receipts cannot masquerade as reconciliation success", async () => {
  const repository = new MemoryRepository();
  const value = event("evt_missing_inbox");
  repository.recordStripeRefundObservation = undefined;
  await assert.rejects(deliver(repository, value), { code: "stripe_refund_inbox_unavailable" });
  assert.equal(repository.stripeEvents.get(value.id).status, "failed");
  await repository.finishStripeEvent(value.id);
  await assert.rejects(deliver(repository, value), { code: "stripe_refund_receipt_missing" });
});

test("refund snapshots require the current processing claim; stale workers cannot create or replace evidence", async () => {
  const repository = new MemoryRepository();
  const value = event("evt_stale_claim");
  const observation = prepareStripeRefundObservation({ event: value, config });
  const claim = await repository.startStripeEvent({ eventId: value.id, eventType: value.type, livemode: false, payloadSha256: "a".repeat(64) });
  await repository.failStripeEvent(value.id, "interrupted", { claimToken: claim.event.claim_token });
  const current = await repository.startStripeEvent({ eventId: value.id, eventType: value.type, livemode: false, payloadSha256: "a".repeat(64) });
  assert.equal(await repository.recordStripeRefundObservation({ observation, claimToken: claim.event.claim_token }), null);
  assert.equal(await repository.getStripeRefundObservation(value.id), null);
  assert.equal(await repository.recordStripeRefundObservation({ observation }), null);
  assert.ok(await repository.recordStripeRefundObservation({ observation, claimToken: current.event.claim_token }));
});

test("invalid signatures, wrong billing mode and malformed refund objects leave the inbox unchanged", async () => {
  const repository = new MemoryRepository();
  await assert.rejects(deliver(repository, event("evt_tampered"), `t=${now},v1=${"0".repeat(64)}`), { code: "stripe_signature_invalid" });
  await assert.rejects(deliver(repository, event("evt_live", "refund.updated", refund, { livemode: true })), { code: "stripe_mode_mismatch" });
  for (const [index, patch] of [{ id: "bad" }, { charge: "bad" }, { amount: 1.5 }, { currency: "invalid" }, { charge: null, payment_intent: null }].entries()) {
    await assert.rejects(deliver(repository, event(`evt_invalid_${index}`, "refund.updated", { ...refund, ...patch })));
  }
  assert.equal(repository.stripeRefundObservations.size, 0);
  assert.equal(repository.stripeEvents.size, 0);
});

test("operator refund evidence has no generic entity read/write path, including administrators", async (t) => {
  const repository = new MemoryRepository();
  await deliver(repository, event("evt_private_inbox"));
  const server = createServer(createIabtHandler({ repository, config, storage: {}, providers: {} }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const role of ["user", "admin"]) {
    const user = await repository.createUser({ email: `${role}@example.test`, role, passwordHash: "unused", emailVerified: true });
    const token = createOpaqueToken();
    await repository.createSession({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 60000).toISOString() });
    for (const method of ["GET", "POST"]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/entities/StripeRefundObservation`, {
        method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ status: "resolved" }) } : {})
      });
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /evt_private_inbox|re_fixture|pi_fixture/);
    }
  }
});
