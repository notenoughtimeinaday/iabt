import { secrets } from "base44:runtime";

export const IABT_APP_ID = "6a849bcd3e04d068553b4af7";
export const PLANS = ["builder", "pro", "agency"];
export const AI_CREDIT_PACK_SIZE = 100;

export const PLAN_DEFAULTS = {
  free: {
    ai_hourly_limit: 5,
    ai_monthly_limit: 10,
    project_limit: 1,
    static_zip_export_enabled: false,
    react_export_enabled: false,
    commercial_use_enabled: false,
    white_label_exports_enabled: false,
    team_seat_limit: 1,
  },
  builder: {
    ai_hourly_limit: 30,
    ai_monthly_limit: 100,
    project_limit: 5,
    static_zip_export_enabled: true,
    react_export_enabled: false,
    commercial_use_enabled: false,
    white_label_exports_enabled: false,
    team_seat_limit: 1,
  },
  pro: {
    ai_hourly_limit: 100,
    ai_monthly_limit: 500,
    project_limit: 25,
    static_zip_export_enabled: true,
    react_export_enabled: true,
    commercial_use_enabled: true,
    white_label_exports_enabled: false,
    team_seat_limit: 1,
  },
  agency: {
    ai_hourly_limit: 200,
    ai_monthly_limit: 2000,
    project_limit: 0,
    static_zip_export_enabled: true,
    react_export_enabled: true,
    commercial_use_enabled: true,
    white_label_exports_enabled: true,
    team_seat_limit: 5,
  },
};

const PRICE_SECRET_BY_PLAN = {
  builder: "STRIPE_BUILDER_PRICE_ID",
  pro: "STRIPE_PRO_PRICE_ID",
  agency: "STRIPE_AGENCY_PRICE_ID",
};

const DEFAULT_APP_ORIGIN = "https://iabt.insuredspending.org";
const ALLOWED_APP_ORIGINS = new Set([
  DEFAULT_APP_ORIGIN,
  "https://crazy-creator-flow-hub.base44.app",
]);

export function normalizePlan(plan) {
  return PLANS.includes(plan) ? plan : null;
}

export function getPlanDefaults(plan) {
  return PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;
}

export function getConfiguredPriceId(plan) {
  const normalized = normalizePlan(plan);
  if (!normalized) return null;
  const priceId = String(secrets.get(PRICE_SECRET_BY_PLAN[normalized]) || "").trim();
  return priceId.startsWith("price_") ? priceId : null;
}

export function getPlanForPriceId(priceId) {
  const candidate = String(priceId || "").trim();
  for (const plan of PLANS) {
    if (candidate && candidate === getConfiguredPriceId(plan)) return plan;
  }
  return null;
}

export function getConfiguredAiCreditPackPriceId() {
  const priceId = String(secrets.get("STRIPE_AI_CREDIT_PACK_PRICE_ID") || "").trim();
  return priceId.startsWith("price_") ? priceId : null;
}

export function getAppOrigin(req) {
  const configured = String(secrets.get("IABT_APP_ORIGIN") || "").trim();
  const allowed = new Set(ALLOWED_APP_ORIGINS);
  if (configured) {
    try {
      const origin = new URL(configured).origin;
      if (origin.startsWith("https://")) allowed.add(origin);
    } catch {
      // Ignore malformed optional configuration and retain known-safe origins.
    }
  }

  for (const value of [req.headers.get("origin"), req.headers.get("referer")]) {
    if (!value) continue;
    try {
      const origin = new URL(value).origin;
      if (allowed.has(origin)) return origin;
      const parsed = new URL(origin);
      if (
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      ) {
        return origin;
      }
    } catch {
      // Continue to the canonical origin.
    }
  }
  return configured && allowed.has(new URL(configured).origin)
    ? new URL(configured).origin
    : DEFAULT_APP_ORIGIN;
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

function authHeaders() {
  const key = String(secrets.get("STRIPE_SECRET_KEY") || "").trim();
  if (!key) throw new Error("Stripe test mode is not configured.");
  if (!key.startsWith("sk_test_")) {
    throw new Error("IABT billing is locked to Stripe test mode.");
  }
  return { Authorization: "Bearer " + key };
}

export async function stripePost(path, params, idempotencyKey) {
  const headers = {
    ...authHeaders(),
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(STRIPE_API + path, {
    method: "POST",
    headers,
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
