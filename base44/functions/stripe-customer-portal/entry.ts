import { stripePost, stripeGet, newIdempotencyKey } from "../../shared/stripe.ts";

export default async function(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const customerId = body?.customer_id ? String(body.customer_id).trim() : null;
    const customerEmail = body?.customer_email ? String(body.customer_email).trim() : null;
    const returnUrl = String(body?.return_url || "").trim();

    if (!returnUrl || !/^https?:\/\//.test(returnUrl)) {
      return Response.json({ error: "A valid return_url is required." }, { status: 400 });
    }
    if (!customerId && !customerEmail) {
      return Response.json({ error: "Either customer_id or customer_email is required." }, { status: 400 });
    }

    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && customerEmail) {
      const list = await stripeGet("/customers?email=" + encodeURIComponent(customerEmail) + "&limit=1");
      resolvedCustomerId = list?.data?.[0]?.id || null;
    }
    if (!resolvedCustomerId) {
      return Response.json({ error: "No Stripe customer found. Subscribe to a plan first." }, { status: 404 });
    }

    const params = new URLSearchParams();
    params.append("customer", resolvedCustomerId);
    params.append("return_url", returnUrl);

    const session = await stripePost("/billing_portal/sessions", params, newIdempotencyKey());

    return Response.json({ ok: true, url: session.url });
  } catch (error) {
    console.error("stripe-customer-portal error:", error?.message || error);
    return Response.json({ error: error?.message || "Failed to create portal session." }, { status: 500 });
  }
}