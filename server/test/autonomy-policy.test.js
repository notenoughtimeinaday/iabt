import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateAction, creationPolicy } from "../src/autonomy/policy.js";
import { capabilityRegistry } from "../src/autonomy/capabilities.js";
import { createCreationPlan, executeCreationPlan, verifyQuoteSignature, creationRequestDisposition } from "../src/creation/planner.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { createJobWorker } from "../src/worker.js";

async function fixture(t, env = {}) {
  const directory = await mkdtemp(join(tmpdir(), "iabt-autonomy-policy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "autonomy-policy-test", ...env });
  const repository = new MemoryRepository();
  const storage = new LocalObjectStorage({ rootDirectory: directory, signingSecret: config.authSecret });
  await storage.ready();
  let calls = 0;
  const providers = createProviderRegistry(config, { fetchImpl: async () => { calls++; throw new Error("No external provider call authorized by this test"); } });
  const user = await repository.createUser({ email: "creator@example.test", passwordHash: "unused", emailVerified: true });
  await repository.grantCredits({ ownerId: user.id, amount: 20, idempotencyKey: "opening" });
  const context = { repository, config, providers, storage, user };
  const plan = (extra = {}) => createCreationPlan({ ...context, requestText: "Create a report about a neighborhood bookstore", ...extra });
  const execute = (record, extra = {}, options = {}) => executeCreationPlan({ ...context, ...options, body: { plan_id: record.id, approved: true, pricing_version: record.pricing_version, accepted_total_cents: record.total_estimated_cost_cents, ...extra } });
  const upload = async (content) => {
    const id = randomUUID();
    const bytes = Buffer.from(content);
    const stored = await storage.put({ ownerId: user.id, objectId: id, bytes });
    return repository.createStoredObject({ id, ownerId: user.id, storageProvider: stored.storage_provider, storageKey: stored.storage_key, originalName: "requirements.md", contentType: "text/markdown", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  return { ...context, plan, execute, upload, calls: () => calls };
}

test("server policy permits authorized reversible zero-cost actions and fails closed otherwise", () => {
  const safe = { risk_class: "generate", reversible: true, estimated_cost_cents: 0 };
  assert.equal(evaluateAction(safe, { authorized: true }).automatic, true);
  assert.equal(evaluateAction(safe).automatic, false);
  for (const risk of ["spending", "destructive", "publication", "external_communication", "legal", "access_change", "security_change", "dns", "machine_control", "sensitive_transmission", "unregistered"]) {
    assert.equal(evaluateAction({ ...safe, risk_class: risk }, { authorized: true }).automatic, false, risk);
  }
  for (const cost of [undefined, null, "0", -1, 1, NaN, Infinity]) {
    assert.equal(evaluateAction({ ...safe, estimated_cost_cents: cost }, { authorized: true, budgetCents: 100 }).automatic, false, String(cost));
  }
  assert.equal(evaluateAction({ ...safe, reversible: false }, { authorized: true }).automatic, false);
  assert.equal(evaluateAction({ ...safe, additional_risks: ["publication"] }, { authorized: true }).automatic, false);
});

test("affirmative creation gate distinguishes tasks from conversation, explanation and withheld execution", async (t) => {
  for (const text of ["Create a document", "Please build a piano app", "Can you write a report about gardens?", "Review the attached source", "Thanks, make a checklist", "I need a report about gardens", "I'd like a website for a bookstore"]) {
    assert.equal(creationRequestDisposition(text).create, true, text);
  }
  const f = await fixture(t);
  for (const text of ["Hello", "Thanks", "Okay", "Do not create anything yet", "Please don't build the app yet", "I want a report but do not create it yet", "I want a report but don't write it yet", "I need a design but do not begin until tomorrow", "I want a report but not right now", "Create a report but wait for my approval", "Just a quote for a new app", "Plan only", "Before creating anything, explain the requirements", "Tell me how to create an app", "Can you create apps?", "Create nothing"]) {
    assert.equal(creationRequestDisposition(text).create, false, text);
    const result = await f.plan({ requestText: text, automatic: true });
    assert.equal(result.billing.action, "quote_only", text);
    assert.equal(result.billing.credits_reserved, false);
  }
  assert.equal((await f.repository.listJobs(f.user)).length, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
});

test("reused terminal jobs repair stale quoted and executing plan projections without restarting work", async (t) => {
  const f = await fixture(t);
  const first = await f.plan({ automatic: true });
  const worker = createJobWorker({ ...f, workerId: "projection-worker" });
  assert.equal((await worker.runOnce()).job.status, "succeeded");
  await f.repository.updateRecord("CreationPlan", first.plan.id, f.user, { status: "quoted" });
  const replay = await f.execute(first.plan);
  assert.equal(replay.reused, true);
  assert.equal(replay.plan.status, "succeeded");
  assert.equal(replay.job.status, "succeeded");
  assert.equal(replay.job.usage_state, "captured");
  assert.equal(replay.billing.credits_reserved, false);
  assert.equal(replay.billing.action, "already_finalized");
  await f.repository.updateRecord("CreationPlan", first.plan.id, f.user, { status: "executing" });
  const reloaded = await f.execute(first.plan);
  assert.equal(reloaded.plan.status, "succeeded");
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 19);
  assert.equal((await f.repository.listJobs(f.user)).length, 1);
});

test("a worker completion between enqueue and plan write cannot be overwritten by executing", async (t) => {
  const f = await fixture(t);
  const quoted = await f.plan();
  const worker = createJobWorker({ ...f, workerId: "interleaved-worker" });
  const update = f.repository.updateRecord.bind(f.repository);
  let interleaved = false;
  f.repository.updateRecord = async (entity, id, user, patch) => {
    if (!interleaved && entity === "CreationPlan" && id === quoted.plan.id && patch.status === "executing") {
      interleaved = true;
      assert.equal((await worker.runOnce()).job.status, "succeeded");
    }
    return update(entity, id, user, patch);
  };
  const result = await f.execute(quoted.plan);
  assert.equal(interleaved, true);
  assert.equal(result.plan.status, "succeeded");
  assert.equal((await f.repository.getRecord("CreationPlan", quoted.plan.id, f.user)).status, "succeeded");
  assert.equal(result.billing.credits_reserved, false);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
});

test("creation policy matches an exact server route rather than trusting client/model risk labels", () => {
  const safe = { provider: "iabt-standalone", job_type: "creation.document", capability_id: "iabt-document-v2", provider_cost_cents: 0 };
  assert.equal(creationPolicy(safe).automatic, true);
  for (const patch of [{ provider: "openai" }, { job_type: "creation.unregistered" }, { capability_id: "model-approved" }, { provider_cost_cents: "0" }]) {
    assert.equal(creationPolicy({ ...safe, ...patch, risk_class: "generate", approved: true }).automatic, false);
  }
});

test("configured remote services remain unverified and registry never exposes credentials", async (t) => {
  const f = await fixture(t, { OPENAI_API_KEY: "secret-provider-test", IABT_ENABLE_PAID_AI: "true", RESEND_API_KEY: "secret-mail-test", IABT_EMAIL_FROM: "owner@example.test" });
  const registry = await capabilityRegistry(f);
  assert.equal(registry.capabilities.resend.configured, true);
  assert.equal(registry.capabilities.resend.operational, null);
  assert.equal(registry.capabilities.openai_responses.operational, null);
  assert.equal(registry.capabilities.background_jobs.operational, null);
  assert.equal(registry.capabilities.private_storage.operational, true);
  assert.equal(registry.capabilities.app.operational, true);
  assert.equal(JSON.stringify(registry).includes("secret-"), false);
  const failed = await capabilityRegistry({ ...f, storage: { health: async () => { throw new Error("unavailable"); } } });
  assert.equal(failed.capabilities.app.operational, false);
  assert.ok(failed.capabilities.app.blocker_codes.includes("storage_not_verified"));
  assert.equal(f.calls(), 0);
});

test("safe objective reserves once automatically and captures only after verified private delivery", async (t) => {
  const f = await fixture(t);
  const result = await f.plan({ automatic: true, submissionId: "create-report" });
  assert.equal(result.plan.title, "JERICHO Document");
  assert.equal(result.plan.autonomy_policy.automatic, true);
  assert.equal(result.plan.status, "executing");
  assert.equal((await f.repository.getJob(result.job.id, f.user)).approval.source, "autonomy_policy");
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 1);
  const worker = createJobWorker({ ...f, workerId: "policy-test-worker" });
  const finished = await worker.runOnce();
  assert.equal(finished.job.status, "succeeded");
  assert.equal(finished.artifacts.length, 3);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 19);
  const repeated = await f.plan({ automatic: true, submissionId: "create-report" });
  assert.equal(repeated.job.id, result.job.id);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 19);
  assert.equal(f.calls(), 0);
});

test("quote-only compatibility and browser-injected automatic approval cannot reserve credits", async (t) => {
  const f = await fixture(t);
  const result = await f.plan();
  assert.equal(result.billing.action, "quote_only");
  assert.equal(result.quote.requires_explicit_approval, true);
  await assert.rejects(f.execute(result.plan, { approved: false, automatic: true }), { code: "explicit_approval_required" });
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
});

test("concurrent objective replays and different approval keys reserve one job and one consent", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.plan({ automatic: true, submissionId: "retry-safe-objective" })));
  assert.equal(new Set(results.map((item) => item.job.id)).size, 1);
  await Promise.all(Array.from({ length: 8 }, (_, index) => f.execute(results[0].plan, { idempotency_key: "different-key-" + index })));
  assert.equal((await f.repository.listJobs(f.user)).length, 1);
  assert.equal((await f.repository.listRecords("ConsentGrant", f.user)).length, 1);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 1);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 19);
  await assert.rejects(f.plan({ automatic: true, submissionId: "retry-safe-objective", requestText: "Create a report about a different goal" }), { code: "idempotency_conflict" });
});

test("quote signature binds execution route, normalized arguments and context", async (t) => {
  const f = await fixture(t);
  for (const patch of [{ job_type: "provider.openai.image" }, { normalized_spec: { creative_prompt: "different request", orchestration_budget_cents: 10000 } }, { project_id: "some-other-project" }]) {
    const { plan } = await f.plan();
    assert.equal(verifyQuoteSignature(f.config, plan), true);
    await f.repository.updateRecord("CreationPlan", plan.id, f.user, patch);
    await assert.rejects(f.execute(plan), { code: "quote_mismatch" });
  }
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
});

test("source review remains private, automatic, hash-bound and provider-free", async (t) => {
  const f = await fixture(t);
  const source = await f.upload("# Requirements\n- Preserve user evidence.");
  const result = await f.plan({ requestText: "Review the attached file", fileIds: [source.id], automatic: true, submissionId: "source-review" });
  assert.equal(result.plan.capability_id, "iabt-source-review-v1");
  assert.equal(result.plan.file_references[0].sha256, source.sha256);
  assert.equal(result.plan.job_type, "creation.document");
  await writeFile(f.storage.resolveKey(source.storage_key), "# Altered evidence");
  await assert.rejects(f.plan({ requestText: "Review the attached file", fileIds: [source.id], automatic: true, submissionId: "source-review" }), (error) => ["source_integrity_failed", "source_changed"].includes(error.code));
  assert.equal(f.calls(), 0);
});

test("paid media and Responses orchestration require explicit quotes despite automatic objective mode", async (t) => {
  const f = await fixture(t, {
    OPENAI_API_KEY: "paid-model-test", IABT_ENABLE_PAID_AI: "true", IABT_ENABLE_PAID_IMAGES: "true", IABT_OPENAI_IMAGE_COST_CENTS: "5", IABT_OPENAI_IMAGE_COMMERCIAL_APPROVED: "true",
    IABT_ENABLE_ORCHESTRATION: "true", IABT_ORCHESTRATION_BUDGET_ACCEPTED: "true", IABT_OPENAI_RESPONSE_COST_CENTS: "2", IABT_ORCHESTRATION_BUDGET_CENTS: "12"
  });
  for (const requestText of ["Create an original image", "Create a document about gardens"]) {
    const result = await f.plan({ requestText, automatic: true });
    assert.equal(result.plan.autonomy_policy.automatic, false);
    assert.equal(result.billing.action, "quote_only");
    await assert.rejects(f.execute(result.plan, { approved: false }, { automatic: true }), { code: "explicit_approval_required" });
    if (result.plan.intent === "document") {
      assert.equal(result.plan.job_type, "creation.orchestrated");
      assert.equal(result.plan.provider_cost_cents, 12);
      assert.equal(result.plan.normalized_spec.orchestration_budget_cents, 12);
      const executed = await f.execute(result.plan);
      const job = await f.repository.getJob(executed.job.id, f.user);
      assert.equal(job.approval.source, "explicit_user");
      assert.equal(job.approval.max_cost_cents, 12);
    }
  }
  assert.equal(f.calls(), 0);
});
