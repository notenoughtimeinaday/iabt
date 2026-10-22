import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { loadConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { createSubscriptionCheckout, createCreditCheckout } from "../src/billing/stripe-checkout.js";
import { processStripeWebhook } from "../src/billing/stripe-webhook.js";
import { ensureBillingPriceCatalog, normalizePriceContract, resolvePriceContract } from "../src/billing/price-catalog.js";

const env = { NODE_ENV: "test", IABT_AUTH_SECRET: "price-contract-fixture", IABT_STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "rk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_price_fixture",
  STRIPE_BUILDER_PRICE_ID: "price_builder_legacy", STRIPE_PRO_PRICE_ID: "price_pro_legacy", STRIPE_AGENCY_PRICE_ID: "price_agency_legacy", STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_pack" };
const offer = (extra = {}) => ({ price_id: "price_builder_new", plan: "builder", monthly_credits: 150, ...extra });
const catalog = (extra = {}) => ({ version: "offer-v2", prices: [offer()], checkout: { builder: "price_builder_new" }, ...extra });
const config = (value, overrides = {}) => loadConfig({ ...env, ...(value ? { IABT_STRIPE_PRICE_CATALOG_JSON: JSON.stringify(value) } : {}), ...overrides });
const databaseUrl = process.env.IABT_AUTH_TEST_DATABASE_URL;

async function fixture(t, adapter) {
  const repositories = [];
  let repository, reopen, scopedUrl;
  if (adapter === "memory") { repository = new MemoryRepository(); reopen = () => repository; }
  else {
    const url = new URL(databaseUrl);
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.equal(url.search, ""); assert.equal(url.hash, "");
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
    const schema = "price_catalog_test_" + randomUUID().replaceAll("-", "");
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
  const user = await repository.createUser({ email: "price-contract@example.test", passwordHash: "unused", emailVerified: true });
  return { repository, reopen, user, scopedUrl };
}

const deliver = ({ repository, value, id, type, object }) => {
  const now = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({ id, type, livemode: false, data: { object } });
  const signature = createHmac("sha256", value.providers.stripe.webhookSecret).update(now + "." + rawBody).digest("hex");
  return processStripeWebhook({ repository, config: value, rawBody, nowSeconds: now, signatureHeader: `t=${now},v1=${signature}`,
    fetchImpl: async () => ({ ok: true, json: async () => structuredClone(object) }) });
};
const identity = (user, value) => ({ iabt_app_id: value.providers.stripe.metadataAppId, user_id: user.id, user_email: user.email });
const invoice = (user, value, priceId, start = 1788523200) => ({ id: "in_synthetic_" + start, customer: "cus_synthetic", status: "paid", billing_reason: "subscription_cycle",
  parent: { subscription_details: { subscription: "sub_synthetic", metadata: { ...identity(user, value), plan: "agency", credits: "999999", billing_catalog_version: "forged", billing_contract_sha256: "0".repeat(64) } } },
  lines: { data: [{ amount: 2900, quantity: 1, type: "subscription", price: { id: priceId }, period: { start, end: start + 30 * 86400 } }] } });

test("legacy catalog is unchanged by default and new monthly offers require explicit additive configuration", () => {
  const old = config().providers.stripe;
  assert.deepEqual(old.prices, { builder: "price_builder_legacy", pro: "price_pro_legacy", agency: "price_agency_legacy" });
  assert.deepEqual(old.priceContracts.map((item) => [item.plan, item.monthly_credits, item.catalog_version]), [["builder", 100, "legacy-v1"], ["pro", 500, "legacy-v1"], ["agency", 2000, "legacy-v1"]]);
  const added = config(catalog()).providers.stripe;
  assert.equal(added.prices.builder, "price_builder_new");
  assert.equal(added.prices.pro, old.prices.pro);
  assert.equal(added.priceContracts.find((item) => item.price_id === "price_builder_legacy").monthly_credits, 100);
  assert.equal(added.priceContracts.find((item) => item.price_id === "price_builder_new").monthly_credits, 150);
  assert.ok(Object.isFrozen(added.priceContracts) && Object.isFrozen(added.priceContracts[0]));
});

test("catalog validation rejects ambiguous prices, changed legacy definitions, invalid contracts and unsupported selections", () => {
  for (const value of [
    [], null, {}, catalog({ version: "legacy-v1" }), catalog({ version: "" }), catalog({ version: "x".repeat(65) }),
    catalog({ unexpected: true }), catalog({ prices: [] }), catalog({ prices: [offer(), offer()] }),
    catalog({ prices: [offer({ price_id: "price_builder_legacy" })] }),
    catalog({ prices: [offer({ price_id: "price_pack" })] }),
    catalog({ prices: [offer({ price_id: "not-a-price" })] }),
    catalog({ prices: [offer({ price_id: ["price_builder_new"] })], checkout: {} }),
    ...[2, ["offer-v2"], null].map((version) => catalog({ version })),
    ...[2, ["offer-v2"], null, "", "legacy-v1"].map((catalog_version) => catalog({ prices: [offer({ catalog_version })] })),
    catalog({ prices: [offer({ plan: "unknown-tier" })] }),
    catalog({ prices: [offer({ interval: "year" })] }),
    catalog({ checkout: { pro: "price_builder_new" } }), catalog({ checkout: { builder: "price_unknown" } }),
    catalog({ checkout: { free: "price_builder_new" } }),
    ...[0, -1, 1.5, "150", 1000001].map((monthly_credits) => catalog({ prices: [offer({ monthly_credits })] }))
  ]) assert.throws(() => loadConfig({ ...env, IABT_STRIPE_PRICE_CATALOG_JSON: JSON.stringify(value) }), { code: "billing_catalog_invalid" });
  assert.throws(() => loadConfig({ ...env, IABT_STRIPE_PRICE_CATALOG_JSON: "{" }), { code: "billing_catalog_invalid" });
  assert.throws(() => loadConfig({ ...env, STRIPE_PRO_PRICE_ID: env.STRIPE_BUILDER_PRICE_ID }), { code: "billing_catalog_invalid" });
});

for (const adapter of ["memory", "postgres"]) {
  const regression = (name, fn) => test(`${adapter}: price catalog ${name}`, { skip: adapter === "postgres" && !databaseUrl, timeout: 30000 }, fn);

  regression("serializes competing first definitions, preserves atomicity and reuses immutable contracts after restart", async (t) => {
    const f = await fixture(t, adapter);
    const first = normalizePriceContract({ ...offer(), catalog_version: "offer-v2", interval: "month" });
    const changed = normalizePriceContract({ ...offer({ monthly_credits: 999 }), catalog_version: "offer-v3", interval: "month" });
    const outcomes = await Promise.allSettled([f.repository.registerBillingPriceContracts({ mode: "test", contracts: [first] }), f.reopen().registerBillingPriceContracts({ mode: "test", contracts: [changed] })]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.find((item) => item.status === "rejected").reason.code, "billing_price_contract_conflict");
    const stored = await f.reopen().getBillingPriceContract({ mode: "test", priceId: first.price_id });
    const losing = stored.monthly_credits === first.monthly_credits ? changed : first;
    const extra = normalizePriceContract({ ...first, price_id: "price_should_not_be_inserted" });
    await assert.rejects(f.reopen().registerBillingPriceContracts({ mode: "test", contracts: [extra, losing] }), { code: "billing_price_contract_conflict" });
    assert.equal(await f.repository.getBillingPriceContract({ mode: "test", priceId: extra.price_id }), null);
    const reopened = f.reopen();
    if (adapter === "postgres") reopened.withRecordTransaction = () => assert.fail("unchanged price registry must not take the global record lock");
    await reopened.registerBillingPriceContracts({ mode: "test", contracts: [stored] });
    await assert.rejects(f.reopen().registerBillingPriceContracts({ mode: "live", contracts: [stored] }), { code: "billing_environment_conflict" });
  });

  regression("uses retired verified prices after configuration changes and ignores invoice metadata allowance claims", async (t) => {
    const f = await fixture(t, adapter);
    await ensureBillingPriceCatalog({ repository: f.repository, config: config() });
    const newer = config(catalog(), { STRIPE_BUILDER_PRICE_ID: "", STRIPE_PRO_PRICE_ID: "", STRIPE_AGENCY_PRICE_ID: "" });
    await ensureBillingPriceCatalog({ repository: f.reopen(), config: newer });
    const legacy = await resolvePriceContract({ repository: f.reopen(), config: newer, priceId: "price_builder_legacy" });
    assert.equal(legacy.monthly_credits, 100);
    assert.equal(legacy.catalog_version, "legacy-v1");
    assert.equal((await deliver({ repository: f.reopen(), value: newer, id: "evt_old_invoice", type: "invoice.paid", object: invoice(f.user, newer, legacy.price_id) })).credits_granted, 100);
    assert.equal((await deliver({ repository: f.reopen(), value: newer, id: "evt_new_invoice", type: "invoice.paid", object: invoice(f.user, newer, "price_builder_new", 1791115200) })).credits_granted, 150);
    assert.equal((await deliver({ repository: f.reopen(), value: newer, id: "evt_old_replay_different", type: "invoice.paid", object: invoice(f.user, newer, legacy.price_id) })).credits_granted, 0);
    assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 250);
    const receipts = await f.repository.listRecords("BillingFulfillment", f.user);
    assert.deepEqual(receipts.map((item) => item.billing_price_contract.monthly_credits).sort((a, b) => a - b), [100, 150]);
    for (const [index, priceId, allowance, version] of [[0, legacy.price_id, 100, "legacy-v1"], [1, "price_builder_new", 150, "offer-v2"]]) {
      const subscription = { id: "sub_synthetic", customer: "cus_synthetic", status: "active", livemode: false,
        metadata: { ...identity(f.user, newer), plan: "agency", credits: "999999" }, items: { data: [{ price: { id: priceId } }] } };
      await deliver({ repository: f.reopen(), value: newer, id: "evt_subscription_" + index, type: "customer.subscription.updated", object: subscription });
      const [entitlement] = await f.repository.listRecords("AccountEntitlement", f.user);
      assert.equal(entitlement.plan, "builder");
      assert.equal(entitlement.ai_monthly_limit, allowance);
      assert.equal(entitlement.billing_price_contract.catalog_version, version);
    }
  });

  regression("allows independent tier version rollovers while retaining earlier immutable active offers", async (t) => {
    const f = await fixture(t, adapter);
    const v2 = config(catalog());
    await ensureBillingPriceCatalog({ repository: f.repository, config: v2 });
    const v3 = config(catalog({ version: "offer-v3", prices: [offer({ catalog_version: "offer-v2" }),
      { price_id: "price_pro_new", plan: "pro", monthly_credits: 700 }],
      checkout: { builder: "price_builder_new", pro: "price_pro_new" } }));
    await ensureBillingPriceCatalog({ repository: f.reopen(), config: v3 });
    const builder = await resolvePriceContract({ repository: f.reopen(), config: v3, priceId: v3.providers.stripe.prices.builder });
    const pro = await resolvePriceContract({ repository: f.reopen(), config: v3, priceId: v3.providers.stripe.prices.pro });
    assert.equal(builder.contract_sha256, v2.providers.stripe.priceContracts.find((item) => item.price_id === builder.price_id).contract_sha256);
    assert.equal(builder.catalog_version, "offer-v2");
    assert.equal(pro.catalog_version, "offer-v3");
    assert.equal(pro.monthly_credits, 700);
    const accidentalRewrite = config(catalog({ version: "offer-v3" }));
    await assert.rejects(ensureBillingPriceCatalog({ repository: f.reopen(), config: accidentalRewrite }), { code: "billing_price_contract_conflict" });
  });

  regression("rejects redefinition before provider calls or webhook receipts", async (t) => {
    const f = await fixture(t, adapter);
    await ensureBillingPriceCatalog({ repository: f.repository, config: config(catalog()) });
    const changed = config(catalog({ version: "offer-v3", prices: [offer({ monthly_credits: 999 })] }));
    let calls = 0;
    const providers = { readiness: () => ({ stripe: { configured: true, checkout_ready: true } }), execute: async () => { calls += 1; throw new Error("must not call provider"); } };
    await assert.rejects(createCreditCheckout({ repository: f.reopen(), config: changed, providers, user: f.user, idempotencyKey: "conflict" }), { code: "billing_price_contract_conflict" });
    await assert.rejects(deliver({ repository: f.reopen(), value: changed, id: "evt_conflicting_contract", type: "invoice.paid", object: invoice(f.user, changed, "price_builder_new") }), { code: "billing_price_contract_conflict" });
    assert.equal(calls, 0);
    assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0);
    if (adapter === "postgres") assert.equal((await f.repository.pool.query("SELECT count(*)::int AS count FROM iabt_stripe_events")).rows[0].count, 0);
    else assert.equal(f.repository.stripeEvents.size, 0);
  });
}

test("Checkout freezes the selected contract and legacy pending sessions keep their exact provider parameters", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "checkout-price@example.test", passwordHash: "unused", emailVerified: true });
  const calls = [];
  const providers = { readiness: () => ({ stripe: { checkout_ready: true } }), execute: async (_provider, _operation, payload, context) => {
    calls.push({ params: structuredClone(payload.params), key: context.idempotencyKey });
    return { data: { id: "cs_test_" + calls.length, url: "https://checkout.stripe.test/fixture", mode: "subscription", livemode: false, status: "open",
      expires_at: Number(payload.params.expires_at), client_reference_id: payload.params.client_reference_id,
      metadata: Object.fromEntries(Object.entries(payload.params).filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value])) } };
  } };
  const create = (value, owner = user) => createSubscriptionCheckout({ repository, config: value, providers, user: owner, plan: "builder", idempotencyKey: randomUUID() });
  const old = await create(config());
  let [attempt] = await repository.listRecords("BillingCheckoutAttempt", user);
  assert.equal(attempt.price_contract.monthly_credits, 100);
  assert.equal(calls[0].params["metadata[billing_catalog_version]"], undefined);
  await repository.updateRecord("BillingCheckoutAttempt", attempt.id, user, { price_contract: null });
  assert.equal((await create(config())).session_id, old.session_id);
  [attempt] = await repository.listRecords("BillingCheckoutAttempt", user);
  assert.equal(attempt.price_contract.catalog_version, "legacy-v1");
  assert.equal(calls.length, 1, "attributing a pre-registry attempt must not repeat Stripe POST");
  const nextUser = await repository.createUser({ email: "new-price@example.test", passwordHash: "unused", emailVerified: true });
  const value = config(catalog());
  await create(value, nextUser);
  const [newAttempt] = await repository.listRecords("BillingCheckoutAttempt", nextUser);
  assert.equal(newAttempt.price_contract.monthly_credits, 150);
  assert.equal(calls[1].params["metadata[billing_catalog_version]"], "offer-v2");
  assert.equal(calls[1].params["subscription_data[metadata][billing_contract_sha256]"], newAttempt.price_contract.contract_sha256);
  await assert.rejects(create(config(catalog({ prices: [offer({ monthly_credits: 999 })] })), nextUser), { code: "billing_price_contract_conflict" });
  assert.equal(calls.length, 2);
});

test("runtime refuses changed registered terms before initializing external storage", { skip: !databaseUrl, timeout: 30000 }, async (t) => {
  const f = await fixture(t, "postgres");
  await ensureBillingPriceCatalog({ repository: f.repository, config: config(catalog()) });
  const value = config(catalog({ version: "offer-v3", prices: [offer({ monthly_credits: 999 })] }), { IABT_DATABASE_URL: f.scopedUrl.href, IABT_STORAGE_PROVIDER: "s3" });
  await assert.rejects(createRuntime({ config: value }), { code: "billing_price_contract_conflict" });
});
