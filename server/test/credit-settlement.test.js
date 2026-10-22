import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { creationCreditPolicy, settleCreationCredits } from "../src/creation/credit-settlement.js";
import { createCreationPlan, executeCreationPlan } from "../src/creation/planner.js";
import { loadConfig } from "../src/config.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";

const policy = creationCreditPolicy("gpt-5.6-terra");
const usage = (input = 13192, output = 5273) => ({ phase: "complete", usage_model: policy.model, turn: 1,
  response_usage: [{ response_id: "resp_verified", model: policy.model, input_tokens: input, output_tokens: output }] });
const quoteJob = (state = usage()) => ({ job_type: "creation.orchestrated", credit_amount: 54,
  input: { credit_settlement: policy }, output: { orchestration: state } });

test("new quotes sign the usage policy and reject altered pricing before reserving credits", async () => {
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "signed-pricing-test", OPENAI_API_KEY: "unused",
    OPENAI_MODEL: "gpt-5.6-terra", IABT_ENABLE_PAID_AI: "true", IABT_ENABLE_ORCHESTRATION: "true",
    IABT_ORCHESTRATION_BUDGET_ACCEPTED: "true", IABT_ORCHESTRATION_BUDGET_CENTS: "160", IABT_OPENAI_RESPONSE_COST_CENTS: "20" });
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "quote@example.test", passwordHash: "unused", emailVerified: true });
  await repository.grantCredits({ ownerId: user.id, amount: 100, idempotencyKey: "initial" });
  const providers = createProviderRegistry(config, { fetchImpl: async () => { throw new Error("No paid requests permitted"); } });
  const { plan } = await createCreationPlan({ repository, config, providers, user, requestText: "Write a complete guide to growing basil." });
  assert.equal(plan.credit_cost, 54);
  assert.deepEqual(plan.normalized_spec.credit_settlement, policy);
  assert.match(plan.consent_summary, /Unused credits return automatically/);
  await repository.updateRecord("CreationPlan", plan.id, user, { normalized_spec: { ...plan.normalized_spec, credit_settlement: { ...policy, input_nano_usd: 1 } } });
  await assert.rejects(executeCreationPlan({ repository, config, user, body: { plan_id: plan.id, approved: true,
    pricing_version: plan.pricing_version, accepted_total_cents: plan.total_estimated_cost_cents, idempotency_key: "approve" } }), /quote/i);
  assert.equal((await repository.getCreditAccount(user.id)).available_credits, 100);
});

test("recorded app, document and revision usage costs 4, 3 and 11 credits, not the 54-credit maximum", () => {
  for (const [input, output, expected] of [[13192, 5273, 4], [14572, 2514, 3], [77470, 9942, 11]]) {
    const receipt = settleCreationCredits(quoteJob(usage(input, output)));
    assert.equal(receipt.captured, expected); assert.equal(receipt.returned, 54 - expected);
    assert.equal(receipt.reason, "verified_usage");
  }
});
test("round once, apply long-context rates per response and never exceed the reservation", () => {
  for (const [input, output, expected] of [[12000, 0, 1], [12001, 0, 2], [272000, 0, 23], [272001, 0, 46], [1050000, 128000, 54], [0, 0, 0]]) {
    assert.equal(settleCreationCredits(quoteJob(usage(input, output))).captured, expected);
  }
  const state = usage(200000, 0); state.turn = 2;
  state.response_usage.push({ ...state.response_usage[0], response_id: "resp_second" });
  assert.equal(settleCreationCredits(quoteJob(state)).captured, 34);
});
test("missing, duplicate, incomplete, invalid or wrong-model usage returns the reservation", () => {
  const cases = [undefined, { ...usage(), phase: "fallback" }, { ...usage(), turn: 2 }, { ...usage(), usage_model: "another-model" }];
  for (const patch of [{ input_tokens: null }, { output_tokens: -1 }, { input_tokens: Number.MAX_SAFE_INTEGER }, { model: "unpriced-model" }, { response_id: "" }]) {
    const state = usage(); Object.assign(state.response_usage[0], patch); cases.push(state);
  }
  const duplicate = usage(); duplicate.turn = 2; duplicate.response_usage.push({ ...duplicate.response_usage[0] }); cases.push(duplicate);
  for (const state of cases) {
    const job = quoteJob(); job.output.orchestration = state;
    assert.equal(settleCreationCredits(job).captured, 0); assert.equal(settleCreationCredits(job).returned, 54);
  }
  assert.throws(() => settleCreationCredits({ ...quoteJob(), input: { credit_settlement: { ...policy, input_nano_usd: 1 } } }), { code: "credit_policy_invalid" });
  assert.equal(settleCreationCredits({ ...quoteJob(), input: {} }).captured, 54);
});
async function fixture(t, adapter) {
  let repository;
  if (adapter === "memory") repository = new MemoryRepository();
  else {
    const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;
    const url = new URL(connectionString);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.match(url.pathname, /test/); assert.equal(url.search, ""); assert.equal(url.hash, "");
    const schema = "credit_settlement_test_" + randomUUID().replaceAll("-", "");
    const control = new pg.Pool({ connectionString, max: 1 });
    await control.query(`CREATE SCHEMA ${schema}`);
    repository = new PostgresRepository({ pool: new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 }) });
    t.after(async () => { await repository.close(); try { await control.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await control.end(); } });
    await repository.ready();
  }
  const user = await repository.createUser({ email: "credits@example.test", passwordHash: "unused", emailVerified: true });
  await repository.grantCredits({ ownerId: user.id, amount: 100, idempotencyKey: "initial" });
  const job = await repository.enqueueJob({ ownerId: user.id, jobType: "creation.orchestrated", input: { credit_settlement: policy }, idempotencyKey: "once", creditAmount: 54 });
  await repository.claimNextJob({ workerId: "worker" });
  await repository.checkpointJob({ jobId: job.id, workerId: "worker", outputPatch: { orchestration: usage() } });
  const artifact = { ownerId: user.id, storageProvider: "local", storageKey: `${user.id}/verified.txt`, originalName: "verified.txt", contentType: "text/plain", sizeBytes: 8, sha256: "a".repeat(64) };
  return { repository, user, job, artifact };
}
for (const adapter of ["memory", "postgres"]) {
  const options = { skip: adapter === "postgres" && !process.env.IABT_AUTH_TEST_DATABASE_URL };
  test(`${adapter}: completion captures and returns credits atomically once under competing workers`, options, async t => {
    const { repository, user, job, artifact } = await fixture(t, adapter);
    const results = await Promise.allSettled([1, 2].map(() => repository.completeJob({ jobId: job.id, workerId: "worker", artifact,
      output: { credit_settlement: { captured: 54 }, provider_metadata: { orchestration: { provider_usage: { input_tokens: 999999 } } } } })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const receipt = results.find(r => r.status === "fulfilled").value.job.output.credit_settlement;
    assert.equal(receipt.captured, 4); assert.equal(receipt.returned, 50);
    const account = await repository.getCreditAccount(user.id);
    assert.equal(account.available_credits, 96); assert.equal(account.reserved_credits, 0);
    const entries = adapter === "memory" ? repository.creditEntries : (await repository.pool.query("SELECT * FROM iabt_credit_entries")).rows;
    assert.deepEqual(entries.filter(e => ["capture", "release"].includes(e.entry_type)).map(e => [e.entry_type, e.amount]).sort(), [["capture", 4], ["release", 50]]);
    assert.equal((await repository.listStoredObjects(user)).length, 1);
  });
  test(`${adapter}: lost lease, missing artifact and missing reservation cannot settle`, options, async t => {
    const { repository, user, job, artifact } = await fixture(t, adapter);
    await assert.rejects(repository.completeJob({ jobId: job.id, workerId: "other", artifact }), { code: "job_lease_lost" });
    await assert.rejects(repository.completeJob({ jobId: job.id, workerId: "worker" }), { code: "durable_output_required" });
    if (adapter === "memory") repository.creditAccount(user.id).reserved_credits = 0;
    else await repository.pool.query("UPDATE iabt_credit_accounts SET reserved_credits=0 WHERE owner_id=$1", [user.id]);
    await assert.rejects(repository.completeJob({ jobId: job.id, workerId: "worker", artifact }), { code: "credit_reservation_missing" });
    assert.equal((await repository.getJob(job.id, user)).status, "running");
    assert.equal((await repository.getCreditAccount(user.id)).available_credits, 46);
    assert.equal((await repository.listStoredObjects(user)).length, 0);
  });
}
