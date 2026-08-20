import { secrets } from "base44:runtime";
import { normalizePlan, stripePost, newIdempotencyKey } from "../../shared/stripe.ts";

export default async function(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const plan = normalizePlan(String(body?.plan || ""));
    const priceId = String(body?.price_id || "").trim();
    const customerEmail = body?.customer_email ? String(body.customer_email).trim() : null;
    const userId = body?.user_id ? String(body.user_id).trim() : null;
    const successUrl = String(body?.success_url || "").trim();
    const cancelUrl = String(body?.cancel_url || "").trim();

    if (!plan) {
      return Response.json({ error: "plan must be 'builder' or 'pro'." }, { status: 400 });
    }
    if (!priceId || !priceId.startsWith("price_")) {
      return Response.json({ error: "A valid price_id (starting with price_) is required." }, { status: 400 });
    }
    if (!successUrl || !/^https?:\/\//.test(successUrl)) {
      return Response.json({ error: "A valid success_url is required." }, { status: 400 });
    }
    if (!cancelUrl || !/^https?:\/\//.test(cancelUrl)) {
      return Response.json({ error: "A valid cancel_url is required." }, { status: 400 });
    }

    const appId = secrets.get("BASE44_APP_ID") || "";
    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    if (customerEmail) params.append("customer_email", customerEmail);
    params.append("metadata[base44_app_id]", appId);
    params.append("metadata[plan]", plan);
    if (userId) params.append("metadata[user_id]", userId);
    if (customerEmail) params.append("metadata[user_email]", customerEmail);
    params.append("subscription_data[metadata][base44_app_id]", appId);
    params.append("subscription_data[metadata][plan]", plan);
    if (userId) params.append("subscription_data[metadata][user_id]", userId);
    if (customerEmail) params.append("subscription_data[metadata][user_email]", customerEmail);

    const session = await stripePost("/checkout/sessions", params, newIdempotencyKey());

    return Response.json({ ok: true, url: session.url, session_id: session.id });
  } catch (error) {
    console.error("stripe-create-checkout error:", error?.message || error);
    return Response.json({ error: error?.message || "Failed to create checkout session." }, { status: 500 });
  }
}