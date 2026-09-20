// Support both the standalone API and explicitly isolated legacy response shape.
export function billingViewState(entitlement, billingStatus) {
  const status = billingStatus || entitlement?.billing;
  const subscriptionStatus = String(entitlement?.status || "").toLowerCase();
  const hasSubscription = entitlement?.billing_provider === "stripe" &&
    String(entitlement?.provider_customer_id || "").startsWith("cus_") &&
    String(entitlement?.provider_subscription_id || "").startsWith("sub_") &&
    !["canceled", "incomplete_expired"].includes(subscriptionStatus);
  return {
    loaded: Boolean(status),
    mode: status?.mode === "live" ? "live" : "test",
    checkoutReady: Boolean(status?.checkout_ready ?? status?.ready),
    portalReady: Boolean(status?.configured ?? status?.ready),
    hasSubscription,
    subscriptionStatus,
    needsPaymentAttention: hasSubscription && ["past_due", "unpaid", "incomplete", "inactive", "paused"].includes(subscriptionStatus),
    creditPackSize: Number.isSafeInteger(status?.credit_pack_size) && status.credit_pack_size > 0 ? status.credit_pack_size : null,
    credits: Math.max(0, Number(entitlement?.total_iabt_credits_remaining ?? entitlement?.credits_remaining ?? entitlement?.bonus_ai_credits) || 0)
  };
}
