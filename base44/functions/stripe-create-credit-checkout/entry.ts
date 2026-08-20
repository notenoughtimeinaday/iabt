import { createClientFromRequest } from "npm:@base44/sdk";
import {
  AI_CREDIT_PACK_SIZE,
  getAppOrigin,
  getConfiguredAiCreditPackPriceId,
  IABT_APP_ID,
  newIdempotencyKey,
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

    const priceId = getConfiguredAiCreditPackPriceId();
    if (!priceId) {
      return Response.json(
        { error: "AI credit checkout is not configured yet. Add STRIPE_AI_CREDIT_PACK_PRICE_ID in Base44 Secrets." },
        { status: 503 },
      );
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
    params.append("mode", "payment");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", origin + "/?billing=credits_success&session_id={CHECKOUT_SESSION_ID}");
    params.append("cancel_url", origin + "/?billing=canceled");
    params.append("client_reference_id", user.id);
    if (customerId.startsWith("cus_")) {
      params.append("customer", customerId);
    } else {
      params.append("customer_email", user.email);
    }

    const metadata = {
      base44_app_id: IABT_APP_ID,
      product_type: "ai_credit_pack",
      credits: String(AI_CREDIT_PACK_SIZE),
      user_id: user.id,
      user_email: user.email,
    };
    for (const [key, value] of Object.entries(metadata)) {
      params.append(`metadata[${key}]`, value);
      params.append(`payment_intent_data[metadata][${key}]`, value);
    }

    const session = await stripePost("/checkout/sessions", params, newIdempotencyKey());
    return Response.json({ ok: true, url: session.url, session_id: session.id });
  } catch (error) {
    console.error("stripe-create-credit-checkout error:", error?.message || error);
    return Response.json({ error: error?.message || "Failed to create credit checkout." }, { status: 500 });
  }
}
