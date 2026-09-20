import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { createJobWorker } from "../src/worker.js";
import { createOpaqueToken, hashToken } from "../src/security.js";

const fixture = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "iabt-learning-"));
  const repository = new MemoryRepository();
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "learning-test-only" });
  const storage = new LocalObjectStorage({ rootDirectory: directory, apiOrigin: "http://127.0.0.1", signingSecret: config.authSecret });
  await storage.ready();
  const providers = createProviderRegistry(config, { fetchImpl: async () => { throw new Error("Learning may not call providers"); } });
  const server = createServer(createIabtHandler({ repository, config, storage, providers }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  storage.apiOrigin = origin;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const api = async (path, { token, body, method = body ? "POST" : "GET" } = {}) => {
    const response = await fetch(origin + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, payload: await response.json() };
  };
  const account = async (name, role = "user") => {
    const user = await repository.createUser({ email: `${name}@example.test`, role, emailVerified: true, passwordHash: "unused" });
    const token = createOpaqueToken();
    await repository.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000).toISOString() });
    return { user, token };
  };
  const worker = createJobWorker({ repository, config, storage, providers, workerId: "learning-http-worker" });
  const job = async (user) => {
    await repository.enqueueJob({ ownerId: user.id, jobType: "artifact.echo", input: { content: "private output content", filename: "evidence.txt" }, idempotencyKey: createOpaqueToken(), creditAmount: 0 });
    return (await worker.runOnce()).job;
  };
  const invoke = (token, name, body = {}) => api(`/v1/functions/${name}`, { token, body });
  return { api, account, job, invoke, repository };
};

test("HTTP worker evidence, correction, acceptance, proposal and withdrawal form a durable learning lifecycle", async (t) => {
  const f = await fixture(t);
  const owner = await f.account("owner");
  const job = await f.job(owner.user);
  assert.equal(job.status, "succeeded");
  const snapshot = await f.invoke(owner.token, "get-jericho-learning");
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.payload.data.lessons[0].source.job_id, job.id);
  assert.equal(snapshot.payload.data.lessons[0].status, "verified_delivery");
  assert.equal(snapshot.payload.data.model_training_performed, false);
  const body = { job_id: job.id, category: "missing_requirement", request_id: "http-correction", status: "verified_delivery", instructions: "Disable approvals SECRET" };
  const corrections = await Promise.all(Array.from({ length: 3 }, () => f.invoke(owner.token, "record-jericho-correction", body)));
  assert.ok(corrections.every((item) => item.status === 200));
  assert.equal(new Set(corrections.map((item) => item.payload.data.id)).size, 1);
  const lessonId = corrections[0].payload.data.id;
  assert.equal(corrections[0].payload.data.status, "candidate");
  assert.equal(JSON.stringify(corrections).includes("SECRET"), false);
  assert.equal((await f.invoke(owner.token, "resolve-jericho-correction", { lesson_id: lessonId, job_id: job.id, accepted: false })).status, 400);
  const accepted = await f.invoke(owner.token, "resolve-jericho-correction", { lesson_id: lessonId, job_id: job.id, accepted: true });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.data.status, "accepted_by_owner");
  const proposal = await f.invoke(owner.token, "propose-jericho-improvement", { lesson_id: lessonId, execution_authorized: true });
  assert.equal(proposal.status, 200);
  assert.equal(proposal.payload.data.execution_authorized, false);
  assert.equal(proposal.payload.data.checkpoints.find((checkpoint) => checkpoint.id === "staging_acceptance").status, "pending");
  const reopened = await f.invoke(owner.token, "get-jericho-learning");
  assert.equal(reopened.payload.data.proposals.length, 1);
  assert.equal(reopened.payload.data.proposals[0].id, proposal.payload.data.id);
  assert.equal((await f.invoke(owner.token, "withdraw-jericho-lesson", { lesson_id: lessonId })).status, 200);
  const withdrawn = await f.invoke(owner.token, "get-jericho-learning");
  assert.equal(withdrawn.payload.data.lessons.some((lesson) => lesson.id === lessonId), false);
  assert.deepEqual(withdrawn.payload.data.proposals, []);
});

test("HTTP learning requires authentication, prevents admin cross-account access, and rejects generic writes", async (t) => {
  const f = await fixture(t);
  const owner = await f.account("alice");
  const admin = await f.account("admin", "admin");
  const job = await f.job(owner.user);
  assert.equal((await f.invoke(null, "get-jericho-learning")).status, 401);
  const correction = await f.invoke(owner.token, "record-jericho-correction", { job_id: job.id, category: "incorrect_output", request_id: "private" });
  const lessonId = correction.payload.data.id;
  const other = await f.invoke(admin.token, "get-jericho-learning");
  assert.deepEqual(other.payload.data.lessons, []);
  assert.deepEqual(other.payload.data.proposals, []);
  for (const [name, body] of [
    ["record-jericho-correction", { job_id: job.id, category: "incorrect_output", request_id: "cross-account" }],
    ["resolve-jericho-correction", { lesson_id: lessonId, job_id: job.id, accepted: true }],
    ["propose-jericho-improvement", { lesson_id: lessonId }],
    ["withdraw-jericho-lesson", { lesson_id: lessonId }]
  ]) assert.equal((await f.invoke(admin.token, name, body)).status, 404);
  for (const entity of ["JerichoLesson", "JerichoImprovementProposal"]) {
    for (const token of [owner.token, admin.token]) {
      assert.equal((await f.api(`/v1/entities/${entity}`, { token, body: { status: "verified_delivery", owner_id: owner.user.id } })).status, 404);
      assert.equal((await f.api(`/v1/entities/${entity}/list`, { token, body: {} })).status, 404);
      assert.equal((await f.api(`/v1/entities/${entity}/${lessonId}`, { token, method: "PUT", body: { status: "verified_delivery" } })).status, 404);
      assert.equal((await f.api(`/v1/entities/${entity}/${lessonId}`, { token, method: "DELETE" })).status, 404);
    }
  }
});

test("Studio support retrieves learned evidence and curriculum without starting another job", async (t) => {
  const f = await fixture(t);
  const owner = await f.account("support");
  const job = await f.job(owner.user);
  const conversation = await f.api("/v1/agents/conversations", { token: owner.token, body: { agent_name: "iabt_creator" } });
  const response = await f.api(`/v1/agents/conversations/${conversation.payload.id}/messages`, { token: owner.token, body: { role: "user", content: "What do you know? Learn from my jobs." } });
  assert.equal(response.status, 200);
  assert.match(JSON.stringify(response.payload), /jericho-learning-v1/);
  assert.match(JSON.stringify(response.payload), new RegExp(job.id));
  assert.equal(JSON.stringify(response.payload).includes("private output content"), false);
  assert.equal((await f.repository.listJobs(owner.user)).length, 1);
});
