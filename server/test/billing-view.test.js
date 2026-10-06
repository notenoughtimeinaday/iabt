import assert from "node:assert/strict";
import { test } from "node:test";
import { billingViewState } from "../../src/lib/billing-state.js";
import { IABT_PLANS, billingPlanCards, purchasedPlanSummary } from "../../src/lib/pricing.js";
import { PLAN_DEFAULTS } from "../src/billing/plans.js";

test("standalone readiness enables configured checkout and displays actual server credit balance/pack size", () => {
  const view = billingViewState({ plan: "pro", credits_remaining: 47 }, { checkout_ready: true, configured: true, mode: "test", credit_pack_size: 75 });
  assert.equal(view.checkoutReady, true);
  assert.equal(view.credits, 47);
  assert.equal(view.creditPackSize, 75);
  assert.equal(view.mode, "test");
  assert.equal(billingViewState({}, { ready: true, mode: "live" }).checkoutReady, true);
  assert.equal(billingViewState({}, { ready: true, checkout_ready: false }).checkoutReady, false);
  assert.equal(billingViewState({}, null).checkoutReady, false);
  assert.equal(billingViewState({}, null).loaded, false);
});

test("new sale cards do not relabel a legacy subscriber or replace a purchased allowance", () => {
  const legacy = { plan: "builder", ai_monthly_limit: 100, billing_price_contract: { catalog_version: "legacy-v1", monthly_credits: 100 } };
  const status = { new_offers_enabled: true, offers: [{ id: "builder-2026-10", name: "Builder", plan: "builder", amount_cents: 2900,
    renewal_amount_cents: 2900, monthly_credits: 300, project_limit: 5, static_zip_export_enabled: true }] };
  assert.equal(billingPlanCards(status)[1].monthlyAiCredits, 300);
  assert.equal(purchasedPlanSummary(legacy).monthlyCredits, 100);
  assert.equal(purchasedPlanSummary(legacy).legacy, true);
  assert.equal(billingPlanCards({ new_offers_enabled: false, offers: status.offers }), IABT_PLANS);
  assert.deepEqual(billingPlanCards({ new_offers_enabled: true, offers: [] }).map((p) => p.id), ["free"]);
  assert.equal(purchasedPlanSummary({ ...legacy, plan: "free", status: "canceled" }).monthlyCredits, 0);
});

test("unpaid subscribers retain billing management when checkout is disabled", () => {
  const entitlement = { billing_provider: "stripe", provider_customer_id: "cus_existing", provider_subscription_id: "sub_existing", status: "unpaid" };
  const view = billingViewState(entitlement, { configured: true, checkout_ready: false });
  assert.equal(view.hasSubscription, true);
  assert.equal(view.portalReady, true);
  assert.equal(view.checkoutReady, false);
  assert.equal(view.needsPaymentAttention, true);
  assert.equal(billingViewState({ ...entitlement, status: "canceled" }, {}).hasSubscription, false);
});

test("advertised paid monthly credits agree with fulfillment and Free promises a starter allowance", () => {
  for (const plan of IABT_PLANS.filter((row) => row.id !== "free")) {
    assert.equal(plan.monthlyAiCredits, PLAN_DEFAULTS[plan.id].ai_monthly_limit);
    assert.equal(plan.projectLimit, PLAN_DEFAULTS[plan.id].project_limit);
  }
  assert.equal(IABT_PLANS[0].monthlyAiCredits, 0);
  assert.equal(IABT_PLANS[0].starterAiCredits, 10);
});
