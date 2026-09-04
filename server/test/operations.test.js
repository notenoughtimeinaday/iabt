import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { createObjectStorage } from "../src/storage/storage-factory.js";
import { createJobWorker } from "../src/worker.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const makeStorage = async () => {
  const directory = await mkdtemp(join(tmpdir(), "iabt-operations-"));
  temporaryDirectories.push(directory);
  const storage = new LocalObjectStorage({
    rootDirectory: directory,
    apiOrigin: "http://127.0.0.1:8787",
    signingSecret: "test-signing-secret"
  });
  await storage.ready();
  return storage;
};

const makeUser = async (repository, email) =>
  repository.createUser({
    email,
    passwordHash: "not-used-in-operational-tests",
    emailVerified: true
  });

const testConfig = () =>
  loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "test-only-auth-secret",
    IABT_JOB_LEASE_MS: "1000",
    IABT_JOB_POLL_MS: "50"
  });

test("idempotent jobs reserve once and capture only after durable storage", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "queue@example.com");
  await repository.grantCredits({
    ownerId: user.id,
    amount: 2,
    idempotencyKey: "opening-balance"
  });

  const input = {
    ownerId: user.id,
    jobType: "artifact.echo",
    input: { content: "verified artifact", filename: "proof.txt" },
    idempotencyKey: "job-1",
    creditAmount: 1
  };
  const first = await repository.enqueueJob(input);
  const duplicate = await repository.enqueueJob(input);
  assert.equal(duplicate.id, first.id);
  const reservedAccount = await repository.getCreditAccount(user.id);
  assert.equal(reservedAccount.owner_id, user.id);
  assert.equal(reservedAccount.available_credits, 1);
  assert.equal(reservedAccount.reserved_credits, 1);

  const storage = await makeStorage();
  const providers = {
    execute: async () => {
      throw new Error("No provider should run for a deterministic artifact");
    }
  };
  const worker = createJobWorker({
    repository,
    storage,
    providers,
    config: testConfig(),
    workerId: "worker-success"
  });
  const completed = await worker.runOnce();
  assert.equal(completed.job.status, "succeeded");
  assert.equal(completed.artifact.original_name, "proof.txt");
  assert.equal((await storage.read(completed.artifact.storage_key)).toString(), "verified artifact");
  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 1);
  assert.equal(account.reserved_credits, 0);
  assert.equal(
    repository.creditEntries.filter((entry) => entry.entry_type === "capture").length,
    1
  );
});

test("terminal configuration failures create an incident and restore credits", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "failure@example.com");
  await repository.grantCredits({
    ownerId: user.id,
    amount: 1,
    idempotencyKey: "opening-balance"
  });
  const job = await repository.enqueueJob({
    ownerId: user.id,
    jobType: "provider.elevenlabs.music",
    input: {
      prompt: "Three-second original piano chord",
      music_length_ms: 3000,
      estimated_cost_cents: 1
    },
    approval: {
      approved: true,
      approval_id: "owner-approved-quote",
      scope: "owner_demo",
      max_cost_cents: 1
    },
    idempotencyKey: "audio-job-1",
    creditAmount: 1
  });
  let fetchCalls = 0;
  const providers = createProviderRegistry(testConfig(), {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("Provider must not be reached when configuration is incomplete");
    }
  });
  const worker = createJobWorker({
    repository,
    storage: await makeStorage(),
    providers,
    config: testConfig(),
    workerId: "worker-failure"
  });
  const failed = await worker.runOnce();
  assert.equal(fetchCalls, 0);
  assert.equal(failed.job.id, job.id);
  assert.equal(failed.job.status, "needs_setup");
  assert.equal(failed.released_credits, 1);
  assert.equal(failed.incident.category, "configuration");
  assert.equal(failed.incident.owner_id, user.id);
  assert.equal(failed.job.output.incident_id, failed.incident.id);
  assert.equal(failed.job.output.recovery, "credit_release");
  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 1);
  assert.equal(account.reserved_credits, 0);
});

test("credit capture is refused when a job has no durable artifact", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "capture@example.com");
  await repository.grantCredits({
    ownerId: user.id,
    amount: 1,
    idempotencyKey: "opening-balance"
  });
  const queued = await repository.enqueueJob({
    ownerId: user.id,
    jobType: "artifact.echo",
    input: { content: "proof" },
    idempotencyKey: "capture-job",
    creditAmount: 1
  });
  const claimed = await repository.claimNextJob({ workerId: "capture-worker" });
  assert.equal(claimed.id, queued.id);
  await assert.rejects(
    repository.completeJob({
      jobId: queued.id,
      workerId: "capture-worker",
      output: { claimed_success: true }
    }),
    (error) => error.code === "durable_output_required"
  );
  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 0);
  assert.equal(account.reserved_credits, 1);
});

test("retryable provider failures retain the reservation until the retry budget ends", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "retry@example.com");
  await repository.grantCredits({
    ownerId: user.id,
    amount: 1,
    idempotencyKey: "opening-balance"
  });
  await repository.enqueueJob({
    ownerId: user.id,
    jobType: "provider.openai.response",
    input: { input: "Create a piano app" },
    approval: {
      approved: true,
      approval_id: "quote-2",
      max_cost_cents: 5
    },
    idempotencyKey: "retry-job",
    creditAmount: 1,
    maxAttempts: 3
  });
  const providers = {
    execute: async () => {
      throw Object.assign(new Error("Temporary provider outage"), {
        code: "openai_provider_unavailable",
        retryable: true
      });
    }
  };
  const worker = createJobWorker({
    repository,
    storage: await makeStorage(),
    providers,
    config: testConfig(),
    workerId: "worker-retry"
  });
  const result = await worker.runOnce();
  assert.equal(result.job.status, "queued");
  assert.equal(result.released_credits, 0);
  assert.equal(result.incident, null);
  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 0);
  assert.equal(account.reserved_credits, 1);
});

test("provider adapters reject unapproved paid calls before network access", async () => {
  let fetchCalls = 0;
  const config = loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "test-only-auth-secret",
    OPENAI_API_KEY: "configured-test-key",
    IABT_ENABLE_PAID_AI: "true"
  });
  const providers = createProviderRegistry(config, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("Network should not be reached");
    }
  });
  await assert.rejects(
    providers.execute(
      "openai",
      "response",
      { input: "Create an app", estimated_cost_cents: 1 },
      { idempotencyKey: "missing-approval" }
    ),
    (error) => error.code === "explicit_approval_required"
  );
  assert.equal(fetchCalls, 0);
});

test("asynchronous Luma jobs submit once, poll durably, and capture only after verified MP4 storage", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({
    email: "video-owner@example.com",
    passwordHash: "unused",
    emailVerified: true,
    role: "admin"
  });
  await repository.grantCredits({
    ownerId: user.id,
    amount: 2,
    idempotencyKey: "video-opening-balance"
  });
  const job = await repository.enqueueJob({
    ownerId: user.id,
    jobType: "provider.luma.video",
    input: {
      title: "Owner Demo",
      prompt: "Create a five-second original abstract motion test",
      duration_seconds: 5,
      estimated_cost_cents: 3,
      render_ready: true
    },
    approval: {
      approved: true,
      approval_id: "video-owner-quote",
      scope: "owner_demo",
      max_cost_cents: 3
    },
    idempotencyKey: "video-owner-job",
    creditAmount: 1
  });

  let submissions = 0;
  let polls = 0;
  let downloads = 0;
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypmp42", "ascii"),
    Buffer.alloc(64)
  ]);
  const config = loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "luma-test-secret",
    LUMA_API_KEY: "configured-test-key",
    IABT_ENABLE_PAID_MEDIA: "true",
    IABT_MEDIA_BILLING_READY: "true",
    IABT_LUMA_COST_PER_5_SECONDS_CENTS: "3"
  });
  const providers = createProviderRegistry(config, {
    fetchImpl: async (url, options = {}) => {
      if (url === "https://agents.lumalabs.ai/v1/generations" && options.method === "POST") {
        submissions += 1;
        return new Response(JSON.stringify({ id: "generation_123", state: "queued" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "https://agents.lumalabs.ai/v1/generations/generation_123") {
        polls += 1;
        return new Response(JSON.stringify(
          polls === 1
            ? { id: "generation_123", state: "dreaming" }
            : {
                id: "generation_123",
                state: "completed",
                assets: { video: "https://media.example.test/video.mp4" }
              }
        ), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "https://media.example.test/video.mp4") {
        downloads += 1;
        return new Response(mp4, {
          status: 200,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(mp4.length)
          }
        });
      }
      throw new Error("Unexpected test URL: " + url);
    }
  });
  const storage = await makeStorage();
  const worker = createJobWorker({
    repository,
    storage,
    providers,
    config,
    workerId: "worker-luma"
  });

  const submitted = await worker.runOnce();
  assert.equal(submitted.deferred, true);
  assert.equal(submitted.job.status, "queued");
  assert.equal(submitted.job.input.provider_job_id, "generation_123");
  assert.equal(submitted.job.attempt_count, 0);

  const waiting = await worker.runOnce();
  assert.equal(waiting.deferred, true);
  assert.equal(waiting.job.output.provider_state, "processing");
  assert.equal(waiting.job.input.provider_poll_count, 1);

  const completed = await worker.runOnce();
  assert.equal(completed.job.id, job.id);
  assert.equal(completed.job.status, "succeeded");
  assert.equal(submissions, 1);
  assert.equal(polls, 2);
  assert.equal(downloads, 1);
  assert.equal(completed.artifacts.length, 1);
  assert.equal(completed.artifact.content_type, "video/mp4");
  const stored = await storage.read(completed.artifact.storage_key);
  assert.equal(stored.subarray(4, 8).toString("ascii"), "ftyp");

  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 1);
  assert.equal(account.reserved_credits, 0);
});

test("invalid asynchronous video output creates an incident and releases reserved credits", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "invalid-video@example.com");
  await repository.grantCredits({
    ownerId: user.id,
    amount: 1,
    idempotencyKey: "invalid-video-balance"
  });
  await repository.enqueueJob({
    ownerId: user.id,
    jobType: "provider.luma.video",
    input: {
      title: "Invalid Video Test",
      prompt: "Original test",
      duration_seconds: 5,
      estimated_cost_cents: 3,
      render_ready: true
    },
    approval: {
      approved: true,
      approval_id: "invalid-video-quote",
      scope: "owner_demo",
      max_cost_cents: 3
    },
    idempotencyKey: "invalid-video-job",
    creditAmount: 1
  });
  const config = loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "luma-invalid-test-secret",
    LUMA_API_KEY: "configured-test-key",
    IABT_ENABLE_PAID_MEDIA: "true",
    IABT_MEDIA_BILLING_READY: "true",
    IABT_LUMA_COST_PER_5_SECONDS_CENTS: "3"
  });
  const providers = createProviderRegistry(config, {
    fetchImpl: async (url) => {
      if (url === "https://agents.lumalabs.ai/v1/generations") {
        return new Response(JSON.stringify({
          id: "generation_bad",
          state: "completed",
          assets: { video: "https://media.example.test/not-video.mp4" }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("not an mp4", {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
  });
  const worker = createJobWorker({
    repository,
    storage: await makeStorage(),
    providers,
    config,
    workerId: "worker-invalid-luma"
  });

  const failed = await worker.runOnce();
  assert.equal(failed.job.status, "failed");
  assert.equal(failed.job.last_error_code, "luma_invalid_video");
  assert.equal(failed.released_credits, 1);
  assert.equal(failed.incident.error_code, "luma_invalid_video");
  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 1);
  assert.equal(account.reserved_credits, 0);
});

test("production refuses local artifact storage", async () => {
  const config = loadConfig({
    NODE_ENV: "production",
    IABT_AUTH_SECRET: "production-test-secret",
    IABT_PUBLIC_ORIGIN: "https://insuredspending.org",
    IABT_API_ORIGIN: "https://api.insuredspending.org",
    IABT_STORAGE_PROVIDER: "local"
  });
  await assert.rejects(
    createObjectStorage(config),
    /S3-compatible private object storage is required in production/
  );
});
