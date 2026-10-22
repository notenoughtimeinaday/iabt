import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PostgresRepository } from "../src/postgres-repository.js";
import { loadConfig } from "../src/config.js";
import { processStripeWebhook } from "../src/billing/stripe-webhook.js";
import { prepareStripeRefundObservation } from "../src/billing/refund-events.js";

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;
test("PostgreSQL refund observations survive concurrent instances, interrupted completion, restart and stale claims", { skip: !connectionString }, async (t) => {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
  const schema = "refund_test_" + randomUUID().replaceAll("-", "");
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
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "refund-pg-fixture", STRIPE_WEBHOOK_SECRET: "whsec_refund_pg_fixture" });
  const now = Math.floor(Date.now() / 1000);
  const value = (id) => ({ id, type: "refund.updated", livemode: false, created: now,
    data: { object: { id: "re_pg", payment_intent: "pi_pg", charge: "ch_pg", amount: 900, currency: "usd", status: "succeeded" } } });
  const deliver = (repo, event) => {
    const rawBody = JSON.stringify(event);
    const signature = createHmac("sha256", config.providers.stripe.webhookSecret).update(now + "." + rawBody).digest("hex");
    return processStripeWebhook({ repository: repo, config, rawBody, nowSeconds: now, signatureHeader: `t=${now},v1=${signature}` });
  };
  const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => deliver(repositories[i % 2], value(`evt_pg_${i}`))));
  assert.ok(outcomes.every((result) => result.reconciliation_required && result.credits_granted === 0));
  const concurrent = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => deliver(repositories[i % 2], value("evt_pg_same"))));
  assert.ok(concurrent.some((result) => result.status === "fulfilled"));
  for (const result of concurrent.filter((item) => item.status === "rejected")) assert.equal(result.reason.code, "stripe_event_processing");

  const finish = repository.finishStripeEvent.bind(repository);
  repository.finishStripeEvent = async () => { throw Object.assign(new Error("interrupted"), { code: "simulated_interruption" }); };
  await assert.rejects(deliver(repository, value("evt_pg_interrupted")), { code: "simulated_interruption" });
  repository.finishStripeEvent = finish;
  const recorded = await repository.getStripeRefundObservation("evt_pg_interrupted");
  const reopened = new PostgresRepository({ pool: new pg.Pool(options) }); repositories.push(reopened);
  assert.equal((await deliver(reopened, value("evt_pg_interrupted"))).reconciliation_required, true);
  assert.deepEqual(await reopened.getStripeRefundObservation("evt_pg_interrupted"), recorded);
  assert.equal((await deliver(reopened, value("evt_pg_same"))).reused, true);

  const stale = value("evt_pg_stale");
  const first = await repository.startStripeEvent({ eventId: stale.id, eventType: stale.type, livemode: false, payloadSha256: "a".repeat(64) });
  await repository.pool.query("UPDATE iabt_stripe_events SET updated_at = now() - interval '16 minutes' WHERE event_id = $1", [stale.id]);
  const current = await reopened.startStripeEvent({ eventId: stale.id, eventType: stale.type, livemode: false, payloadSha256: "a".repeat(64) });
  const observation = prepareStripeRefundObservation({ event: stale, config });
  assert.equal(await repository.recordStripeRefundObservation({ observation, claimToken: first.event.claim_token }), null);
  assert.equal(await repository.getStripeRefundObservation(stale.id), null);
  assert.ok(await reopened.recordStripeRefundObservation({ observation, claimToken: current.event.claim_token }));
  const conflict = await reopened.recordStripeRefundObservation({ observation: { ...observation, amount: 1 }, claimToken: current.event.claim_token });
  assert.equal(conflict.observation.amount, 900, "Insert-only storage cannot replace earlier evidence");
  assert.equal(await repository.finishStripeEvent(stale.id, { claimToken: first.event.claim_token }), null);
  await reopened.finishStripeEvent(stale.id, { claimToken: current.event.claim_token });

  const counts = await reopened.pool.query(`SELECT
    (SELECT count(*)::int FROM iabt_stripe_refund_observations) AS observations,
    (SELECT count(*)::int FROM iabt_credit_entries) AS credit_entries,
    (SELECT count(*)::int FROM iabt_entity_records) AS account_records`);
  assert.deepEqual(counts.rows[0], { observations: 11, credit_entries: 0, account_records: 0 });
});
