import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createServer } from "node:http";
import pg from "pg";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { ensureBillingPriceCatalog } from "../src/billing/price-catalog.js";
import { createSubscriptionCheckout, pendingOfferSummary } from "../src/billing/stripe-checkout.js";
import { processStripeWebhook } from "../src/billing/stripe-webhook.js";
import { introEligibility } from "../src/billing/intro-eligibility.js";
import { OFFER_CATALOG_VERSION, OFFER_TERMS_VERSION, INTRO_OFFER_ID, publicBillingOffers, probeOfferProviderTerms } from "../src/billing/offers.js";
import { createProjectsWithinQuota } from "../src/billing/project-quota.js";
import { PLAN_DEFAULTS } from "../src/billing/plans.js";
import { createIabtHandler } from "../src/app.js";
import { createOpaqueToken, hashToken } from "../src/security.js";

const env = { NODE_ENV: "test", IABT_AUTH_SECRET: "offers-fixture", STRIPE_SECRET_KEY: "rk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  STRIPE_BUILDER_PRICE_ID: "price_old_builder", STRIPE_PRO_PRICE_ID: "price_old_pro", STRIPE_AGENCY_PRICE_ID: "price_old_agency", STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_pack",
  IABT_STRIPE_ACCOUNT_ID: "acct_fixture", IABT_NEW_OFFERS_ENABLED: "true", IABT_MEET_JERICHO_ENABLED: "true", IABT_NEW_OFFER_TERMS_VERSION: OFFER_TERMS_VERSION,
  IABT_MEET_JERICHO_COUPON_ID: "coupon_intro", IABT_STRIPE_STARTER_PRICE_ID: "price_new_starter", IABT_STRIPE_BUILDER_V2_PRICE_ID: "price_new_builder", IABT_STRIPE_PRO_V2_PRICE_ID: "price_new_pro",
  IABT_STRIPE_PRICE_CATALOG_JSON: JSON.stringify({ version: OFFER_CATALOG_VERSION, prices: [
    { price_id: "price_new_starter", plan: "starter", monthly_credits: 100 },
    { price_id: "price_new_builder", plan: "builder", monthly_credits: 300 },
    { price_id: "price_new_pro", plan: "pro", monthly_credits: 650 }
  ] }) };
const configFor = (overrides = {}) => loadConfig({ ...env, ...overrides });
const databaseUrl = process.env.IABT_AUTH_TEST_DATABASE_URL;

async function fixture(t, adapter = "memory") {
  let repository, reopen;
  if (adapter === "memory") { repository = new MemoryRepository(); reopen = () => repository; }
  else {
    const url = new URL(databaseUrl);
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.equal(url.search, ""); assert.equal(url.hash, "");
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
    const schema = "billing_offers_test_" + randomUUID().replaceAll("-", "");
    const control = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
    const instances = [];
    reopen = () => { const r = new PostgresRepository({ pool: new pg.Pool({ connectionString: databaseUrl,
      options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis: 5000 }) }); instances.push(r); return r; };
    repository = reopen();
    t.after(async () => { await Promise.all(instances.map((r) => r.close()));
      try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await control.end(); } });
    await control.query(`CREATE SCHEMA ${schema}`);
    await repository.ready();
  }
  const user = await repository.createUser({ email: "offer-owner@example.test", passwordHash: "unused", emailVerified: true });
  const config = configFor();
  const calls = [], reads = [], sessions = new Map(), keys = new Map();
  let now = Date.now(), transform = (value) => value, beforeReturn = () => {};
  const providers = {
    readiness: () => ({ stripe: { configured: true, checkout_ready: true } }),
    fetch: async (url, options) => {
      reads.push(url);
      assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers["Stripe-Version"], "2026-08-26.dahlia");
      const id = new URL(url).pathname.split("/").at(-1);
      let result;
      if (id === "account") result = { id: "acct_fixture" };
      else if (id.startsWith("price_")) result = { id, livemode: false, active: true, currency: "usd", type: "recurring",
        billing_scheme: "per_unit", unit_amount: { price_new_starter: 1200, price_new_builder: 2900, price_new_pro: 5900 }[id],
        recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }, product: "prod_" + id };
      else if (id === "coupon_intro") {
        assert.equal(new URL(url).searchParams.get("expand[]"), "applies_to");
        result = { id, livemode: false, valid: true, duration: "once", amount_off: 701, currency: "usd", applies_to: { products: ["prod_price_new_starter"] } };
      }
      else result = sessions.get(id);
      return { ok: Boolean(result), json: async () => transform(structuredClone(result)) };
    },
    execute: async (_provider, _operation, payload, context) => {
      calls.push({ ...structuredClone(payload), key: context.idempotencyKey });
      if (payload.path === "/billing_portal/sessions") return { data: { url: "https://billing.stripe.test/session" } };
      const previous = keys.get(context.idempotencyKey);
      if (previous) assert.deepEqual(previous.params, payload.params);
      else {
        const params = payload.params, id = "cs_test_" + randomUUID().replaceAll("-", "");
        const metadata = Object.fromEntries(Object.entries(params).filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
        sessions.set(id, { id, mode: "subscription", status: "open", livemode: false, url: "https://checkout.stripe.test/" + id,
          client_reference_id: params.client_reference_id, expires_at: Number(params.expires_at), metadata, customer: params.customer || null });
        keys.set(context.idempotencyKey, { id, params: structuredClone(params) });
      }
      await beforeReturn(calls.length);
      return { data: structuredClone(sessions.get(keys.get(context.idempotencyKey).id)) };
    }
  };
  const create = (overrides = {}) => createSubscriptionCheckout({ repository, user, config, providers,
    offerId: INTRO_OFFER_ID, acceptance: { accepted: true, version: OFFER_TERMS_VERSION }, now: () => now, ...overrides });
  const row = async () => (await repository.listRecordsExact("BillingCheckoutAttempt", user, { limit: 1 }))[0];
  const deliver = async (invoice, id = "evt_" + randomUUID().replaceAll("-", ""), value = config) => {
    const seconds = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ id, type: "invoice.paid", livemode: false, data: { object: invoice } });
    const signature = createHmac("sha256", value.providers.stripe.webhookSecret).update(seconds + "." + rawBody).digest("hex");
    return processStripeWebhook({ repository, config: value, rawBody, signatureHeader: `t=${seconds},v1=${signature}`, nowSeconds: seconds });
  };
  return { repository, reopen, user, config, providers, calls, reads, sessions, create, row, deliver,
    advance: (ms) => { now += ms; }, transform: (fn) => { transform = fn; }, hook: (fn) => { beforeReturn = fn; } };
}

const invoiceFor = (user, price, metadata = {}, start = 1788523200) => ({ id: "in_" + randomUUID().replaceAll("-", ""), status: "paid",
  currency: "usd", customer: "cus_fixture", billing_reason: "subscription_create",
  parent: { subscription_details: { subscription: "sub_" + price, metadata: { iabt_app_id: "6a849bcd3e04d068553b4af7", user_id: user.id, user_email: user.email, ...metadata } } },
  lines: { data: [{ amount: 1200, quantity: 1, type: "subscription", price: { id: price }, period: { start, end: start + 30 * 86400 } }] } });

test("new offers require explicit test activation and accepted terms; no live activation is possible", async (t) => {
  const f = await fixture(t);
  assert.equal(publicBillingOffers(loadConfig({ NODE_ENV: "test" })).length, 0);
  for (const overrides of [{ IABT_NEW_OFFERS_ENABLED: "false" }, { IABT_NEW_OFFER_TERMS_VERSION: "" }, { IABT_NEW_OFFER_TERMS_VERSION: "old" },
    { IABT_STRIPE_MODE: "live", STRIPE_SECRET_KEY: "rk_live_fixture" }]) {
    const config = configFor(overrides);
    assert.deepEqual(publicBillingOffers(config), []);
    await assert.rejects(f.create({ repository: new MemoryRepository(), config }), { code: "billing_offer_disabled" });
  }
  assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0);
  assert.deepEqual(publicBillingOffers(f.config).map((x) => [x.name, x.amount_cents, x.monthly_credits]),
    [["Meet Jericho", 499, 100], ["Starter", 1200, 100], ["Builder", 2900, 300], ["Pro", 5900, 650]]);
  assert.ok(publicBillingOffers(f.config).every((offer) => offer.commercial_use_enabled));
});

test("missing or stale disclosure fails before provider calls; wrong prices, accounts and coupons fail before Checkout", async (t) => {
  const f = await fixture(t);
  for (const acceptance of [null, {}, { accepted: false, version: OFFER_TERMS_VERSION }, { accepted: true, version: "stale" }]) {
    await assert.rejects(f.create({ acceptance }), { code: "billing_disclosure_required" });
  }
  assert.equal(f.reads.length, 0);
  for (const [transform, code] of [
    [(x) => x.id === "acct_fixture" ? { id: "acct_other" } : x, "billing_offer_account_mismatch"],
    [(x) => x.type === "recurring" ? { ...x, unit_amount: 499 } : x, "billing_offer_price_mismatch"],
    [(x) => x.type === "recurring" ? { ...x, currency: "eur" } : x, "billing_offer_price_mismatch"],
    [(x) => x.type === "recurring" ? { ...x, recurring: { ...x.recurring, interval: "year" } } : x, "billing_offer_price_mismatch"],
    [(x) => x.id === "coupon_intro" ? { ...x, duration: "forever" } : x, "billing_offer_discount_mismatch"],
    [(x) => x.id === "coupon_intro" ? { ...x, applies_to: { products: ["prod_wrong"] } } : x, "billing_offer_discount_mismatch"]
  ]) { f.transform(transform); await assert.rejects(f.create(), { code }); }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.repository.listRecords("BillingOfferAcceptance", f.user), []);
});

test("legacy plan requests cannot bypass versioned offer acceptance through a checkout selector", async (t) => {
  const f = await fixture(t);
  const catalog = JSON.parse(env.IABT_STRIPE_PRICE_CATALOG_JSON);
  catalog.checkout = { builder: "price_new_builder" };
  await assert.rejects(f.create({ offerId: "", plan: "builder", config: configFor({ IABT_STRIPE_PRICE_CATALOG_JSON: JSON.stringify(catalog) }) }), { code: "billing_offer_required" });
  assert.equal(f.calls.length, 0);
});

for (const adapter of ["memory", "postgres"]) {
  const regression = (name, fn) => test(`${adapter}: new offers ${name}`, { skip: adapter === "postgres" && !databaseUrl, timeout: 30000 }, fn);

  regression("grant commercial rights by purchased version without changing legacy rights or cancellation", async (t) => {
    const f = await fixture(t, adapter);
    for (const [price, commercial, react, credits] of [
      ["price_old_builder", false, false, 100], ["price_new_starter", true, false, 100],
      ["price_new_builder", true, false, 300], ["price_new_pro", true, true, 650]
    ]) {
      const user = await f.repository.createUser({ email: price + "@example.test", passwordHash: "unused", emailVerified: true });
      const subscription = { id: "sub_" + price, customer: "cus_" + price, status: "active", livemode: false,
        metadata: { iabt_app_id: f.config.providers.stripe.metadataAppId, user_id: user.id, user_email: user.email },
        items: { data: [{ price: { id: price } }] } };
      const deliver = async (status) => {
        subscription.status = status;
        const seconds = Math.floor(Date.now() / 1000);
        const rawBody = JSON.stringify({ id: "evt_" + price + "_" + status, type: "customer.subscription.updated", livemode: false, data: { object: subscription } });
        const signature = createHmac("sha256", f.config.providers.stripe.webhookSecret).update(seconds + "." + rawBody).digest("hex");
        return processStripeWebhook({ repository: f.repository, config: f.config, rawBody, signatureHeader: `t=${seconds},v1=${signature}`,
          nowSeconds: seconds, fetchImpl: async () => ({ ok: true, json: async () => subscription }) });
      };
      assert.equal((await deliver("active")).credits_granted, 0);
      const [entitlement] = await f.reopen().listRecordsExact("AccountEntitlement", user, { limit: 1 });
      assert.equal(entitlement.commercial_use_enabled, commercial);
      assert.equal(entitlement.react_export_enabled, react);
      assert.equal(entitlement.white_label_exports_enabled, false);
      assert.equal(entitlement.ai_monthly_limit, credits);
      await deliver("canceled");
      const [canceled] = await f.reopen().listRecordsExact("AccountEntitlement", user, { limit: 1 });
      assert.equal(canceled.plan, "free");
      assert.equal(canceled.commercial_use_enabled, false);
    }
    assert.equal(PLAN_DEFAULTS.builder.commercial_use_enabled, false);
  });

  regression("preserve all legacy contracts, capabilities and balances while adding monthly allowances", async (t) => {
    const f = await fixture(t, adapter);
    const old = configFor({ IABT_STRIPE_PRICE_CATALOG_JSON: "", IABT_NEW_OFFERS_ENABLED: "false" });
    await ensureBillingPriceCatalog({ repository: f.repository, config: old });
    const original = await Promise.all(old.providers.stripe.priceContracts.map((x) => f.repository.getBillingPriceContract({ mode: "test", priceId: x.price_id })));
    await ensureBillingPriceCatalog({ repository: f.repository, config: f.config });
    await f.repository.grantCredits({ ownerId: f.user.id, amount: 17, idempotencyKey: "prior-balance", metadata: {} });
    for (const [price, credits] of [["price_old_builder", 100], ["price_old_pro", 500], ["price_old_agency", 2000], ["price_new_starter", 100], ["price_new_builder", 300], ["price_new_pro", 650]]) {
      const invoice = invoiceFor(f.user, price);
      const before = (await f.repository.getCreditAccount(f.user.id)).available_credits;
      assert.equal((await f.deliver(invoice)).credits_granted, credits);
      assert.equal((await f.deliver(invoice)).credits_granted, 0);
      assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, before + credits);
    }
    const reopened = f.reopen();
    await ensureBillingPriceCatalog({ repository: reopened, config: old });
    assert.deepEqual(await Promise.all(original.map((x) => reopened.getBillingPriceContract({ mode: "test", priceId: x.price_id }))), original);
    assert.equal((await reopened.getBillingPriceContract({ mode: "test", priceId: "price_new_pro" })).monthly_credits, 650);
    assert.deepEqual([PLAN_DEFAULTS.builder.ai_monthly_limit, PLAN_DEFAULTS.pro.ai_monthly_limit, PLAN_DEFAULTS.agency.ai_monthly_limit], [100, 500, 2000]);
    assert.deepEqual([PLAN_DEFAULTS.builder.project_limit, PLAN_DEFAULTS.pro.project_limit, PLAN_DEFAULTS.agency.team_seat_limit], [5, 25, 5]);
  });

  regression("reserve one introductory purchase across instances and freeze disclosure/discount on retry", async (t) => {
    const f = await fixture(t, adapter);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => f.create({ repository: i % 2 ? f.reopen() : f.repository })));
    assert.equal(new Set(results.map((x) => x.session_id)).size, 1);
    assert.equal(f.calls.length, 1);
    const params = f.calls[0].params;
    assert.equal(params["line_items[0][price]"], "price_new_starter");
    assert.equal(params["discounts[0][coupon]"], "coupon_intro");
    assert.equal(params.allow_promotion_codes, undefined);
    assert.match(params["custom_text[submit][message]"], /automatically renews as Starter at \$12/);
    assert.equal((await f.repository.listRecords("BillingIntroClaim", f.user)).length, 1);
    const acceptances = await f.repository.listRecords("BillingOfferAcceptance", f.user);
    assert.equal(acceptances.length, 1); assert.equal(acceptances[0].amount_cents, 499);
    assert.equal(acceptances[0].entitlements.commercial_use_enabled, true);
    assert.equal(acceptances[0].entitlements.react_export_enabled, false);
    assert.equal(acceptances[0].renewal_amount_cents, 1200); assert.ok(acceptances[0].accepted_at);
    assert.equal((await f.create({ repository: f.reopen(), config: configFor({ IABT_NEW_OFFERS_ENABLED: "false" }) })).session_id, results[0].session_id);
    assert.equal(f.calls.length, 1);
  });

  regression("an ambiguous provider result resumes identical terms without reopening eligibility", async (t) => {
    const f = await fixture(t, adapter);
    f.hook((n) => { if (n === 1) throw new Error("timeout"); });
    await assert.rejects(f.create(), { code: "stripe_checkout_unavailable" });
    assert.equal((await introEligibility(f)).reason, "purchase_pending");
    await f.create({ repository: f.reopen(), config: configFor({ IABT_NEW_OFFERS_ENABLED: "false" }) });
    assert.equal(f.sessions.size, 1);
    assert.equal(f.calls[0].key, f.calls[1].key); assert.deepEqual(f.calls[0].params, f.calls[1].params);
  });

  regression("Stripe-confirmed expiry releases eligibility but a disabled offer cannot create a replacement", async (t) => {
    const f = await fixture(t, adapter);
    const checkout = await f.create();
    f.advance(32 * 60 * 1000);
    const session = f.sessions.get(checkout.session_id);
    await assert.rejects(f.create(), { code: "stripe_checkout_reconciliation_required" });
    assert.equal((await introEligibility(f)).reason, "purchase_pending");
    session.status = "expired";
    await assert.rejects(f.create({ config: configFor({ IABT_NEW_OFFERS_ENABLED: "false" }) }), { code: "billing_offer_disabled" });
    assert.equal((await introEligibility(f)).eligible, true);
    assert.equal(f.calls.length, 1);
    const replacement = await f.create();
    assert.notEqual(replacement.session_id, checkout.session_id);
  });

  regression("introductory payment and regular renewal each grant once; cancellation does not reset eligibility", async (t) => {
    const f = await fixture(t, adapter);
    const checkout = await f.create();
    const metadata = f.sessions.get(checkout.session_id).metadata;
    const invoice = { ...invoiceFor(f.user, "price_new_starter", metadata), amount_paid: 499, total_discount_amounts: [{ amount: 701 }] };
    assert.equal((await f.deliver({ ...invoice, status: "open" })).credits_granted, 0);
    assert.equal((await introEligibility(f)).reason, "purchase_pending");
    assert.equal((await f.deliver(invoice)).credits_granted, 100);
    assert.equal((await f.deliver(invoice)).credits_granted, 0);
    assert.equal((await introEligibility({ ...f, repository: f.reopen() })).reason, "already_redeemed");
    const renewal = invoiceFor(f.user, "price_new_starter", metadata, 1788523200 + 30 * 86400);
    renewal.billing_reason = "subscription_cycle"; renewal.amount_paid = 1200;
    assert.equal((await f.deliver(renewal, undefined, configFor({ IABT_NEW_OFFERS_ENABLED: "false" }))).credits_granted, 100);
    assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 200);
    await f.repository.createRecord("AccountEntitlement", f.user, { user_id: f.user.id, plan: "free", status: "canceled", billing_provider: "stripe", provider_customer_id: "cus_fixture", provider_subscription_id: "sub_price_new_starter" });
    f.sessions.get(checkout.session_id).status = "complete";
    f.sessions.get(checkout.session_id).subscription = "sub_price_new_starter";
    f.advance(32 * 60 * 1000);
    await assert.rejects(f.create(), { code: "billing_intro_ineligible" });
    assert.equal(f.calls.length, 1);
  });

  regression("previous paid subscriptions and unknown history are ineligible; top-up-only accounts remain eligible", async (t) => {
    const f = await fixture(t, adapter);
    await f.repository.createRecord("BillingFulfillment", f.user, { user_id: f.user.id, billing_mode: "test", product_type: "ai_credit_pack", status: "granted" });
    assert.equal((await introEligibility(f)).eligible, true);
    await f.repository.createRecord("BillingFulfillment", f.user, { user_id: f.user.id, billing_mode: "test", product_type: "subscription_allowance", status: "granted" });
    await assert.rejects(f.create(), { code: "billing_intro_ineligible" });
    const other = await f.repository.createUser({ email: "history-unknown@example.test", passwordHash: "unused", emailVerified: true });
    await f.repository.createRecord("AccountEntitlement", other, { user_id: other.id, plan: "free", status: "canceled", billing_provider: "stripe" });
    assert.equal((await introEligibility({ ...f, user: other })).reason, "history_requires_reconciliation");
    assert.equal(f.calls.length, 0);
  });

  regression("Starter capacity is enforced while legacy Agency capacity is preserved", async (t) => {
    const f = await fixture(t, adapter);
    await f.repository.createRecord("AccountEntitlement", f.user, { user_id: f.user.id, plan: "starter", status: "active", project_limit: 0 });
    const results = await Promise.allSettled([f.repository, f.reopen()].map((repository) => createProjectsWithinQuota({ repository, user: f.user, inputs: [{ title: "One project" }] })));
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(results.find((x) => x.status === "rejected").reason.code, "project_limit_reached");
    assert.equal(PLAN_DEFAULTS.agency.project_limit, 0);
  });

  regression("definite rejected Checkout releases its unpayable intro reservation", async (t) => {
    const f = await fixture(t, adapter);
    const execute = f.providers.execute;
    f.providers.execute = async () => { throw Object.assign(new Error("request rejected"), { code: "stripe_invalid_request", status: 400 }); };
    await assert.rejects(f.create(), { code: "stripe_checkout_unavailable" });
    assert.equal((await introEligibility(f)).eligible, true);
    f.providers.execute = execute;
    await f.create();
    assert.equal(f.sessions.size, 1);
  });

  regression("interruption after intro redemption resumes fulfillment once and reused customers cannot redeem for another owner", async (t) => {
    const f = await fixture(t, adapter);
    const checkout = await f.create();
    const metadata = f.sessions.get(checkout.session_id).metadata;
    const invoice = invoiceFor(f.user, "price_new_starter", metadata);
    const grant = f.repository.grantCredits.bind(f.repository);
    let crash = true;
    f.repository.grantCredits = async (args) => { if (crash) { crash = false; throw new Error("simulated interruption"); } return grant(args); };
    await assert.rejects(f.deliver(invoice));
    assert.equal((await introEligibility(f)).reason, "already_redeemed");
    assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 0);
    assert.equal((await f.deliver(invoice)).credits_granted, 100);
    assert.equal((await f.deliver(invoice)).credits_granted, 0);
    const other = await f.repository.createUser({ email: "other-customer-owner@example.test", passwordHash: "unused", emailVerified: true });
    const second = await f.create({ user: other });
    await assert.rejects(f.deliver(invoiceFor(other, "price_new_starter", f.sessions.get(second.session_id).metadata)), { code: "billing_intro_reconciliation_required" });
    assert.equal((await f.repository.getCreditAccount(other.id)).available_credits, 0);
  });
}

test("persisted request key order cannot change accepted new-offer terms", async (t) => {
  for (const ambiguous of [false, true]) {
    const f = await fixture(t);
    if (ambiguous) {
      f.hook((n) => { if (n === 1) throw new Error("timeout"); });
      await assert.rejects(f.create(), { code: "stripe_checkout_unavailable" });
    } else await f.create();
    const row = await f.row();
    // PostgreSQL JSONB does not retain JavaScript object insertion order.
    await f.repository.updateRecord("BillingCheckoutAttempt", row.id, f.user, {
      request_params: Object.fromEntries(Object.entries(row.request_params).reverse())
    });
    const resumed = await f.create({ config: configFor({ IABT_NEW_OFFERS_ENABLED: "false" }) });
    assert.equal(resumed.session_id, [...f.sessions.keys()][0]);
    assert.equal(f.sessions.size, 1);
    if (ambiguous) {
      assert.equal(f.calls[0].key, f.calls[1].key);
      assert.deepEqual(f.calls[0].params, f.calls[1].params);
    }
  }
});

test("pending offer summary contains disclosure without provider secrets or mutable checkout parameters", async (t) => {
  const f = await fixture(t);
  await f.create();
  const pending = await pendingOfferSummary(f);
  assert.deepEqual(Object.keys(pending).sort(), ["disclosure", "disclosure_version", "id"]);
  assert.equal(pending.id, INTRO_OFFER_ID);
});

test("authenticated billing offers require versioned acceptance and private claims cannot be read or changed through generic APIs", async (t) => {
  const f = await fixture(t);
  const token = createOpaqueToken();
  await f.repository.createSession({ userId: f.user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600000).toISOString() });
  const server = createServer(createIabtHandler({ repository: f.repository, config: f.config, providers: f.providers }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body = {}, authorized = true) => {
    const response = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request("/v1/functions/get-account-entitlement", {}, false)).status, 401);
  const state = await request("/v1/functions/get-account-entitlement");
  assert.equal(state.status, 200); assert.equal(state.body.data.billing.offers.length, 4);
  assert.equal(state.body.data.billing.intro_eligibility.eligible, true);
  const bad = await request("/v1/functions/stripe-create-checkout", { offer_id: INTRO_OFFER_ID, credits: 999999, price_id: "price_free" });
  assert.equal(bad.status, 409); assert.equal(bad.body.error, "billing_disclosure_required");
  assert.equal(f.calls.length, 0);
  const good = await request("/v1/functions/stripe-create-checkout", { offer_id: INTRO_OFFER_ID,
    disclosure_acceptance: { accepted: true, version: OFFER_TERMS_VERSION }, credits: 999999, price_id: "price_free" });
  assert.equal(good.status, 200);
  assert.equal(f.calls[0].params["line_items[0][price]"], "price_new_starter");
  for (const entity of ["BillingIntroClaim", "BillingIntroCustomer", "BillingOfferAcceptance"]) {
    for (const operation of ["", "/list", "/filter"]) {
      const result = await request(`/v1/entities/${entity}${operation}`, { status: "released", accepted: true });
      assert.equal(result.status, 404);
    }
  }
  const other = await f.repository.createUser({ email: "offer-other@example.test", passwordHash: "unused", emailVerified: true });
  assert.equal(await pendingOfferSummary({ ...f, user: other }), null);
  assert.equal((await introEligibility({ ...f, user: other })).eligible, true);
});


test("verification diagnostics identify each failed GET without Checkout or secret disclosure", async (t) => {
  for (const [path, endpoint] of [["/account", "/v1/account"], ["/prices/", "/v1/prices/:id"], ["/coupons/", "/v1/coupons/:id"]]) {
    for (const failure of ["http", "timeout", "network", "invalid_response"]) {
      const f = await fixture(t);
      const good = f.providers.fetch;
      f.providers.fetch = async (url, options) => {
        if (!url.includes(path)) return good(url, options);
        if (failure === "timeout") throw Object.assign(new Error("secret provider timeout"), { name: "TimeoutError" });
        if (failure === "network") throw new Error("secret network details");
        return { ok: failure !== "http", status: failure === "http" ? 403 : 200,
          headers: new Headers({ "request-id": "req_fixture123" }),
          json: async () => {
            if (failure === "invalid_response") throw new SyntaxError("secret response body");
            return { error: { type: "invalid_request_error", code: "secret_code", message: "secret permissions and credential" } };
          } };
      };
      await assert.rejects(f.create(), (error) => {
        assert.equal(error.code, "billing_offer_verification_failed"); assert.equal(error.status, 503);
        assert.deepEqual(error.billingVerification, { endpoint, failure,
          http_status: ["http", "invalid_response"].includes(failure) ? (failure === "http" ? 403 : 200) : null,
          stripe_request_id: ["http", "invalid_response"].includes(failure) ? "req_fixture123" : null,
          stripe_error_type: failure === "http" ? "invalid_request_error" : null, stripe_error_code: null });
        assert.doesNotMatch(JSON.stringify(error), /secret|rk_test|price_new|coupon_intro/);
        return true;
      });
      assert.equal(f.calls.length, 0);
      for (const entity of ["BillingCheckoutAttempt", "BillingOfferAcceptance", "BillingIntroClaim"])
        assert.deepEqual(await f.repository.listRecords(entity, f.user), []);
    }
  }
});

test("verification preserves HTTP status for malformed errors and rejects unsafe diagnostic values", async (t) => {
  const f = await fixture(t);
  for (const body of [null, { error: { type: "rk_test_secret", code: "resource_missing", message: "private" } }]) {
    f.providers.fetch = async () => ({ ok: false, status: 404, headers: new Headers({ "request-id": "unsafe private value" }),
      json: async () => { if (!body) throw new SyntaxError("private"); return body; } });
    await assert.rejects(f.create(), (error) => {
      assert.equal(error.billingVerification.http_status, 404);
      assert.equal(error.billingVerification.failure, "http");
      assert.equal(error.billingVerification.stripe_request_id, null);
      assert.equal(error.billingVerification.stripe_error_type, null);
      assert.equal(error.billingVerification.stripe_error_code, body ? "resource_missing" : null);
      assert.doesNotMatch(JSON.stringify(error), /private|rk_test/); return true;
    });
  }
  await assert.rejects(f.create({ config: configFor({ STRIPE_SECRET_KEY: "invalid" }) }), (error) => {
    assert.equal(error.billingVerification.failure, "configuration"); return true;
  });
});

test("host probe is read-only, opt-in, test-only and retains verification guards", async (t) => {
  const f = await fixture(t);
  const run = (config = f.config, offerId = "builder-2026-10") => probeOfferProviderTerms({ config, offerId, fetchImpl: f.providers.fetch });
  assert.deepEqual(await run(f.config, ""), { status: "skipped" });
  assert.deepEqual(await run(configFor({ IABT_NEW_OFFERS_ENABLED: "false" })), { status: "skipped" });
  assert.deepEqual(await run(configFor({ IABT_STRIPE_MODE: "live", STRIPE_SECRET_KEY: "rk_live_fixture" })), { status: "skipped" });
  assert.equal(f.reads.length, 0);
  assert.deepEqual(await run(), { status: "verified" });
  assert.equal(f.reads.length, 2);
  f.transform((x) => ({ ...x, id: "acct_wrong" }));
  assert.deepEqual(await run(), { status: "failed", code: "billing_offer_account_mismatch" });
  f.providers.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { type: "authentication_error" } }) });
  const result = await run();
  assert.equal(result.status, "failed"); assert.equal(result.verification.endpoint, "/v1/account");
  assert.equal(result.verification.http_status, 401); assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.repository.listRecords("BillingCheckoutAttempt", f.user), []);
});

test("HTTP verification failure logs correlation metadata but keeps the client response generic", async (t) => {
  const f = await fixture(t);
  f.providers.fetch = async () => ({ ok: false, status: 403, headers: new Headers({ "request-id": "req_support123" }),
    json: async () => ({ error: { type: "invalid_request_error", message: "rk_test_private" } }) });
  const log = t.mock.method(console, "error", () => {});
  const token = createOpaqueToken();
  await f.repository.createSession({ userId: f.user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600000).toISOString() });
  const server = createServer(createIabtHandler({ repository: f.repository, config: f.config, providers: f.providers }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/functions/stripe-create-checkout`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ offer_id: "builder-2026-10", disclosure_acceptance: { accepted: true, version: OFFER_TERMS_VERSION } }) });
  const body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.error, "billing_offer_verification_failed");
  const record = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(record.request_id, body.request_id); assert.equal(record.endpoint, "/v1/account");
  assert.equal(record.http_status, 403); assert.equal(record.stripe_request_id, "req_support123");
  assert.doesNotMatch(JSON.stringify(body), /stripe_request_id|http_status|billingVerification|rk_test|support123/);
  assert.doesNotMatch(JSON.stringify(record), /rk_test_private/); assert.equal(f.calls.length, 0);
});
