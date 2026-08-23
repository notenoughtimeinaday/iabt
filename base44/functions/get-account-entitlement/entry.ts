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
      billing: getStripeReadiness(),
    });
  } catch (error) {
    console.error("get-account-entitlement error:", error?.message || error);
    return Response.json(
      { error: error?.message || "Could not load account entitlement." },
      { status: 500 },
    );
  }
}
