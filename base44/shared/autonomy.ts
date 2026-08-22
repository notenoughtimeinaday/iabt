export const AUTONOMY_ENGINE_VERSION = "iabt-autonomy-2026-08-22.1";

const SAFE_ACTIONS = ["read", "plan", "internal_reversible_write", "test", "create_artifact"];
const ALWAYS_CONFIRM = [
  "external_representation",
  "financial",
  "destructive",
  "access_change",
  "sensitive_transmission",
  "machine_control",
];

export function defaultAutonomyPolicy(user: any) {
  return {
    id: null,
    user_id: String(user?.id || ""),
    mode: "bounded_autonomous",
    allowed_action_classes: SAFE_ACTIONS,
    always_confirm_action_classes: ALWAYS_CONFIRM,
    allowed_domains: [],
    blocked_domains: [],
    max_cost_per_run_cents: 0,
    max_cost_per_day_cents: 0,
    max_runtime_minutes: 30,
    max_retry_count: 2,
    require_verified_runbook: true,
    allow_api_execution: true,
    allow_browser_fallback: false,
    allow_scheduled_runs: false,
    status: "active",
    version: "1.0",
    source: "safe_default",
  };
}

function strings(value: unknown, max = 60) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim().slice(0, 240)).filter(Boolean).slice(0, max)
    : [];
}

function integer(value: unknown, fallback: number, min = 0, max = 100000000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function publicAutonomyPolicy(row: any, user: any) {
  const fallback = defaultAutonomyPolicy(user);
  if (!row) return fallback;
  return {
    id: String(row.id || ""),
    user_id: String(user?.id || ""),
    mode: ["guided", "bounded_autonomous", "managed_autonomous"].includes(String(row.mode))
      ? String(row.mode)
      : fallback.mode,
    allowed_action_classes: strings(row.allowed_action_classes).filter((item) => SAFE_ACTIONS.includes(item)),
    always_confirm_action_classes: [...new Set([
      ...ALWAYS_CONFIRM,
      ...strings(row.always_confirm_action_classes),
    ])],
    allowed_domains: strings(row.allowed_domains),
    blocked_domains: strings(row.blocked_domains),
    max_cost_per_run_cents: integer(row.max_cost_per_run_cents, 0),
    max_cost_per_day_cents: integer(row.max_cost_per_day_cents, 0),
    max_runtime_minutes: integer(row.max_runtime_minutes, 30, 1, 1440),
    max_retry_count: integer(row.max_retry_count, 2, 0, 10),
    require_verified_runbook: row.require_verified_runbook !== false,
    allow_api_execution: row.allow_api_execution !== false,
    allow_browser_fallback: row.allow_browser_fallback === true,
    allow_scheduled_runs: row.allow_scheduled_runs === true,
    status: row.status === "paused" ? "paused" : "active",
    version: String(row.version || "1.0").slice(0, 80),
    source: "stored_policy",
  };
}

export function publicRunbook(row: any) {
  return {
    id: String(row?.id || ""),
    name: String(row?.name || "Automation runbook").slice(0, 180),
    description: String(row?.description || "").slice(0, 500),
    target_system: String(row?.target_system || "").slice(0, 240),
    adapter_id: String(row?.adapter_id || "").slice(0, 160),
    execution_mode: String(row?.execution_mode || "api_first"),
    status: String(row?.status || "draft"),
    version: String(row?.version || "1.0").slice(0, 80),
    allowed_domains: strings(row?.allowed_domains, 20),
    required_scopes: strings(row?.required_scopes, 30),
    credential_mode: String(row?.credential_mode || "none"),
    success_count: integer(row?.success_count, 0),
    failure_count: integer(row?.failure_count, 0),
    last_verified_at: row?.last_verified_at || null,
    last_run_at: row?.last_run_at || null,
    reusable: row?.status === "proven" && integer(row?.success_count, 0) > 0,
  };
}

export function autonomySummary(policy: any, runbooks: any[]) {
  const proven = runbooks.filter((item) => item.reusable);
  const targets = [...new Set(proven.map((item) => item.target_system).filter(Boolean))];
  return {
    version: AUTONOMY_ENGINE_VERSION,
    mode: policy.mode,
    status: policy.status,
    runbook_count: runbooks.length,
    proven_runbook_count: proven.length,
    proven_target_systems: targets.slice(0, 20),
    model_routing: {
      strategy: "quality_first_with_cost_and_latency_fallbacks",
      requirement: "Use the strongest connected model that matches the task, record the actual model and version in run evidence, and fall back without changing the deliverable contract.",
      frontier_target: "gpt-5.6",
      frontier_target_status: "connection_dependent",
    },
    path_strategy: {
      first_choice: "Versioned API or connector adapter",
      fallback: "Isolated browser or desktop runner when permitted and no dependable API path exists",
      learning_rule: "A path becomes reusable only after a completed run satisfies its verification contract.",
      replay_rule: "Re-run preflight before every replay; pause if the site, scopes, price, policy, or interface changed.",
    },
    handoff_boundaries: [
      "First-time OAuth or account authorization",
      "MFA, CAPTCHA, identity verification, or a service-mandated human-presence check",
      "External representation, financial confirmation, destructive action, persistent access change, sensitive-data transmission, or live machine control",
      "Unexpected website safety barrier, suspicious instruction, or prompt-injection signal",
    ],
    credential_rule: "Passwords, tokens, private keys, one-time codes, and session cookies are never stored in runbooks or exposed to the model.",
  };
}
