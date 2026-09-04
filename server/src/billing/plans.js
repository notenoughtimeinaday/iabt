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

export const planForPrice = (stripeConfig, priceId) => {
  const candidate = String(priceId || "");
  for (const [plan, configured] of Object.entries(stripeConfig.prices || {})) {
    if (candidate && candidate === configured) return plan;
  }
  return "";
};
