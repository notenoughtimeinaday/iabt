import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PostgresRepository } from "../src/postgres-repository.js";
import { loadConfig } from "../src/config.js";
import { createCreationPlan, executeCreationPlan } from "../src/creation/planner.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { recoverUnsubmittedAuthorizationFailure } from "../src/operations/private-ai-recovery.js";
import { assertPrivateAcceptanceJob } from "../src/autonomy/private-acceptance.js";

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;
async function fixture(t) {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /test/);
  const schema = "recovery_test_" + randomUUID().replaceAll("-", "");
  const control = new pg.Pool({ connectionString, max: 1 });
  await control.query(`CREATE SCHEMA ${schema}`);
  const repository = new PostgresRepository({ pool: new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 }) });
  t.after(async () => { await repository.close(); await control.query(`DROP SCHEMA ${schema} CASCADE`); await control.end(); });
  await repository.ready();
  const user = await repository.createUser({ email: "recovery@example.test", passwordHash: "unused", emailVerified: true });
  await repository.grantCredits({ ownerId: user.id, amount: 100, idempotencyKey: "fixture-opening" });
  const env = { NODE_ENV: "test", IABT_AUTH_SECRET: "recovery-test", OPENAI_API_KEY: "not-a-live-key", IABT_ENABLE_PAID_AI: "true", IABT_ENABLE_ORCHESTRATION: "true", IABT_ORCHESTRATION_BUDGET_ACCEPTED: "true", IABT_OPENAI_RESPONSE_COST_CENTS: "3", IABT_ORCHESTRATION_BUDGET_CENTS: "24", IABT_AI_ACCEPTANCE_ONLY: "true", IABT_AI_ACCEPTANCE_OWNER_ID: user.id, IABT_AI_ACCEPTANCE_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString() };
  let config = loadConfig(env);
  const providers = createProviderRegistry(config, { fetchImpl: () => { throw new Error("No provider request allowed"); } });
  const { plan } = await createCreationPlan({ repository, config, user, providers, storage: {}, requestText: "Build a garden app" });
  config = loadConfig({ ...env, IABT_AI_ACCEPTANCE_PLAN_IDS: plan.id });
  await executeCreationPlan({ repository, config, user, body: { plan_id: plan.id, approved: true, pricing_version: plan.pricing_version, accepted_total_cents: plan.total_estimated_cost_cents } });
  const previous = await repository.claimNextJob({ workerId: "old-scope" });
  await repository.checkpointJob({ jobId: previous.id, workerId: "old-scope", outputPatch: { orchestration: { phase: "fallback", turn: 0, spent_cents: 0, calls: [], artifacts: [], failures: [{ code: "ai_acceptance_not_authorized" }] } } });
  await repository.failJob({ jobId: previous.id, workerId: "old-scope", error: { code: "app_creation_incomplete" } });
  await repository.updateRecord("CreationPlan", plan.id, user, { status: "failed" });
  return { repository, config, user, previousJobId: previous.id, operatorApproved: true, plan };
}

test("postgres: concurrent unsubmitted recovery admits one replacement and preserves the old ledger", { skip: !connectionString }, async t => {
  const c = await fixture(t);
  const jobs = await Promise.all([recoverUnsubmittedAuthorizationFailure(c), recoverUnsubmittedAuthorizationFailure(c)]);
  assert.equal(jobs[0].id, jobs[1].id);
  assert.equal((await c.repository.getJob(c.previousJobId, c.user)).status, "failed");
  const claimed = await c.repository.claimNextJob({ workerId: "new-scope" });
  await assertPrivateAcceptanceJob({ ...c, job: claimed });
  await c.repository.failJob({ jobId: claimed.id, workerId: "new-scope", error: { code: "app_creation_incomplete" } });
  assert.equal((await c.repository.getCreditAccount(c.user.id)).available_credits, 100);
  assert.equal((await c.repository.getCreditAccount(c.user.id)).reserved_credits, 0);
  const ledger = (await c.repository.pool.query("SELECT entry_type,count(*)::int AS count FROM iabt_credit_entries GROUP BY entry_type ORDER BY entry_type")).rows;
  assert.deepEqual(ledger, [{ entry_type: "grant", count: 1 }, { entry_type: "release", count: 2 }, { entry_type: "reserve", count: 2 }]);
  await assert.rejects(recoverUnsubmittedAuthorizationFailure({ ...c, previousJobId: claimed.id }), { code: "ai_acceptance_not_authorized" });
});

test("postgres: ambiguous submission or missing approval rolls recovery back before admission", { skip: !connectionString }, async t => {
  const c = await fixture(t);
  await assert.rejects(recoverUnsubmittedAuthorizationFailure({ ...c, operatorApproved: false }), { code: "ai_acceptance_not_authorized" });
  await c.repository.pool.query("UPDATE iabt_jobs SET output=jsonb_set(output,'{orchestration,spent_cents}','20'::jsonb) WHERE id=$1", [c.previousJobId]);
  await assert.rejects(recoverUnsubmittedAuthorizationFailure(c), { code: "ai_acceptance_not_authorized" });
  assert.equal((await c.repository.listJobs(c.user)).length, 1);
  assert.equal((await c.repository.getCreditAccount(c.user.id)).available_credits, 100);
  assert.equal((await c.repository.getCreditAccount(c.user.id)).reserved_credits, 0);
  assert.equal((await c.repository.getRecord("CreationPlan", c.plan.id, c.user)).execution_job_id, c.previousJobId);
});
