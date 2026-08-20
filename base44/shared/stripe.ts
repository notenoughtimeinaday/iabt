import { secrets } from "base44:runtime";

export const PLANS = ["builder", "pro"];

export const PLAN_DEFAULTS = {
  free: { ai_hourly_limit: 5, project_limit: 3, react_export_enabled: false },
  builder: { ai_hourly_limit: 30, project_limit: 25, react_export_enabled: true },
  pro: { ai_hourly_limit: 100, project_limit: 0, react_export_enabled: true },
};

export function normalizePlan(plan) {
  return PLANS.includes(plan) ? plan : null;
}

export function getPlanDefaults(plan) {
  return PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;
}

export function mapStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due": return "past_due";
    case "canceled": return "canceled";
    case "unpaid": return "inactive";
    case "incomplete": return "inactive";
    case "incomplete_expired": return "canceled";
    default: return "inactive";
  }
}

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2025-10-29.clover";

function authHeaders() {
  const key = secrets.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return {
    Authorization: "Bearer " + key,
    "Stripe-Version": STRIPE_VERSION,
  };
}

export async function stripePost(path, params, idempotencyKey) {
  const res = await fetch(STRIPE_API + path, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Stripe API error: " + res.status);
  }
  return data;
}

export async function stripeGet(path) {
  const res = await fetch(STRIPE_API + path, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Stripe API error: " + res.status);
  }
  return data;
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}