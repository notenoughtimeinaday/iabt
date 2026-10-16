import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";

test("restricted Stripe keys pass configuration checks only in the matching mode without a live probe", () => {
  for (const [mode, key, ready] of [["test", "rk_test_fixture", true], ["live", "rk_live_fixture", true], ["live", "rk_test_fixture", false], ["test", "rk_live_fixture", false], ["test", "pk_test_fixture", false]]) {
    const config = loadConfig({ NODE_ENV: "test", IABT_STRIPE_MODE: mode, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_BUILDER_PRICE_ID: "price_builder", STRIPE_PRO_PRICE_ID: "price_pro", STRIPE_AGENCY_PRICE_ID: "price_agency", STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_credits" });
    const registry = createProviderRegistry(config, { fetchImpl: () => { throw new Error("Readiness must not call Stripe"); } });
    assert.equal(registry.readiness().stripe.checkout_ready, ready);
    assert.equal(registry.readiness().stripe.configured, ready);
  }
});

test("Stripe POST uses a bounded non-redirecting transport and preserves retry identity", async () => {
  const config = loadConfig({ NODE_ENV: "test", STRIPE_SECRET_KEY: "rk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture" });
  const calls = [];
  const registry = createProviderRegistry(config, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    assert.equal(options.headers["Stripe-Version"], "2026-08-26.dahlia");
    assert.equal(options.headers["Idempotency-Key"], "same-checkout-attempt");
    if (calls.length === 1) throw new DOMException("Transport timed out", "TimeoutError");
    return { ok: true, json: async () => ({ id: "cs_test_fixture", url: "https://checkout.stripe.com/fixture" }) };
  } });
  const payload = { path: "/checkout/sessions", params: { mode: "subscription", "line_items[0][price]": "price_fixture" } };
  const context = { idempotencyKey: "same-checkout-attempt", approval: { approved: true, approval_id: "fixture", max_cost_cents: 0 } };
  await assert.rejects(registry.execute("stripe", "post", payload, context), { name: "TimeoutError" });
  assert.equal(calls.length, 1, "The provider transport does not silently replay a timed-out POST");
  await registry.execute("stripe", "post", payload, context);
  assert.equal(String(calls[0].options.body), String(calls[1].options.body));
  assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
});
