export const POLICY_VERSION = "jericho-autonomy-v2";
const protectedRisks = new Set(["spending", "destructive", "publication", "external_communication", "legal", "access_change", "security_change", "dns", "machine_control", "sensitive_transmission"]);
const safeRisks = new Set(["read", "plan", "internal_write", "generate", "validate", "repair"]);

// Descriptors are supplied by registered server handlers. Model output and
// browser preferences can narrow execution, but never grant an authorization.
export function evaluateAction(action, { authorized = false } = {}) {
  const reasons = [];
  if (!authorized) reasons.push("authorization_required");
  const risks = [action?.risk_class, ...(Array.isArray(action?.additional_risks) ? action.additional_risks : [])];
  for (const risk of risks) {
    if (!safeRisks.has(risk) && !protectedRisks.has(risk)) reasons.push("unknown_action");
    if (protectedRisks.has(risk)) reasons.push(risk + "_approval_required");
  }
  if (action?.reversible !== true) reasons.push("irreversible_action");
  const cost = action?.estimated_cost_cents;
  if (!Number.isSafeInteger(cost) || cost < 0) reasons.push("cost_unknown");
  else if (cost !== 0) reasons.push("spend_authorization_required");
  const blockers = [...new Set(reasons)];
  return { version: POLICY_VERSION, automatic: blockers.length === 0, requires_human_approval: blockers.length > 0, blocker_codes: blockers };
}

const internalRoutes = Object.freeze({
  "creation.interactive": ["iabt-deterministic-interactive-v1"],
  "creation.document": ["iabt-document-v2", "iabt-source-review-v1", "iabt-preproduction-v1"],
  "creation.code": ["iabt-code-scaffold-v1"],
  "creation.design": ["iabt-design-specification-v1"],
  "creation.gcode-simulation": ["iabt-gcode-simulation-v1"],
  "creation.automation": ["iabt-automation-runbook-v1"]
});

export function creationAction(plan) {
  const internal = plan?.provider === "iabt-standalone" && internalRoutes[plan.job_type]?.includes(plan.capability_id);
  return {
    risk_class: internal ? "generate" : "spending",
    reversible: Boolean(internal),
    estimated_cost_cents: plan?.provider_cost_cents
  };
}

export const creationPolicy = (plan) => evaluateAction(creationAction(plan), { authorized: true });
