import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { loadConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { ensureBillingEnvironment } from "../src/billing/environment.js";
import { createCreditCheckout, createCustomerPortal, createSubscriptionCheckout } from "../src/billing/stripe-checkout.js";
import { processStripeWebhook } from "../src/billing/stripe-webhook.js";

const databaseUrl = process.env.IABT_AUTH_TEST_DATABASE_URL;
const configFor = (mode, extra = {}) => loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "mode-binding-fixture",
  IABT_STRIPE_MODE: mode, STRIPE_WEBHOOK_SECRET: "whsec_mode_fixture", ...extra });
const event = (repository, id, mode) => repository.startStripeEvent({ eventId: id, eventType: "invoice.paid", livemode: mode === "live", payloadSha256: "0".repeat(64) });

async function fixture(t, adapter) {
  const repositories = [];
  let repository, reopen, scopedUrl;
  if (adapter === "memory") {
    repository = new MemoryRepository();
    reopen = () => repository;
  } else {
    const url = new URL(databaseUrl);
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.equal(url.search, ""); assert.equal(url.hash, "");
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
    const schema = "billing_mode_test_" + randomUUID().replaceAll("-", "");
    const control = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
    const options = { connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 5000 };
    reopen = () => { const instance = new PostgresRepository({ pool: new pg.Pool(options) }); repositories.push(instance); return instance; };
    repository = reopen();
    scopedUrl = new URL(databaseUrl); scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
    t.after(async () => {
      await Promise.all(repositories.map((instance) => instance.close()));
      try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
      finally { await control.end(); }
    });
    await control.query(`CREATE SCHEMA ${schema}`);
    await repository.ready();
  }
  const account = (email = "mode-owner@example.test") => repository.createUser({ email, passwordHash: "unused", emailVerified: true });
  const owner = await account();
  const entitlement = (user = owner, extra = {}) => repository.createRecord("AccountEntitlement", user, {
    user_id: user.id, billing_provider: "stripe", provider_customer_id: "cus_synthetic", provider_subscription_id: "sub_synthetic", plan: "pro", status: "active", ...extra
  });
  return { repository, reopen, account, owner, entitlement, scopedUrl };
}

for (const adapter of ["memory", "postgres"]) {
  const regression = (name, fn) => test(`${adapter}: billing environment ${name}`, { skip: adapter === "postgres" && !databaseUrl, timeout: 30000 }, fn);

  regression("has one winner for opposing mode claims and survives reopening", async (t) => {
    const f = await fixture(t, adapter);
    // Starter credits have no Stripe provenance and do not prevent initial binding.
    await f.repository.grantCredits({ ownerId: f.owner.id, amount: 10, idempotencyKey: "signup:free:v1" });
    await f.repository.createRecord("BillingEvent", f.owner, { billing_provider: "manual", action: "non_stripe_fixture" });
    const claims = await Promise.allSettled([f.repository.ensureBillingEnvironment("test"), f.reopen().ensureBillingEnvironment("live")]);
    assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
    assert.equal(claims.find((claim) => claim.status === "rejected").reason.code, "billing_environment_conflict");
    const winner = claims.find((claim) => claim.status === "fulfilled").value;
    assert.equal(winner.bound_from, "first_runtime");
    const same = await Promise.all(Array.from({ length: 6 }, () => f.reopen().ensureBillingEnvironment(winner.mode)));
    assert.ok(same.every((binding) => String(binding.bound_at) === String(winner.bound_at)));
    await assert.rejects(f.reopen().ensureBillingEnvironment(winner.mode === "test" ? "live" : "test"), { code: "billing_environment_conflict" });
    assert.equal((await f.repository.getCreditAccount(f.owner.id)).available_credits, 10);
    if (adapter === "postgres") {
      const existing = f.reopen();
      existing.withRecordTransaction = () => assert.fail("an existing immutable binding must not take the shared record lock");
      assert.equal((await existing.ensureBillingEnvironment(winner.mode)).mode, winner.mode);
    }
  });

  regression("adopts test-funded history and owner-specific legacy entitlement evidence, never current live config", async (t) => {
    const f = await fixture(t, adapter);
    await f.repository.grantCredits({ ownerId: f.owner.id, amount: 100, idempotencyKey: "stripe:test:cycle:sub_synthetic:1000",
      metadata: { product_type: "subscription_allowance", subscription_id: "sub_synthetic" } });
    await f.entitlement();
    await assert.rejects(f.repository.ensureBillingEnvironment("live"), { code: "billing_environment_conflict" });
    const binding = await f.reopen().ensureBillingEnvironment("test");
    assert.equal(binding.bound_from, "verified_history");
    assert.equal((await f.repository.getCreditAccount(f.owner.id)).available_credits, 100);
  });

  regression("requires exact owner/subscription provenance instead of unrelated events, credit packs or Checkout attempts", async (t) => {
    const f = await fixture(t, adapter);
    await f.entitlement();
    await event(f.repository, "evt_unrelated", "test");
    const other = await f.account("other@example.test");
    await f.repository.createRecord("BillingEvent", other, { event_id: "evt_unrelated" });
    await f.repository.createRecord("BillingCheckoutAttempt", f.owner, { mode: "test" });
    await f.repository.grantCredits({ ownerId: f.owner.id, amount: 100, idempotencyKey: "stripe:test:checkout:cs_test_pack", metadata: { product_type: "ai_credit_pack" } });
    await f.repository.grantCredits({ ownerId: f.owner.id, amount: 100, idempotencyKey: "stripe:test:cycle:sub_unrelated:1000", metadata: { product_type: "subscription_allowance", subscription_id: "sub_unrelated" } });
    await f.repository.grantCredits({ ownerId: other.id, amount: 100, idempotencyKey: "stripe:test:cycle:sub_synthetic:1000", metadata: { product_type: "subscription_allowance", subscription_id: "sub_synthetic" } });
    await assert.rejects(f.repository.ensureBillingEnvironment("test"), { code: "billing_environment_reconciliation_required" });
    await event(f.repository, "evt_owned", "test");
    await f.repository.createRecord("BillingEvent", f.owner, { event_id: "evt_owned" });
    await assert.rejects(f.repository.ensureBillingEnvironment("test"), { code: "billing_environment_reconciliation_required" });
    await f.repository.createRecord("BillingFulfillment", f.owner, { event_id: "evt_owned", product_type: "subscription_allowance", subscription_id: "sub_synthetic" });
    assert.equal((await f.repository.ensureBillingEnvironment("test")).bound_from, "verified_history");
  });

  regression("refuses mixed event history without persisting a binding", async (t) => {
    const f = await fixture(t, adapter);
    await event(f.repository, "evt_test", "test");
    await event(f.repository, "evt_live", "live");
    for (const mode of ["test", "live"]) await assert.rejects(f.reopen().ensureBillingEnvironment(mode), { code: "billing_environment_conflict" });
  });

  regression("requires provenance for old Stripe grants and detects conflicting mode fields", async (t) => {
    const f = await fixture(t, adapter);
    await f.repository.grantCredits({ ownerId: f.owner.id, amount: 100, idempotencyKey: "stripe:evt_legacy", metadata: { event_id: "evt_legacy", product_type: "ai_credit_pack" } });
    await assert.rejects(f.repository.ensureBillingEnvironment("test"), { code: "billing_environment_reconciliation_required" });
    await event(f.repository, "evt_legacy", "test");
    await f.repository.createRecord("BillingFulfillment", f.owner, { fulfillment_key: "stripe:test:checkout:cs_test_old", billing_mode: "live" });
    await assert.rejects(f.reopen().ensureBillingEnvironment("test"), { code: "billing_environment_conflict" });
  });

  regression("blocks all Checkout, portal and webhook side effects before the conflicting mode writes", async (t) => {
    const f = await fixture(t, adapter);
    await f.repository.ensureBillingEnvironment("test");
    const config = configFor("live");
    let calls = 0;
    const providers = { readiness: () => ({ stripe: { configured: true, checkout_ready: true } }), execute: async () => { calls += 1; throw new Error("must not execute"); } };
    for (const create of [createSubscriptionCheckout, createCreditCheckout, createCustomerPortal]) {
      await assert.rejects(create({ repository: f.reopen(), config, providers, user: f.owner, plan: "pro", idempotencyKey: "synthetic" }), { code: "billing_environment_conflict" });
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ id: "evt_conflicting", type: "checkout.session.completed", livemode: true, data: { object: {} } });
    const signature = createHmac("sha256", config.providers.stripe.webhookSecret).update(timestamp + "." + rawBody).digest("hex");
    await assert.rejects(processStripeWebhook({ repository: f.reopen(), config, rawBody, signatureHeader: `t=${timestamp},v1=${signature}` }), { code: "billing_environment_conflict" });
    assert.equal(calls, 0);
    assert.equal((await f.repository.listRecords("BillingCheckoutAttempt", f.owner)).length, 0);
    assert.equal((await f.repository.listRecords("AccountEntitlement", f.owner)).length, 0);
    assert.equal((await f.repository.getCreditAccount(f.owner.id)).available_credits, 0);
    if (adapter === "postgres") assert.equal((await f.repository.pool.query("SELECT count(*)::int AS count FROM iabt_stripe_events")).rows[0].count, 0);
    else assert.equal(f.repository.stripeEvents.size, 0);
  });
}

test("runtime rejects a persisted conflicting mode before storage initialization", { skip: !databaseUrl, timeout: 30000 }, async (t) => {
  const f = await fixture(t, "postgres");
  await f.repository.ensureBillingEnvironment("test");
  // Missing S3 settings deliberately establish that the billing guard runs first.
  const config = configFor("live", { IABT_DATABASE_URL: f.scopedUrl.href, IABT_STORAGE_PROVIDER: "s3" });
  await assert.rejects(createRuntime({ config }), { code: "billing_environment_conflict" });
  assert.equal((await f.reopen().ensureBillingEnvironment("test")).mode, "test");
});

test("unknown billing modes and missing durable repository protection fail closed", async () => {
  assert.throws(() => loadConfig({ IABT_STRIPE_MODE: "production" }), /must be test or live/);
  await assert.rejects(ensureBillingEnvironment({ repository: {}, config: configFor("test") }), { code: "billing_environment_unavailable" });
  await assert.rejects(new MemoryRepository().ensureBillingEnvironment("unknown"), { code: "billing_environment_invalid" });
});
