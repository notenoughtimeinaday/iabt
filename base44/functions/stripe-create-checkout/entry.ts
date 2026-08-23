import { createClientFromRequest } from "npm:@base44/sdk";
import {
  getAppOrigin,
  getConfiguredPriceId,
  getStripeMode,
  getStripeReadiness,
  IABT_APP_ID,
  newIdempotencyKey,
  normalizePlan,
  stripePost,
} from "../../shared/stripe.ts";

export default async function(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    if (!user?.id || !user?.email) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const plan = normalizePlan(String(body?.plan || ""));
    if (!plan) {
      return Response.json({ error: "plan must be 'builder', 'pro', or 'agency'." }, { status: 400 });
    }

    const readiness = getStripeReadiness();
    if (!readiness.ready) {
      return Response.json(
        { error: `Stripe ${getStripeMode()} billing is not fully configured. Verify the matching key, webhook secret, and all product price IDs in Base44 Secrets.` },
        { status: 503 },
      );
    }

    const priceId = getConfiguredPriceId(plan);
    if (!priceId) {
      return Response.json({ error: plan + " checkout price is not configured." }, { status: 503 });
    }

    const existing = await base44.asServiceRole.entities.AccountEntitlement.filter(
      { user_id: user.id },
      "-updated_date",
      1,
    );
    const customerId =
      existing?.[0]?.billing_provider === "stripe"
        ? String(existing[0].provider_customer_id || "").trim()
        : "";

    const origin = getAppOrigin(req);
    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", origin + "/?billing=success&session_id={CHECKOUT_SESSION_ID}");
    params.append("cancel_url", origin + "/?billing=canceled");
    params.append("client_reference_id", user.id);
    params.append("allow_promotion_codes", "true");
    if (customerId.startsWith("cus_")) {
      params.append("customer", customerId);
    } else {
      params.append("customer_email", user.email);
    }
    params.append("metadata[base44_app_id]", IABT_APP_ID);
    params.append("metadata[plan]", plan);
    params.append("metadata[user_id]", user.id);
    params.append("metadata[user_email]", user.email);
    params.append("subscription_data[metadata][base44_app_id]", IABT_APP_ID);
    params.append("subscription_data[metadata][plan]", plan);
    params.append("subscription_data[metadata][user_id]", user.id);
    params.append("subscription_data[metadata][user_email]", user.email);

    const session = await stripePost("/checkout/sessions", params, newIdempotencyKey());
    return Response.json({ ok: true, url: session.url, session_id: session.id });
  } catch (error) {
    console.error("stripe-create-checkout error:", error?.message || error);
    return Response.json({ error: error?.message || "Failed to create checkout session." }, { status: 500 });
  }
}
