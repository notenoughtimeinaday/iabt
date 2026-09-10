import { secrets } from "base44:runtime";
import {
  getConfiguredAiCreditPackPriceId,
  getConfiguredPriceId,
  getStripeMode,
  getStripeReadiness,
  getStripeSecretKey,
  getStripeWebhookSecret,
} from "../../shared/stripe.ts";

function classifyKey(value: string) {
  if (/^sk_test_/.test(value)) return "sk_test";
  if (/^rk_test_/.test(value)) return "rk_test";
  if (/^sk_live_/.test(value)) return "sk_live";
  if (/^rk_live_/.test(value)) return "rk_live";
  return value ? "invalid_prefix" : "missing";
}

export default async function(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const mode = getStripeMode();
  const testKey = String(secrets.get("STRIPE_TEST_SECRET_KEY") || "").trim();
  const genericKey = String(secrets.get("STRIPE_SECRET_KEY") || "").trim();
  const selectedKey = getStripeSecretKey();
  const testWebhook = String(secrets.get("STRIPE_TEST_WEBHOOK_SECRET") || "").trim();
  const genericWebhook = String(secrets.get("STRIPE_WEBHOOK_SECRET") || "").trim();
  const selectedWebhook = getStripeWebhookSecret();
  const readiness = getStripeReadiness();

  const prices = {
    builder: getConfiguredPriceId("builder"),
    pro: getConfiguredPriceId("pro"),
    agency: getConfiguredPriceId("agency"),
    credits: getConfiguredAiCreditPackPriceId(),
  };

  let stripeApiReachable = false;
  let stripeApiStatus = null as number | null;
  let stripeApiError = "";
  if (/^(sk|rk)_(test|live)_/.test(selectedKey)) {
    try {
      const response = await fetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: "Bearer " + selectedKey },
      });
      stripeApiStatus = response.status;
      stripeApiReachable = response.ok;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        stripeApiError = String(body?.error?.code || body?.error?.type || "stripe_api_rejected_key");
      }
    } catch {
      stripeApiError = "network_error";
    }
  }

  return Response.json({
    ok: true,
    mode,
    selected_key_source: mode === "test" && testKey ? "STRIPE_TEST_SECRET_KEY" : genericKey ? "STRIPE_SECRET_KEY" : "none",
    selected_key_type: classifyKey(selectedKey),
    test_key_present: Boolean(testKey),
    generic_key_present: Boolean(genericKey),
    selected_webhook_source: mode === "test" && testWebhook ? "STRIPE_TEST_WEBHOOK_SECRET" : genericWebhook ? "STRIPE_WEBHOOK_SECRET" : "none",
    selected_webhook_valid: selectedWebhook.startsWith("whsec_"),
    test_webhook_present: Boolean(testWebhook),
    generic_webhook_present: Boolean(genericWebhook),
    prices: Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, Boolean(value)])),
    readiness,
    stripe_api_reachable: stripeApiReachable,
    stripe_api_status: stripeApiStatus,
    stripe_api_error: stripeApiError || null,
  });
}
