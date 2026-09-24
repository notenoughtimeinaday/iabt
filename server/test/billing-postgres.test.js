import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PostgresRepository } from "../src/postgres-repository.js";
import { loadConfig } from "../src/config.js";
import { processStripeWebhook } from "../src/billing/stripe-webhook.js";

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;
test("PostgreSQL fulfills concurrent distinct Stripe events once across instances and restarts", { skip: !connectionString }, async (t) => {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
  const schema = "billing_test_" + randomUUID().replaceAll("-", "");
  const control = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const options = { connectionString, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 5000 };
  const repositories = [new PostgresRepository({ pool: new pg.Pool(options) }), new PostgresRepository({ pool: new pg.Pool(options) })];
  t.after(async () => {
    await Promise.all(repositories.map((repository) => repository.close()));
    try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await control.end(); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  const [repository] = repositories;
  await repository.ready();
  const user = await repository.createUser({ email: "billing-pg@example.test", passwordHash: "unused", emailVerified: true });
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "billing-pg-fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PRO_PRICE_ID: "price_pro" });
  const metadata = { iabt_app_id: config.providers.stripe.metadataAppId, user_id: user.id, user_email: user.email };
  const timestamp = Math.floor(Date.now() / 1000);
  const session = { id: "cs_test_shared", mode: "payment", payment_status: "paid", metadata: { ...metadata, product_type: "ai_credit_pack", credits: "75" } };
  const deliver = (repo, id, type, object) => {
    const rawBody = JSON.stringify({ id, type, livemode: false, data: { object } });
    const signature = createHmac("sha256", config.providers.stripe.webhookSecret).update(timestamp + "." + rawBody).digest("hex");
    return processStripeWebhook({ repository: repo, config, rawBody, signatureHeader: `t=${timestamp},v1=${signature}` });
  };
  const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => deliver(repositories[i % 2], `evt_shared_${i}`, "checkout.session.completed", session)));
  assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.credits_granted, 0), 75);
  assert.equal((await repository.getCreditAccount(user.id)).available_credits, 75);
  const invoice = { id: "in_shared", customer: "cus_shared", status: "paid", billing_reason: "subscription_cycle",
    parent: { subscription_details: { subscription: "sub_shared", metadata } },
    lines: { data: [{ type: "subscription", price: { id: "price_pro" }, amount: 7900, quantity: 1,
      period: { start: timestamp, end: timestamp + 30 * 86400 } }] }
  };
  await Promise.all(Array.from({ length: 6 }, (_, i) => deliver(repositories[i % 2], `evt_monthly_${i}`, "invoice.paid", invoice)));
  assert.equal((await repository.getCreditAccount(user.id)).available_credits, 575);
  const reopened = new PostgresRepository({ pool: new pg.Pool(options) }); repositories.push(reopened);
  assert.equal((await deliver(reopened, "evt_after_restart", "checkout.session.async_payment_succeeded", session)).credits_granted, 0);
  assert.equal((await deliver(reopened, "evt_invoice_after_restart", "invoice.paid", invoice)).credits_granted, 0);
  const rows = await reopened.pool.query("SELECT entry_type, count(*)::int AS count FROM iabt_credit_entries GROUP BY entry_type");
  assert.deepEqual(rows.rows, [{ entry_type: "grant", count: 2 }]);
  assert.equal((await reopened.listRecords("BillingFulfillment", user)).length, 2);

  // Simulate committed pre-upgrade grants, which had event-level ledger keys.
  const legacySession = { ...session, id: "cs_test_before_upgrade" };
  await reopened.grantCredits({ ownerId: user.id, amount: 75, idempotencyKey: "stripe:evt_legacy",
    metadata: { event_id: "evt_legacy", checkout_session_id: legacySession.id, product_type: "ai_credit_pack" } });
  const legacyOutcomes = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    deliver(repositories[i % 2], `evt_legacy_retry_${i}`, "checkout.session.async_payment_succeeded", legacySession)));
  assert.ok(legacyOutcomes.every((outcome) => outcome.credits_granted === 0));
  assert.equal((await reopened.getCreditAccount(user.id)).available_credits, 650);
  const [receipt] = await reopened.listRecordsExact("BillingFulfillment", user, { query: { checkout_session_id: legacySession.id } });
  assert.equal(receipt.legacy_event_id, "evt_legacy");
  assert.equal((await deliver(reopened, "evt_legacy_late", "checkout.session.completed", legacySession)).credits_granted, 0);

  const other = await reopened.createUser({ email: "old-billing-owner@example.test", passwordHash: "unused", emailVerified: true });
  const foreignSession = { ...session, id: "cs_test_legacy_other_owner" };
  await reopened.grantCredits({ ownerId: other.id, amount: 75, idempotencyKey: "stripe:evt_foreign_legacy",
    metadata: { event_id: "evt_foreign_legacy", checkout_session_id: foreignSession.id, product_type: "ai_credit_pack" } });
  await assert.rejects(deliver(reopened, "evt_foreign_upgrade", "checkout.session.completed", foreignSession), { code: "billing_legacy_fulfillment_conflict" });
  assert.equal((await reopened.getCreditAccount(user.id)).available_credits, 650);

  const duplicateSession = { ...session, id: "cs_test_legacy_ambiguous" };
  for (let i = 0; i < 3; i += 1) {
    await reopened.grantCredits({ ownerId: user.id, amount: 75, idempotencyKey: `stripe:evt_prior_duplicate_${i}`,
      metadata: { event_id: `evt_prior_duplicate_${i}`, checkout_session_id: duplicateSession.id, product_type: "ai_credit_pack" } });
  }
  assert.equal((await reopened.findLegacyStripeCreditGrants({ checkoutSessionId: duplicateSession.id })).length, 2);
  await assert.rejects(deliver(reopened, "evt_ambiguous_upgrade", "checkout.session.completed", duplicateSession), { code: "billing_legacy_fulfillment_conflict" });
  assert.equal((await reopened.getCreditAccount(user.id)).available_credits, 875);

  const interruptedSession = { ...session, id: "cs_test_interrupted" };
  const claim = await repository.startStripeEvent({ eventId: "evt_interrupted", eventType: "checkout.session.completed", livemode: false, payloadSha256: "0".repeat(64) });
  await assert.rejects(deliver(reopened, "evt_interrupted", "checkout.session.completed", interruptedSession),
    (error) => error.status === 503 && error.code === "stripe_event_processing" && error.retryable === true);
  await reopened.pool.query("UPDATE iabt_stripe_events SET updated_at = now() - interval '16 minutes' WHERE event_id = $1", ["evt_interrupted"]);
  assert.equal((await deliver(reopened, "evt_interrupted", "checkout.session.completed", interruptedSession)).credits_granted, 75);
  assert.equal(await repository.finishStripeEvent("evt_interrupted", { claimToken: claim.event.claim_token }), null);
  assert.equal(await repository.failStripeEvent("evt_interrupted", "stale_process", { claimToken: claim.event.claim_token }), null);
  await reopened.pool.query("UPDATE iabt_stripe_events SET updated_at = now() - interval '1 day' WHERE event_id = $1", ["evt_interrupted"]);
  assert.equal((await deliver(reopened, "evt_interrupted", "checkout.session.completed", interruptedSession)).reused, true);
  assert.equal((await reopened.getCreditAccount(user.id)).available_credits, 950);
});
