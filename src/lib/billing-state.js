// Never render upstream messages or infer payment outcome from a lost response.
export function billingErrorNotice(error, action = "checkout") {
  const code = error?.data?.error || error?.response?.data?.error || error?.code;
  if (["billing_offer_verification_failed", "billing_offer_account_mismatch", "billing_offer_price_mismatch", "billing_offer_discount_mismatch",
    "billing_offer_not_configured", "billing_offer_disabled", "stripe_checkout_not_ready"].includes(code)) {
    return { title: "This purchase is unavailable", message: "We couldn't verify this purchase, so checkout hasn't opened. Your existing credits remain available. Please try again after billing setup is corrected." };
  }
  if (["stripe_checkout_reconciliation_required", "stripe_checkout_terms_conflict"].includes(code)) {
    return { title: "An earlier purchase needs attention", message: "An earlier purchase must be checked before you can choose another plan. Resume that purchase if it is shown below, or contact support. Your existing credits remain available." };
  }
  if (["billing_offer_required", "billing_disclosure_required", "billing_disclosure_version_mismatch"].includes(code)) {
    return { title: "Review the current offer", message: "Reopen Plans & billing and accept the current price and renewal terms before continuing." };
  }
  if (error?.status === 401 || error?.response?.status === 401) {
    return { title: "Please sign in again", message: "Your session needs to be refreshed before you can open billing. Your saved work and credits remain in your account." };
  }
  if (action === "portal") {
    return { title: "Billing management couldn't open", message: "Please try opening billing management again. You can also contact support if the problem continues." };
  }
  return { title: "Checkout couldn't be confirmed", message: "Use the same purchase button to check again. If you already paid in Stripe, check your credits or contact support before starting another purchase." };
}

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
