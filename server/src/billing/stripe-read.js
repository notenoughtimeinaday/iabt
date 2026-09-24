const failure = () => Object.assign(new Error("Stripe subscription verification is temporarily unavailable"), {
  status: 503, code: "stripe_subscription_unavailable", retryable: true
});

export const retrieveStripeSubscription = async ({ config, subscriptionId, fetchImpl = globalThis.fetch }) => {
  if (!/^sub_[a-zA-Z0-9_]+$/.test(subscriptionId)) {
    throw Object.assign(new Error("Stripe subscription identity is invalid"), { status: 422, code: "stripe_subscription_invalid" });
  }
  const key = config.providers.stripe.secretKey;
  const mode = config.providers.stripe.mode === "live" ? "live" : "test";
  if (!new RegExp(`^[sr]k_${mode}_`).test(key)) throw failure();
  try {
    const response = await fetchImpl("https://api.stripe.com/v1/subscriptions/" + subscriptionId, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: "Bearer " + key, "Stripe-Version": "2026-08-26.dahlia" }
    });
    if (!response.ok) throw failure();
    const subscription = await response.json();
    if (subscription?.id !== subscriptionId || Boolean(subscription.livemode) !== (mode === "live")) throw failure();
    return subscription;
  } catch {
    // Never persist provider error bodies, request headers, or credentials.
    throw failure();
  }
};
