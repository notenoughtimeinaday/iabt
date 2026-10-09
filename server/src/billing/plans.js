export const PLAN_DEFAULTS = Object.freeze({
  free: Object.freeze({
    ai_hourly_limit: 5,
    ai_monthly_limit: 10,
    project_limit: 1,
    static_zip_export_enabled: false,
    react_export_enabled: false,
    commercial_use_enabled: false,
    white_label_exports_enabled: false,
    team_seat_limit: 1
  }),
  // Proposed Starter capabilities. Sale remains gated on acceptance of the
  // versioned offer terms; existing tier defaults must never be repurposed.
  starter: Object.freeze({
    ai_hourly_limit: 5,
    ai_monthly_limit: 100,
    project_limit: 1,
    static_zip_export_enabled: true,
    react_export_enabled: false,
    commercial_use_enabled: false,
    white_label_exports_enabled: false,
    team_seat_limit: 1
  }),
  builder: Object.freeze({
    ai_hourly_limit: 30,
    ai_monthly_limit: 100,
    project_limit: 5,
    static_zip_export_enabled: true,
    react_export_enabled: false,
    commercial_use_enabled: false,
    white_label_exports_enabled: false,
    team_seat_limit: 1
  }),
  pro: Object.freeze({
    ai_hourly_limit: 100,
    ai_monthly_limit: 500,
    project_limit: 25,
    static_zip_export_enabled: true,
    react_export_enabled: true,
    commercial_use_enabled: true,
    white_label_exports_enabled: false,
    team_seat_limit: 1
  }),
  agency: Object.freeze({
    ai_hourly_limit: 200,
    ai_monthly_limit: 2000,
    project_limit: 0,
    static_zip_export_enabled: true,
    react_export_enabled: true,
    commercial_use_enabled: true,
    white_label_exports_enabled: true,
    team_seat_limit: 5
  })
});

export const planDefaults = (plan) => PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;

export const JERICHO_OFFER_CATALOG_VERSION = "jericho-2026-10-v1";

// Purchased price versions own their rights as well as their credit allowance.
// Never broaden a legacy tier merely because a new offer shares its name.
export const planEntitlementsForContract = (plan, contract) => ({
  ...planDefaults(plan),
  ...(contract?.plan === plan ? {
    ai_monthly_limit: contract.monthly_credits,
    ...(contract.catalog_version === JERICHO_OFFER_CATALOG_VERSION && ["starter", "builder", "pro"].includes(plan)
      ? { commercial_use_enabled: true } : {})
  } : {})
});

export const planForPrice = (stripeConfig, priceId) => {
  const candidate = String(priceId || "");
  for (const [plan, configured] of Object.entries(stripeConfig.prices || {})) {
    if (candidate && candidate === configured) return plan;
  }
  return "";
};
