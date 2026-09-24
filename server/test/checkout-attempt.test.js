import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { loadConfig } from "../src/config.js";
import { createSubscriptionCheckout } from "../src/billing/stripe-checkout.js";

const databaseUrl = process.env.IABT_AUTH_TEST_DATABASE_URL;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, adapter) {
  let repository, twin, reopen;
  const repositories = [];
  if (adapter === "memory") { repository = new MemoryRepository(); twin = repository; reopen = () => repository; }
  else {
    const url = new URL(databaseUrl);
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.equal(url.search, ""); assert.equal(url.hash, "");
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
    const schema = "checkout_test_" + randomUUID().replaceAll("-", "");
    const control = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
    const options = { connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 5000 };
    reopen = () => { const instance = new PostgresRepository({ pool: new pg.Pool(options) }); repositories.push(instance); return instance; };
    repository = reopen(); twin = reopen();
    t.after(async () => { await Promise.all(repositories.map((instance) => instance.close()));
      try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await control.end(); } });
    await control.query(`CREATE SCHEMA ${schema}`);
    await repository.ready();
  }
  const user = await repository.createUser({ email: "checkout-owner@example.test", passwordHash: "unused", emailVerified: true });
  let time = Date.now();
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "checkout-fixture", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_PRO_PRICE_ID: "price_pro", STRIPE_BUILDER_PRICE_ID: "price_builder", STRIPE_AGENCY_PRICE_ID: "price_agency", STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_pack" });
  const calls = [], reads = [], sessions = new Map(), byKey = new Map();
  let beforeResponse = null;
  const providers = {
    readiness: () => ({ stripe: { configured: true, checkout_ready: true } }),
    execute: async (_provider, _operation, payload, context) => {
      calls.push({ params: structuredClone(payload.params), key: context.idempotencyKey, path: payload.path });
      if (payload.path === "/billing_portal/sessions") return { data: { url: "https://billing.stripe.test/session" } };
      const prior = byKey.get(context.idempotencyKey);
      if (prior) assert.deepEqual(payload.params, prior.params, "Provider retry parameters must be byte-for-byte stable");
      else {
        const params = payload.params;
        const id = "cs_test_" + randomUUID().replaceAll("-", "");
        sessions.set(id, { id, mode: "subscription", status: "open", livemode: context.approval.live_confirmed, url: "https://checkout.stripe.test/" + id,
          client_reference_id: params.client_reference_id, customer: params.customer || null, expires_at: Number(params.expires_at),
          metadata: Object.fromEntries(Object.entries(params).filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value])) });
        byKey.set(context.idempotencyKey, { id, params: structuredClone(params) });
      }
      if (beforeResponse) await beforeResponse(calls.length);
      return { data: structuredClone(sessions.get(byKey.get(context.idempotencyKey).id)) };
    },
    fetch: async (url, options) => {
      assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.ok(options.signal);
      assert.equal(options.headers["Stripe-Version"], "2026-08-26.dahlia");
      assert.ok(url.startsWith("https://api.stripe.com/v1/checkout/sessions/"));
      const session = sessions.get(url.split("/").at(-1)); reads.push(url);
      return { ok: Boolean(session), json: async () => structuredClone(session) };
    }
  };
  const create = (options = {}) => createSubscriptionCheckout({ repository, user, config, providers, plan: "pro", idempotencyKey: randomUUID(), now: () => time, ...options });
  const row = async () => (await repository.listRecordsExact("BillingCheckoutAttempt", user, { limit: 1 }))[0];
  return { repository, twin, user, config, providers, calls, reads, sessions, byKey, create, row, reopen,
    advance: (ms) => { time += ms; }, hook: (callback) => { beforeResponse = callback; } };
}

for (const adapter of ["memory", "postgres"]) {
  const regression = (name, callback) => test(`${adapter}: ${name}`, { skip: adapter === "postgres" && !databaseUrl, timeout: 30000 }, callback);

  regression("concurrent first subscription checkouts across instances reuse one payable session and survive restart", async (t) => {
    const f = await fixture(t, adapter);
    f.hook(() => delay(80));
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => f.create({ repository: index % 2 ? f.twin : f.repository })));
    assert.equal(new Set(results.map((result) => result.session_id)).size, 1);
    assert.equal(f.sessions.size, 1);
    assert.equal(f.calls.length, 1);
    const restarted = await f.create({ repository: f.reopen(), idempotencyKey: "another-browser-request" });
    assert.equal(restarted.session_id, results[0].session_id);
    assert.equal(restarted.reused, true);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0);
  });

  regression("an ambiguous accepted POST resumes the identical provider request after restart", async (t) => {
    const f = await fixture(t, adapter);
    f.hook((attempt) => { if (attempt === 1) throw Object.assign(new Error("Private network details"), { code: "ETIMEDOUT" }); });
    await assert.rejects(f.create(), (failure) => failure.code === "stripe_checkout_unavailable" && !failure.message.includes("Private"));
    const saved = await f.row();
    assert.equal(saved.status, "creating");
    assert.equal(saved.session_id, null);
    const result = await f.create({ repository: f.reopen() });
    assert.equal(result.session_id, [...f.sessions.keys()][0]);
    assert.equal(f.sessions.size, 1);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].key, f.calls[1].key);
    assert.deepEqual(f.calls[0].params, f.calls[1].params);
  });

  regression("slow external calls do not hold a database transaction and expired claim owners cannot overwrite recovery", async (t) => {
    const f = await fixture(t, adapter);
    const started = deferred(), release = deferred();
    f.hook(async (attempt) => { if (attempt === 1) { started.resolve(); await release.promise; } });
    const original = f.create();
    const originalRejected = assert.rejects(original, { code: "stripe_checkout_pending" });
    await started.promise;
    // This would deadlock/time out if the Stripe request held the record lock.
    const row = await f.twin.withRecordTransaction(async (tx) => {
      const current = (await tx.listRecordsExact("BillingCheckoutAttempt", f.user))[0];
      await tx.updateRecord("BillingCheckoutAttempt", current.id, f.user, { lease_expires_at_ms: 0 });
      return current;
    });
    const recovered = await f.create({ repository: f.twin });
    assert.equal(f.sessions.size, 1);
    assert.equal(f.calls[0].key, f.calls[1].key);
    release.resolve(); await originalRejected;
    assert.equal((await f.row()).session_id, recovered.session_id);
    assert.equal((await f.row()).attempt_id, row.attempt_id);
  });

  regression("expired local time cannot replace a completed or unverified session; provider expiry can", async (t) => {
    const f = await fixture(t, adapter);
    const first = await f.create();
    f.advance(32 * 60000);
    await assert.rejects(f.create(), { code: "stripe_checkout_reconciliation_required" });
    assert.equal(f.calls.length, 1, "An elapsed timestamp alone cannot create another session");
    f.sessions.get(first.session_id).status = "complete";
    f.sessions.get(first.session_id).subscription = "sub_pending_reconciliation";
    await assert.rejects(f.create(), { code: "stripe_checkout_reconciliation_required" });
    assert.equal(f.calls.length, 1, "Completed Checkout without entitlement requires reconciliation");

    // A separate owner demonstrates legitimate replacement after provider expiry.
    const other = await f.repository.createUser({ email: "expired@example.test", passwordHash: "unused", emailVerified: true });
    const open = await f.create({ user: other });
    f.sessions.get(open.session_id).status = "expired";
    f.advance(32 * 60000);
    const replacement = await f.create({ user: other });
    assert.notEqual(replacement.session_id, open.session_id);
    assert.notEqual(f.calls.at(-1).key, f.calls.at(-2).key);
  });

  regression("changed price, plan, application scope and ambiguous credential changes cannot silently create another purchase", async (t) => {
    const f = await fixture(t, adapter);
    await f.create();
    await assert.rejects(f.create({ plan: "builder" }), { code: "stripe_checkout_terms_conflict" });
    const changed = structuredClone(f.config); changed.providers.stripe.prices.pro = "price_replaced";
    await assert.rejects(f.create({ config: changed }), { code: "stripe_checkout_terms_conflict" });
    changed.providers.stripe.metadataAppId = "another-app";
    await assert.rejects(f.create({ config: changed }), { code: "stripe_checkout_reconciliation_required" });
    assert.equal(f.sessions.size, 1);
    assert.equal((await f.create()).session_id, [...f.sessions.keys()][0], "Browser cancellation may reopen the same offer");

    const another = await f.repository.createUser({ email: "ambiguous-key@example.test", passwordHash: "unused", emailVerified: true });
    f.hook(() => { throw new Error("Unknown provider outcome"); });
    await assert.rejects(f.create({ user: another }), { code: "stripe_checkout_unavailable" });
    const rotated = structuredClone(f.config); rotated.providers.stripe.secretKey = "sk_test_other_account";
    const calls = f.calls.length;
    await assert.rejects(f.create({ user: another, config: rotated }), { code: "stripe_checkout_reconciliation_required" });
    f.advance(24 * 60 * 60000);
    await assert.rejects(f.create({ user: another }), { code: "stripe_checkout_reconciliation_required" });
    assert.equal(f.calls.length, calls, "Unknown outcomes cannot be retried with changed credentials or after the safe retention window");
  });

  regression("verified cancellation allows later subscription purchase while an active subscription uses the portal", async (t) => {
    const f = await fixture(t, adapter);
    const first = await f.create();
    f.sessions.get(first.session_id).status = "complete";
    f.sessions.get(first.session_id).subscription = "sub_finished";
    const entitlement = await f.repository.createRecord("AccountEntitlement", f.user, {
      user_id: f.user.id, plan: "free", status: "canceled", billing_provider: "stripe",
      provider_customer_id: "cus_reused", provider_subscription_id: "sub_finished"
    });
    const later = await f.create({ plan: "builder" });
    assert.notEqual(later.session_id, first.session_id);
    await f.repository.updateRecord("AccountEntitlement", entitlement.id, f.user, { status: "active", plan: "builder", provider_subscription_id: "sub_current" });
    const portal = await f.create({ plan: "agency" });
    assert.equal(portal.kind, "portal");
    assert.equal(f.calls.at(-1).path, "/billing_portal/sessions");
    assert.equal(f.sessions.size, 2);
  });

  regression("Checkout is isolated by owner and mode and a failed provider read cannot authorize replacement", async (t) => {
    const f = await fixture(t, adapter);
    const first = await f.create();
    const other = await f.repository.createUser({ email: "other-owner@example.test", role: "admin", passwordHash: "unused", emailVerified: true });
    const distinct = await f.create({ user: other });
    assert.notEqual(distinct.session_id, first.session_id);
    const live = structuredClone(f.config); live.providers.stripe.mode = "live"; live.providers.stripe.secretKey = "sk_live_synthetic_only";
    const separateMode = await f.create({ config: live });
    assert.notEqual(separateMode.session_id, first.session_id);
    assert.equal(f.sessions.get(separateMode.session_id).livemode, true, "This is a synthetic provider fixture, not a real live-mode call");
    const prior = f.calls.length;
    f.advance(32 * 60000);
    f.providers.fetch = async () => ({ ok: false, json: async () => ({ private: "provider error body" }) });
    await assert.rejects(f.create(), (failure) => failure.code === "stripe_checkout_unavailable" && !failure.message.includes("provider error body"));
    assert.equal(f.calls.length, prior);
  });

  regression("provider identity mismatch remains ambiguous but a definite rejected create permits corrected parameters", async (t) => {
    const f = await fixture(t, adapter);
    f.hook(() => { [...f.sessions.values()][0].metadata.user_id = randomUUID(); });
    await assert.rejects(f.create(), { code: "stripe_checkout_reconciliation_required" });
    assert.equal((await f.row()).session_id, null);
    const changed = structuredClone(f.config); changed.providers.stripe.prices.pro = "price_corrected";
    await assert.rejects(f.create({ config: changed }), { code: "stripe_checkout_reconciliation_required" });
    assert.equal(f.sessions.size, 1);

    const owner = await f.repository.createUser({ email: "rejected@example.test", passwordHash: "unused", emailVerified: true });
    const execute = f.providers.execute;
    f.providers.execute = async () => { throw Object.assign(new Error("Private Stripe validation detail"), { code: "stripe_invalid_request", status: 400 }); };
    await assert.rejects(f.create({ user: owner }), { code: "stripe_checkout_unavailable" });
    f.providers.execute = execute; f.hook(null);
    assert.equal((await f.create({ user: owner, config: changed })).kind, "checkout");
  });
}
