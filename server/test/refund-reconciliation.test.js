import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { billingRecordId, fulfillCredits } from "../src/billing/fulfillment.js";
import { prepareStripeRefundObservation } from "../src/billing/refund-events.js";
import { approveStripeRefundReview, reviewStripeRefund, REFUND_CREDIT_POLICY } from "../src/billing/refund-reconciliation.js";

const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "refund-review-fixture", STRIPE_SECRET_KEY: "sk_test_refund_review_fixture" });
const setup = async (repository = new MemoryRepository(), subscription = false) => {
  const user = await repository.createUser({ email: "refund@example.test", passwordHash: "unused", emailVerified: true });
  await repository.ensureBillingEnvironment("test");
  await repository.createRecord("AccountEntitlement", user, { user_id: user.id, provider_customer_id: "cus_owner", billing_mode: "test" });
  const key = subscription ? "stripe:test:cycle:sub_owner:1790784000" : "stripe:test:checkout:cs_owner";
  const source = { billing_mode: "test", product_type: subscription ? "subscription_allowance" : "ai_credit_pack",
    ...(subscription ? { invoice_id: "in_owner", subscription_id: "sub_owner", period_start: 1790784000 }
      : { checkout_session_id: "cs_owner" }) };
  await fulfillCredits({ repository, user, key, amount: 100, source });
  const graph = {
    account: { id: "acct_owner" },
    "refunds/re_owner": { id: "re_owner", charge: "ch_owner", payment_intent: "pi_owner", amount: 500, currency: "usd", status: "succeeded",
      metadata: { user_id: "some_other_account", password: "never retain" } },
    "charges/ch_owner": { id: "ch_owner", livemode: false, payment_intent: "pi_owner", customer: "cus_owner", amount: 1000,
      amount_refunded: 500, currency: "usd", paid: true, status: "succeeded" },
    "payment_intents/pi_owner": { id: "pi_owner", livemode: false, latest_charge: "ch_owner", customer: "cus_owner",
      amount_received: 1000, currency: "usd", status: "succeeded" },
    "checkout/sessions/cs_owner": { id: "cs_owner", livemode: false, payment_intent: "pi_owner", customer: "cus_owner",
      mode: "payment", payment_status: "paid", status: "complete", currency: "usd", amount_total: 1000 },
    "invoices/in_owner?expand%5B%5D=payments": { id: "in_owner", livemode: false, customer: "cus_owner", currency: "usd", status: "paid", amount_paid: 1000,
      parent: { subscription_details: { subscription: "sub_owner" } }, payments: { has_more: false, data: [{ invoice: "in_owner", status: "paid",
        livemode: false, currency: "usd", amount_paid: 1000, payment: { type: "payment_intent", payment_intent: "pi_owner" } }] } }
  };
  const event = { id: "evt_owner", type: "refund.updated", livemode: false, data: { object: graph["refunds/re_owner"] } };
  const claim = await repository.startStripeEvent({ eventId: event.id, eventType: event.type, livemode: false, payloadSha256: "a".repeat(64) });
  await repository.recordStripeRefundObservation({ observation: prepareStripeRefundObservation({ event, config }), claimToken: claim.event.claim_token });
  await repository.finishStripeEvent(event.id, { claimToken: claim.event.claim_token });
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.ok(url.startsWith("https://api.stripe.com/v1/"));
    const path = url.split("/v1/")[1]; requests.push(path);
    assert.ok(graph[path], "Unexpected provider lookup " + path);
    return { ok: true, json: async () => structuredClone(graph[path]) };
  };
  const args = { repository, config, ownerId: user.id, fulfillmentId: billingRecordId(key), eventId: event.id,
    expectedAccountId: "acct_owner", fetchImpl };
  const approve = (review, extra = {}) => approveStripeRefundReview({ ...args, reviewId: review.id,
    evidenceDigest: review.evidence_digest, operatorId: "operator:fixture", approvePolicy: REFUND_CREDIT_POLICY, ...extra });
  return { user, repository, args, approve, graph, requests };
};

test("operator review links real payment graph to an owned grant; approval preserves spent/reserved credits and replays once", async () => {
  const f = await setup();
  await f.repository.enqueueJob({ ownerId: f.user.id, jobType: "test", creditAmount: 20, idempotencyKey: "spent-job" });
  const spent = await f.repository.claimNextJob({ workerId: "fixture" });
  await f.repository.completeJob({ jobId: spent.id, workerId: "fixture", artifact: { ownerId: f.user.id,
    storageProvider: "fixture", storageKey: "fixture", originalName: "fixture.txt", contentType: "text/plain", sizeBytes: 1, sha256: "a".repeat(64) } });
  await f.repository.enqueueJob({ ownerId: f.user.id, jobType: "test", creditAmount: 40, idempotencyKey: "reserved-job" });
  const before = await f.repository.getCreditAccount(f.user.id);
  const review = await reviewStripeRefund(f.args);
  assert.equal(review.evidence.proposed_credit_adjustment, 0);
  assert.equal(review.evidence.refund_amount, 500);
  assert.equal(review.evidence.charge_cumulative_refunded, 500);
  assert.equal(review.balance_at_review.reserved, 40);
  assert.equal(review.balance_at_review.available, 40);
  assert.doesNotMatch(JSON.stringify(review), /never retain|some_other_account|sk_test/);
  assert.equal(f.requests[0], "account");
  await assert.rejects(f.approve(review, { approvePolicy: undefined }), { code: "refund_operator_approval_required" });
  await assert.rejects(f.approve(review, { evidenceDigest: "0".repeat(64) }), { code: "refund_review_mismatch" });
  const decisions = await Promise.all(Array.from({ length: 6 }, () => f.approve(review)));
  assert.equal(decisions.filter((item) => !item.reused).length, 1);
  assert.equal(new Set(decisions.map((item) => item.id)).size, 1);
  assert.deepEqual(await f.repository.getCreditAccount(f.user.id), before);
  assert.equal(f.repository.creditEntries.length, 4, "Only original grant, job reservations and capture exist");
  assert.deepEqual(await reviewStripeRefund(f.args), review, "Same facts reuse immutable review");
});

test("provider pending, failed and canceled states stay distinct; changed provider facts require a new review", async () => {
  const f = await setup();
  f.graph["refunds/re_owner"].status = "pending";
  const pending = await reviewStripeRefund(f.args);
  assert.equal(pending.status, "provider_pending");
  await assert.rejects(f.approve(pending), { code: "refund_provider_pending" });
  f.graph["refunds/re_owner"].status = "succeeded";
  const succeeded = await reviewStripeRefund(f.args);
  f.graph["refunds/re_owner"].status = "failed";
  await assert.rejects(f.approve(succeeded), { code: "refund_review_stale" });
  for (const status of ["failed", "canceled"]) {
    f.graph["refunds/re_owner"].status = status;
    const review = await reviewStripeRefund(f.args);
    const decision = await f.approve(review);
    assert.equal(decision.evidence.refund_status, status);
    assert.equal(decision.cash_action, "none");
    assert.equal(decision.evidence.cash_receipt_by_customer, "not_established");
  }
  f.graph["refunds/re_owner"].status = "new_status";
  await assert.rejects(reviewStripeRefund(f.args), { code: "refund_status_unknown" });
});

test("mismatched account, owner, grant, payment, mode and customer cannot be repaired with matching metadata", async () => {
  const patches = [
    (f) => { f.graph.account.id = "acct_other"; },
    (f) => { f.graph["charges/ch_owner"].livemode = true; },
    (f) => { f.graph["refunds/re_owner"].payment_intent = "pi_other"; },
    (f) => { f.graph["checkout/sessions/cs_owner"].payment_intent = "pi_other"; },
    (f) => { f.graph["checkout/sessions/cs_owner"].customer = "cus_other"; },
    (f) => { f.graph["refunds/re_owner"].amount = 1001; },
    (f) => { f.repository.creditEntries[0].amount = 99; },
    (f) => { f.args.ownerId = randomUUID(); },
    (f) => { f.repository.stripeRefundObservations.get("evt_owner").observation.connected_account_id = "acct_owner"; }
  ];
  for (const patch of patches) {
    const f = await setup(); patch(f);
    await assert.rejects(reviewStripeRefund(f.args));
    assert.equal((await f.repository.listRecordsExact("BillingRefundReview", f.user)).length, 0);
  }
});

test("subscription refunds require a complete single paid InvoicePayment graph, not invoice or refund metadata", async () => {
  const f = await setup(undefined, true);
  const review = await reviewStripeRefund(f.args);
  assert.equal(review.evidence.source_id, "in_owner");
  assert.equal((await f.approve(review)).status, "reconciled_retain_credits");
  const invoice = f.graph["invoices/in_owner?expand%5B%5D=payments"];
  invoice.payments.has_more = true;
  await assert.rejects(reviewStripeRefund(f.args), { code: "refund_invoice_payment_unsupported" });
  invoice.payments.has_more = false;
  invoice.payments.data[0].payment.payment_intent = "pi_unrelated";
  await assert.rejects(reviewStripeRefund(f.args), { code: "refund_invoice_payment_unsupported" });
});

test("charge-total observations require a selected individual refund and never double-count cumulative totals", async () => {
  const f = await setup();
  const record = f.repository.stripeRefundObservations.get("evt_owner");
  record.observation = { ...record.observation, refund_id: null, amount: 900, amount_kind: "charge_cumulative_refunded" };
  await assert.rejects(reviewStripeRefund(f.args), { code: "refund_identity_invalid" });
  f.graph["charges/ch_owner"].amount_refunded = 900;
  const review = await reviewStripeRefund({ ...f.args, refundId: "re_owner" });
  assert.equal(review.evidence.refund_amount, 500);
  assert.equal(review.evidence.charge_cumulative_refunded, 900);
  assert.equal(review.evidence.proposed_credit_adjustment, 0);
});

test("provider transport errors omit credentials and private error details and persist no review", async () => {
  const f = await setup();
  await assert.rejects(reviewStripeRefund({ ...f.args, fetchImpl: async () => { throw new Error("sk_test_private full account body"); } }),
    (error) => error.code === "refund_provider_unavailable" && !/sk_test|full account/.test(error.message));
  assert.equal((await f.repository.listRecordsExact("BillingRefundReview", f.user)).length, 0);
});

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;
test("PostgreSQL refund decisions serialize across instances, survive restart and preserve immutable review/ledger", { skip: !connectionString }, async (t) => {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
  const schema = "refund_review_test_" + randomUUID().replaceAll("-", "");
  const control = new pg.Pool({ connectionString, max: 1 });
  const options = { connectionString, options: `-c search_path=${schema}`, max: 5 };
  const repositories = [new PostgresRepository({ pool: new pg.Pool(options) }), new PostgresRepository({ pool: new pg.Pool(options) })];
  t.after(async () => {
    await Promise.all(repositories.map((repository) => repository.close()));
    try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await control.end(); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  await repositories[0].ready();
  const f = await setup(repositories[0], true);
  const reviews = await Promise.all(Array.from({ length: 6 }, (_, i) => reviewStripeRefund({ ...f.args, repository: repositories[i % 2] })));
  assert.equal(new Set(reviews.map((review) => review.id)).size, 1);
  const decisions = await Promise.all(Array.from({ length: 6 }, (_, i) => f.approve(reviews[0], { repository: repositories[i % 2] })));
  assert.equal(decisions.filter((decision) => !decision.reused).length, 1);
  const reopened = new PostgresRepository({ pool: new pg.Pool(options) }); repositories.push(reopened);
  assert.equal((await f.approve(reviews[0], { repository: reopened })).reused, true);
  assert.deepEqual(await reopened.getRecord("BillingRefundReview", reviews[0].id, f.user), reviews[0]);
  const counts = await reopened.pool.query("SELECT (SELECT count(*)::int FROM iabt_credit_entries) AS credits, (SELECT count(*)::int FROM iabt_entity_records WHERE entity_name = 'BillingRefundDecision') AS decisions");
  assert.deepEqual(counts.rows[0], { credits: 1, decisions: 1 });
});
