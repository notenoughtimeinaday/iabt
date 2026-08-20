import { createClientFromRequest } from "npm:@base44/sdk";
import { getAppOrigin, newIdempotencyKey, stripePost } from "../../shared/stripe.ts";

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
    if (!user?.id) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const records = await base44.asServiceRole.entities.AccountEntitlement.filter(
      { user_id: user.id },
      "-updated_date",
      1,
    );
    const customerId = String(records?.[0]?.provider_customer_id || "").trim();
    if (records?.[0]?.billing_provider !== "stripe" || !customerId.startsWith("cus_")) {
      return Response.json(
        { error: "No Stripe billing account was found for this user." },
        { status: 404 },
      );
    }

    const params = new URLSearchParams();
    params.append("customer", customerId);
    params.append("return_url", getAppOrigin(req) + "/");

    const session = await stripePost("/billing_portal/sessions", params, newIdempotencyKey());
    return Response.json({ ok: true, url: session.url });
  } catch (error) {
    console.error("stripe-customer-portal error:", error?.message || error);
    return Response.json({ error: error?.message || "Failed to create portal session." }, { status: 500 });
  }
}
