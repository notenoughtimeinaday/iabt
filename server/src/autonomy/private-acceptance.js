const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Test three exact plans without opening paid creation to the public. These
// restrict requests; they are not a provider-enforced dollar cap.
export function privateAcceptanceAccess(config, user, { planId, now = Date.now() } = {}) {
  const settings = config.orchestration || {};
  const scope = settings.privateAcceptance || {};
  if (!scope.enabled) return true;
  const ids = scope.planIds;
  const model = config.providers?.openai?.model;
  const limits = model === "gpt-4o-mini" ? { output: 6000, response: 3, budget: 24 } :
    model === "gpt-5.6-terra" ? { output: 8000, response: 20, budget: 160 } : null;
  return Boolean(config.providers?.stripe?.mode === "test" &&
    limits &&
    uuid.test(scope.ownerId || "") && user?.id === scope.ownerId &&
    Number.isFinite(Date.parse(scope.expiresAt)) && Date.parse(scope.expiresAt) > now &&
    Array.isArray(ids) && ids.length <= 3 && ids.every(id => typeof id === "string" && uuid.test(id)) && new Set(ids).size === ids.length &&
    Number.isSafeInteger(settings.maxTurns) && settings.maxTurns > 0 && settings.maxTurns <= 8 &&
    Number.isSafeInteger(settings.maxOutputTokens) && settings.maxOutputTokens > 0 && settings.maxOutputTokens <= limits.output &&
    Number.isSafeInteger(settings.responseCostCents) && settings.responseCostCents >= limits.response &&
    Number.isSafeInteger(settings.budgetCents) && settings.budgetCents >= settings.responseCostCents && settings.budgetCents <= limits.budget &&
    (planId === undefined || ids.includes(planId)));
}

const denied = () => Object.assign(new Error("Custom creation is limited to the operator's current private test plans. Your files and credits are unchanged."),
  { status: 409, code: "ai_acceptance_not_authorized" });

export function assertPrivateAcceptanceAccess(config, user, planId) {
  if (!privateAcceptanceAccess(config, user, { planId })) throw denied();
}

export async function assertPrivateAcceptanceJob({ config, user, job, repository }) {
  if (!config.orchestration?.privateAcceptance?.enabled) return;
  assertPrivateAcceptanceAccess(config, user, job.input.plan_id);
  const plan = await repository.getRecord("CreationPlan", job.input.plan_id, { ...user, role: "user" });
  // A copied plan ID cannot obtain another set of paid turns under a new key.
  if (!plan || plan.job_type !== "creation.orchestrated" || plan.user_id !== user.id ||
      job.idempotency_key !== "plan:" + plan.id + ":" + plan.pricing_version ||
      job.approval?.approval_id !== "plan:" + plan.id ||
      Number(job.input.orchestration_budget_cents) !== Number(plan.provider_cost_cents) ||
      Number(plan.provider_cost_cents) > config.orchestration.budgetCents ||
      (plan.execution_job_id && plan.execution_job_id !== job.id)) throw denied();
}
