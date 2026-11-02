import { isDeepStrictEqual } from "node:util";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Test three exact test-mode plans, or one separately enabled live owner plan.
// A live owner window lasts at most 24 hours and grants no credits or role.
// These
// restrict requests; they are not a provider-enforced dollar cap.
export function privateAcceptanceAccess(config, user, { planId, now = Date.now() } = {}) {
  const settings = config.orchestration || {};
  const scope = settings.privateAcceptance || {};
  if (!scope.enabled) return true;
  const ids = scope.planIds;
  const liveOwner = scope.liveOwnerEnabled === true && config.providers?.stripe?.mode === "live";
  const remainingMs = Date.parse(scope.expiresAt) - now;
  const model = config.providers?.openai?.model;
  const limits = model === "gpt-4o-mini" ? { output: 6000, response: 3, budget: 24 } :
    model === "gpt-5.6-terra" ? { output: 8000, response: 20, budget: 160 } : null;
  return Boolean((config.providers?.stripe?.mode === "test" || liveOwner) &&
    limits &&
    uuid.test(scope.ownerId || "") && user?.id === scope.ownerId &&
    Number.isFinite(Date.parse(scope.expiresAt)) && Date.parse(scope.expiresAt) > now &&
    (!liveOwner || (user?.email_verified === true && remainingMs <= 24 * 60 * 60 * 1000 && ids?.length <= 1)) &&
    Array.isArray(ids) && ids.length <= 3 && ids.every(id => typeof id === "string" && uuid.test(id)) && new Set(ids).size === ids.length &&
    Number.isSafeInteger(settings.maxTurns) && settings.maxTurns > 0 && settings.maxTurns <= 8 &&
    Number.isSafeInteger(settings.maxOutputTokens) && settings.maxOutputTokens > 0 && settings.maxOutputTokens <= limits.output &&
    Number.isSafeInteger(settings.responseCostCents) && settings.responseCostCents >= limits.response &&
    Number.isSafeInteger(settings.budgetCents) && settings.budgetCents >= settings.responseCostCents && settings.budgetCents <= limits.budget &&
    (planId === undefined || ids.includes(planId)));
}

// A server-configured private owner window may quote one personal workflow
// without manufacturing Stripe purchase provenance. Execution still requires
// its exact admitted plan, original quote approval and ordinary credit ledger.
export function privateOwnerCreationAccess(config, user) {
  return Boolean(config.orchestration?.privateAcceptance?.enabled &&
    config.orchestration.privateAcceptance.liveOwnerEnabled === true &&
    config.providers?.stripe?.mode === "live" && privateAcceptanceAccess(config, user));
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
  const canonicalKey = plan ? "plan:" + plan.id + ":" + plan.pricing_version : "";
  let expectedKey = canonicalKey;
  if (job.input.authorization_recovery_from_job_id) {
    const previous = await repository.getJob(job.input.authorization_recovery_from_job_id, { ...user, role: "user" });
    const state = previous?.output?.orchestration;
    const { authorization_recovery_from_job_id: previousId, ...originalInput } = job.input;
    // One operator-admitted replacement may reuse an approval only when the
    // original stopped before the submission checkpoint. Preserve its ledger
    // and failed record; uncertain, charged and chained attempts cannot recover.
    if (!uuid.test(previousId) || !previous || previous.id === job.id || previous.owner_id !== user.id ||
        previous.job_type !== "creation.orchestrated" || previous.status !== "failed" ||
        previous.idempotency_key !== canonicalKey || previous.input?.authorization_recovery_from_job_id ||
        previous.last_error_code !== "app_creation_incomplete" ||
        state?.phase !== "fallback" || state.turn !== 0 || state.spent_cents !== 0 ||
        state.response_id || state.response || state.calls?.length || state.artifacts?.length || state.response_usage?.length ||
        !state.failures?.length || !state.failures.every(item => item.code === "ai_acceptance_not_authorized") ||
        !isDeepStrictEqual(originalInput, previous.input) || !isDeepStrictEqual(job.approval, previous.approval) ||
        job.credit_amount !== previous.credit_amount) throw denied();
    expectedKey = canonicalKey + ":recover:" + previous.id;
  }
  // A copied plan ID cannot obtain another set of paid turns under a new key.
  if (!plan || plan.job_type !== "creation.orchestrated" || plan.user_id !== user.id ||
      job.idempotency_key !== expectedKey ||
      job.approval?.approval_id !== "plan:" + plan.id ||
      Number(job.input.orchestration_budget_cents) !== Number(plan.provider_cost_cents) ||
      Number(plan.provider_cost_cents) > config.orchestration.budgetCents ||
      (plan.execution_job_id && plan.execution_job_id !== job.id)) throw denied();
}
