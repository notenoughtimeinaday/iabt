const PAID_SUBSCRIPTION_PLANS = new Set(["builder", "pro", "agency"]);

export function creditEligibility(plan: unknown, paidMedia: boolean) {
  const normalizedPlan = String(plan || "free").trim().toLowerCase();
  const paidSubscription = PAID_SUBSCRIPTION_PLANS.has(normalizedPlan);
  const includedCreditsEligible = !paidMedia || paidSubscription;
  return {
    plan: normalizedPlan,
    paid_subscription: paidSubscription,
    included_credits_eligible: includedCreditsEligible,
    purchased_credits_only: Boolean(paidMedia && !paidSubscription),
  };
}
