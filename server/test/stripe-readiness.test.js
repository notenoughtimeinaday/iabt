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
