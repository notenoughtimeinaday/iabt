import { createClientFromRequest } from "npm:@base44/sdk";
import { getPlanDefaults, getStripeReadiness } from "../../shared/stripe.ts";

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

    const service = base44.asServiceRole;
    const records = await service.entities.AccountEntitlement.filter(
      { user_id: user.id },
      "-updated_date",
      1,
    );
    const current = records?.[0];

    if (current) {
      const active = ["active", "trialing"].includes(String(current.status));
      const plan = active ? String(current.plan || "free") : "free";
      const defaults = getPlanDefaults(plan);
      const foundingAdmin = user.role === "admin" && current.billing_provider === "none";
      const normalized = foundingAdmin
        ? { ...defaults, ...current, plan }
        : {
            ...current,
            ...defaults,
            plan,
            bonus_ai_credits: Number(current.bonus_ai_credits || 0),
          };
      return Response.json({ ok: true, entitlement: normalized, billing: getStripeReadiness() });
    }

    const plan = user.role === "admin" ? "pro" : "free";
    const defaults = getPlanDefaults(plan);
    const entitlement = await service.entities.AccountEntitlement.create({
      user_id: user.id,
      user_email: user.email,
      plan,
      status: "active",
      billing_provider: "none",
      ...defaults,
      ai_hourly_limit: user.role === "admin" ? 200 : defaults.ai_hourly_limit,
      project_limit: user.role === "admin" ? 0 : defaults.project_limit,
      bonus_ai_credits: 0,
      notes: user.role === "admin"
        ? "Founding administrator entitlement"
        : "Default free entitlement",
    });

    return Response.json({ ok: true, entitlement, billing: getStripeReadiness() });
  } catch (error) {
    console.error("get-account-entitlement error:", error?.message || error);
    return Response.json(
      { error: error?.message || "Could not load account entitlement." },
      { status: 500 },
    );
  }
}
