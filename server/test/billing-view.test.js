import assert from "node:assert/strict";
import { test } from "node:test";
import { billingViewState } from "../../src/lib/billing-state.js";
import { IABT_PLANS } from "../../src/lib/pricing.js";
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
