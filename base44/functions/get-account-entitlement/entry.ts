import { createClientFromRequest } from "npm:@base44/sdk";
import { getStripeReadiness } from "../../shared/stripe.ts";
import {
  entitlementUsageSummary,
  getOrCreateEntitlement,
} from "../../shared/usage.ts";

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

    const entitlement = await getOrCreateEntitlement(base44, user);
    const usage = entitlementUsageSummary(entitlement);
    const billing = getStripeReadiness();
    try {
      const keyType = billing.key_ready
        ? (billing.mode === "test" ? "test_key_valid" : "live_key_valid")
        : "invalid_or_missing";
      await base44.asServiceRole.entities.StripeDiagnosticProbe.create({
        mode: billing.mode,
        key_source: String(billing.key_source || "unknown"),
        key_type: keyType,
        webhook_source: String(billing.webhook_source || "unknown"),
        webhook_valid: Boolean(billing.webhook_ready),
        builder_price_ready: Boolean(billing.price_status?.builder),
        pro_price_ready: Boolean(billing.price_status?.pro),
        agency_price_ready: Boolean(billing.price_status?.agency),
        credit_price_ready: Boolean(billing.price_status?.credits),
        ready: Boolean(billing.ready),
      });
    } catch (diagnosticError) {
      console.error("stripe diagnostic probe write failed:", diagnosticError?.message || diagnosticError);
    }
    return Response.json({
      ok: true,
      entitlement: {
        ...entitlement,
        ai_hourly_used: usage.hourly_used,
        ai_hourly_remaining: usage.hourly_remaining,
        ai_monthly_used: usage.monthly_used,
        ai_monthly_remaining: usage.monthly_remaining,
        bonus_ai_credits: usage.bonus_remaining,
        total_iabt_credits_remaining: usage.total_remaining,
      },
      usage,
      billing,
    });
  } catch (error) {
    console.error("get-account-entitlement error:", error?.message || error);
    return Response.json(
      { error: error?.message || "Could not load account entitlement." },
      { status: 500 },
    );
  }
}
