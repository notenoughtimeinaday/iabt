import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { privateAcceptanceAccess, assertPrivateAcceptanceJob } from "../src/autonomy/private-acceptance.js";
import { capabilityRegistry, orchestrationConfigured } from "../src/autonomy/capabilities.js";
import { orchestrationStep } from "../src/autonomy/orchestrator.js";
import { createCreationPlan, executeCreationPlan } from "../src/creation/planner.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";

const approved = plan => ({ plan_id: plan.id, approved: true, pricing_version: plan.pricing_version,
  accepted_total_cents: plan.total_estimated_cost_cents });
const fixture = async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "private-acceptance@example.test", passwordHash: "unused", emailVerified: true });
  const other = await repository.createUser({ email: "other-acceptance@example.test", passwordHash: "unused", emailVerified: true });
  await repository.grantCredits({ ownerId: user.id, amount: 100, idempotencyKey: "opening" });
  const env = { NODE_ENV: "test", OPENAI_API_KEY: "fictional-local-key", IABT_ENABLE_PAID_AI: "true",
    IABT_ENABLE_ORCHESTRATION: "true", IABT_ORCHESTRATION_BUDGET_ACCEPTED: "true",
    IABT_OPENAI_RESPONSE_COST_CENTS: "3", IABT_ORCHESTRATION_BUDGET_CENTS: "24",
    IABT_AI_ACCEPTANCE_ONLY: "true", IABT_AI_ACCEPTANCE_OWNER_ID: user.id,
    IABT_AI_ACCEPTANCE_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString() };
  let config = loadConfig(env);
  const requests = [];
  const replies = [];
  const providers = createProviderRegistry(config, { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    assert.ok(replies.length, "Unexpected provider request");
    return Response.json(replies.shift());
  } });
  const storage = { health: async () => ({ ok: true }) };
  const result = await createCreationPlan({ repository, config, user, providers, storage,
    requestText: "Build a volunteer shift planner app with add, search and completion controls." });
  config = loadConfig({ ...env, IABT_AI_ACCEPTANCE_PLAN_IDS: result.plan.id });
  return { repository, user, other, env, config, providers, storage, plan: result.plan, requests, replies };
};

test("reviewed Terra acceptance requires its higher estimate without relaxing owner or plan bounds", async () => {
  const c = await fixture();
  const values = { ...c.env, OPENAI_MODEL: "gpt-5.6-terra", IABT_OPENAI_RESPONSE_COST_CENTS: "20", IABT_ORCHESTRATION_BUDGET_CENTS: "160", IABT_ORCHESTRATION_MAX_OUTPUT_TOKENS: "8000", IABT_AI_ACCEPTANCE_PLAN_IDS: c.plan.id };
  const config = loadConfig(values);
  assert.equal(privateAcceptanceAccess(config, c.user, { planId: c.plan.id }), true);
  assert.equal(privateAcceptanceAccess(config, c.other, { planId: c.plan.id }), false);
  assert.equal(privateAcceptanceAccess(config, c.user, { planId: randomUUID() }), false);
  assert.equal(config.orchestration.maxOutputTokens, 8000);
  assert.equal(privateAcceptanceAccess({ ...config, orchestration: { ...config.orchestration, maxOutputTokens: 8001 } }, c.user), false);
  for (const changed of [{ IABT_OPENAI_RESPONSE_COST_CENTS: "19" }, { IABT_ORCHESTRATION_BUDGET_CENTS: "161" }, { OPENAI_MODEL: "gpt-4.1-mini-2025-04-14" }, { OPENAI_MODEL: "gpt-4o-mini" }])
    assert.equal(privateAcceptanceAccess(loadConfig({ ...values, ...changed }), c.user), false);
});

test("private acceptance is owner scoped and validates expiry, model, mode and request bounds", async () => {
  const c = await fixture();
  assert.equal(orchestrationConfigured(c.config, c.user), true);
  assert.equal(orchestrationConfigured(c.config, c.other), false);
  assert.equal(orchestrationConfigured(c.config), false);
  assert.equal(privateAcceptanceAccess(c.config, c.user, { planId: c.plan.id }), true);
  assert.equal(privateAcceptanceAccess(c.config, c.user, { planId: randomUUID() }), false);
  const invalid = [
    { IABT_AI_ACCEPTANCE_OWNER_ID: "invalid" }, { IABT_AI_ACCEPTANCE_EXPIRES_AT: "invalid" },
    { IABT_AI_ACCEPTANCE_EXPIRES_AT: "2000-01-01T00:00:00Z" }, { OPENAI_MODEL: "another-model" },
    { IABT_STRIPE_MODE: "live" }, { IABT_ORCHESTRATION_BUDGET_CENTS: "25" },
    { IABT_OPENAI_RESPONSE_COST_CENTS: "2" }, { IABT_AI_ACCEPTANCE_PLAN_IDS: "invalid" },
    { IABT_AI_ACCEPTANCE_PLAN_IDS: [randomUUID(), randomUUID(), randomUUID(), randomUUID()].join(",") },
    { IABT_AI_ACCEPTANCE_PLAN_IDS: [c.plan.id, c.plan.id].join(",") }
  ];
  for (const values of invalid) assert.equal(orchestrationConfigured(loadConfig({ ...c.env, ...values }), c.user), false);
  const registry = await capabilityRegistry({ ...c, user: c.other, observe: false });
  assert.equal(registry.capabilities.openai_responses.configured, false);
  assert.doesNotMatch(JSON.stringify(registry), new RegExp(c.user.id));
});

test("unadmitted plans and other accounts stop before jobs, reservations or paid requests", async () => {
  const c = await fixture();
  const unadmitted = loadConfig(c.env);
  await assert.rejects(executeCreationPlan({ ...c, config: unadmitted, body: approved(c.plan) }),
    { code: "ai_acceptance_not_authorized" });
  await assert.rejects(createCreationPlan({ ...c, user: c.other, requestText: "Write an original volunteer guide document." }),
    { code: "document_creation_unavailable" });
  assert.equal(c.repository.jobs.size, 0);
  assert.equal((await c.repository.getCreditAccount(c.user.id)).available_credits, 100);
  assert.equal(c.requests.length, 0);
});

test("canonical plan admission reuses one job and validates identity at the spending boundary", async () => {
  const c = await fixture();
  const first = await executeCreationPlan({ ...c, body: approved(c.plan) });
  const replay = await executeCreationPlan({ ...c, body: approved(c.plan) });
  assert.equal(first.job.id, replay.job.id);
  assert.equal(c.repository.jobs.size, 1);
  const job = await c.repository.claimNextJob({ workerId: "private-test" });
  await assertPrivateAcceptanceJob({ ...c, job });
  for (const forged of [
    { ...job, idempotency_key: "copied-plan-another-job" },
    { ...job, id: randomUUID() },
    { ...job, approval: { ...job.approval, approval_id: "copied-approval" } },
    { ...job, input: { ...job.input, orchestration_budget_cents: 25 } }
  ]) await assert.rejects(assertPrivateAcceptanceJob({ ...c, job: forged }), { code: "ai_acceptance_not_authorized" });
  c.replies.push({ id: "resp_private", status: "queued", output: [] });
  await orchestrationStep({ ...c, job, workerId: "private-test" });
  assert.equal(c.requests.length, 1);
  const request = JSON.parse(c.requests[0].options.body);
  assert.equal(request.model, "gpt-4o-mini");
  assert.equal(request.max_output_tokens, 6000);
  assert.equal(request.parallel_tool_calls, false);
});

test("scope expiry stops new posts while a known response remains pollable", async () => {
  const c = await fixture();
  await executeCreationPlan({ ...c, body: approved(c.plan) });
  const job = await c.repository.claimNextJob({ workerId: "private-test" });
  c.replies.push({ id: "resp_private", status: "queued", output: [] });
  await orchestrationStep({ ...c, job, workerId: "private-test" });
  const expired = loadConfig({ ...c.env, IABT_AI_ACCEPTANCE_PLAN_IDS: c.plan.id, IABT_AI_ACCEPTANCE_EXPIRES_AT: "2000-01-01T00:00:00Z" });
  c.replies.push({ id: "resp_private", status: "completed", output: [], usage: { input_tokens: 100, output_tokens: 20 } });
  await orchestrationStep({ ...c, config: expired, job, workerId: "private-test" });
  assert.equal(c.requests.length, 2);
  assert.equal(c.requests[1].options.method, undefined);
  assert.match(c.requests[1].url, /responses\/resp_private$/);
  await orchestrationStep({ ...c, config: expired, job, workerId: "private-test" });
  const result = await orchestrationStep({ ...c, config: expired, job, workerId: "private-test" });
  assert.equal(result.fallback, true);
  assert.equal(result.reason, "ai_acceptance_not_authorized");
  assert.equal(c.requests.filter(x => x.options.method === "POST").length, 1);
});

test("copied plan job and legacy adapter cannot escape the private request count", async () => {
  const c = await fixture();
  await executeCreationPlan({ ...c, body: approved(c.plan) });
  const canonical = await c.repository.claimNextJob({ workerId: "private-test" });
  const job = { ...canonical, idempotency_key: "different-job" };
  const result = await orchestrationStep({ ...c, job, workerId: "private-test" });
  assert.equal(result.fallback, true);
  assert.equal(result.reason, "ai_acceptance_not_authorized");
  await assert.rejects(c.providers.execute("openai", "response", { input: "bypass" }, {
    idempotencyKey: "legacy-test", approval: { approved: true, approval_id: "legacy", max_cost_cents: 24 }
  }), { code: "ai_acceptance_not_authorized" });
  assert.equal(c.requests.length, 0);
});
