import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createJobWorker } from "../src/worker.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const fixture = async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "worker@example.com", passwordHash: "unused", emailVerified: true });
  await repository.grantCredits({ ownerId: user.id, amount: 5, idempotencyKey: "opening" });
  let stored = 0;
  const objects = new Map();
  const storage = {
    async put({ objectId, bytes }) {
      stored += 1;
      objects.set("private/" + objectId, Buffer.from(bytes));
      return { storage_provider: "test", storage_key: "private/" + objectId };
    },
    async read(key) {
      return objects.get(key);
    }
  };
  const config = loadConfig({ NODE_ENV: "test", IABT_JOB_LEASE_MS: "60", IABT_JOB_POLL_MS: "10" });
  const enqueue = (extra = {}) => repository.enqueueJob({
    ownerId: user.id,
    jobType: "artifact.echo",
    input: { content: "verified test" },
    idempotencyKey: "job-" + repository.jobs.size,
    creditAmount: 1,
    ...extra
  });
  const worker = (providers = { execute: async () => { throw new Error("Unexpected provider call"); } }) =>
    createJobWorker({ repository, storage, providers, config, workerId: "current-worker" });
  return { repository, user, enqueue, worker, stored: () => stored };
};

const providerResult = () => ({ bytes: Buffer.from("verified provider output"), filename: "result.txt", contentType: "text/plain" });

test("heartbeat keeps a long provider job leased and prevents a second worker claiming it", async (t) => {
  const env = await fixture();
  await env.enqueue({ jobType: "provider.openai.response" });
  const entered = deferred();
  const finish = deferred();
  let submissions = 0;
  const worker = env.worker({ execute: async () => {
    submissions += 1;
    entered.resolve();
    await finish.promise;
    return providerResult();
  } });
  t.after(async () => { finish.resolve(); await worker.stop(); });
  const completion = worker.runOnce();
  await entered.promise;
  await delay(130);
  const competing = await env.repository.claimNextJob({ workerId: "competing-worker", leaseMs: 60 });
  assert.equal(competing, null);
  finish.resolve();
  assert.equal((await completion).job.status, "succeeded");
  assert.equal(submissions, 1);
});

test("stop drains the active job and heartbeat before allowing repository shutdown, without claiming another job", async (t) => {
  const env = await fixture();
  const first = await env.enqueue({ jobType: "provider.openai.response" });
  const second = await env.enqueue();
  const entered = deferred();
  const finish = deferred();
  const worker = env.worker({ execute: async () => { entered.resolve(); await finish.promise; return providerResult(); } });
  t.after(async () => { finish.resolve(); await worker.stop(); });
  worker.start();
  await entered.promise;
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await delay(30);
  assert.equal(stopped, false);
  finish.resolve();
  await stopping;
  assert.equal((await env.repository.getJob(first.id, env.user)).status, "succeeded");
  assert.equal((await env.repository.getJob(second.id, env.user)).status, "queued");
  assert.equal(await worker.runOnce(), null);
  const lockedAt = env.repository.jobs.get(first.id).locked_at;
  await delay(30);
  assert.equal(env.repository.jobs.get(first.id).locked_at, lockedAt);
});

test("crash recovery ends an exhausted retry budget and releases credits exactly once", async () => {
  const env = await fixture();
  const job = await env.enqueue({ maxAttempts: 1 });
  await env.repository.claimNextJob({ workerId: "crashed-worker" });
  env.repository.jobs.get(job.id).locked_at = "2000-01-01T00:00:00.000Z";
  const worker = env.worker();
  const result = await worker.runOnce();
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.last_error_code, "job_attempts_exhausted");
  assert.equal(result.job.attempt_count, 1);
  assert.equal(result.released_credits, 1);
  assert.equal(env.stored(), 0);
  assert.equal(await worker.runOnce(), null);
  assert.equal(env.repository.creditEntries.filter((item) => item.entry_type === "release").length, 1);
  assert.equal((await env.repository.getCreditAccount(env.user.id)).reserved_credits, 0);
  await worker.stop();
});

test("recovered paid submission with no persisted provider ID is not submitted a second time", async () => {
  const env = await fixture();
  const job = await env.enqueue({ jobType: "provider.elevenlabs.music", maxAttempts: 3 });
  await env.repository.claimNextJob({ workerId: "crashed-worker" });
  env.repository.jobs.get(job.id).locked_at = "2000-01-01T00:00:00.000Z";
  let submissions = 0;
  const worker = env.worker({ execute: async () => { submissions += 1; return providerResult(); } });
  const result = await worker.runOnce();
  assert.equal(submissions, 0);
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.last_error_code, "provider_outcome_unknown");
  assert.match(result.incident.safe_message, /reconciliation/);
  assert.equal(result.released_credits, 1);
  assert.equal(env.stored(), 0);
  await worker.stop();
});

test("lease loss during provider execution prevents stale storage and credit finalization", async (t) => {
  const env = await fixture();
  const job = await env.enqueue({ jobType: "provider.openai.response" });
  const entered = deferred();
  const finish = deferred();
  const worker = env.worker({ execute: async () => { entered.resolve(); await finish.promise; return providerResult(); } });
  t.after(async () => { finish.resolve(); await worker.stop(); });
  const completion = worker.runOnce();
  await entered.promise;
  env.repository.jobs.get(job.id).locked_by = "replacement-worker";
  finish.resolve();
  await assert.rejects(completion, { code: "job_lease_lost" });
  assert.equal(env.stored(), 0);
  assert.equal(env.repository.creditEntries.some((item) => ["capture", "release"].includes(item.entry_type)), false);
  assert.equal((await env.repository.getCreditAccount(env.user.id)).reserved_credits, 1);
});

test("durable job success survives a later plan status synchronization failure", async () => {
  const env = await fixture();
  await env.enqueue({ input: { content: "durable output", plan_id: "plan-existing" } });
  env.repository.updateRecord = async () => { throw new Error("Projection unavailable"); };
  let failCalls = 0;
  const originalFail = env.repository.failJob.bind(env.repository);
  env.repository.failJob = async (input) => { failCalls += 1; return originalFail(input); };
  const worker = env.worker();
  const completed = await worker.runOnce();
  assert.equal(completed.job.status, "succeeded");
  assert.equal(completed.job.output.verified, true);
  assert.equal(failCalls, 0);
  assert.equal(env.repository.creditEntries.filter((item) => item.entry_type === "capture").length, 1);
  assert.equal(env.repository.creditEntries.filter((item) => item.entry_type === "release").length, 0);
  assert.equal(await worker.runOnce(), null);
  await worker.stop();
});

test("a retrying job reports held credits rather than claiming a completed restoration", async () => {
  const env = await fixture();
  await env.enqueue({ jobType: "provider.openai.response" });
  const worker = env.worker({ execute: async () => {
    throw Object.assign(new Error("Temporary outage"), { code: "openai_provider_unavailable", retryable: true });
  } });
  const result = await worker.runOnce();
  assert.equal(result.job.status, "queued");
  assert.equal(result.released_credits, 0);
  assert.match(result.job.last_error_message, /credits remain held/);
  assert.doesNotMatch(result.job.last_error_message, /credits were restored/);
  await worker.stop();
});
