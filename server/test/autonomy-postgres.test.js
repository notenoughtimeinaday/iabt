import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { createJobWorker } from "../src/worker.js";

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;
const postgresTest = (name, callback) => test(name, {
  skip: !connectionString && "Set IABT_AUTH_TEST_DATABASE_URL to a disposable local PostgreSQL test database",
  timeout: 30000
}, callback);

async function fixture(t) {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
  const schema = "autonomy_http_test_" + randomUUID().replaceAll("-", "");
  assert.match(schema, /^autonomy_http_test_[a-f0-9]{32}$/);
  const control = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const directory = await mkdtemp(join(tmpdir(), "iabt-postgres-autonomy-"));
  const instances = [];
  let providerCalls = 0;
  const sentEmail = [];
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: randomUUID(), IABT_DATABASE_URL: connectionString, IABT_EXPOSE_DEV_OTP: "true" });
  t.after(async () => {
    for (const instance of instances) await instance.close();
    try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await control.end(); await rm(directory, { recursive: true, force: true }); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  const start = async () => {
    const repository = new PostgresRepository({ pool: new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 5000 }) });
    await repository.ready();
    const storage = new LocalObjectStorage({ rootDirectory: directory, signingSecret: config.authSecret });
    await storage.ready();
    const providers = createProviderRegistry(config, { fetchImpl: async () => { providerCalls++; throw new Error("External providers must not be called for private source review"); } });
    const emailSender = { configured: true, kind: "test", health: async () => ({ ok: true }), sendChallenge: async (message) => { sentEmail.push(message); return { id: randomUUID() }; } };
    const server = createServer(createIabtHandler({ repository, config, storage, providers, emailSender }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    storage.apiOrigin = origin;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await repository.close();
    };
    const api = async (path, { body, token, method = body === undefined ? "GET" : "POST" } = {}) => {
      const response = await fetch(origin + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, payload: await response.json() };
    };
    const instance = { repository, storage, providers, config, origin, api, close };
    instances.push(instance);
    return instance;
  };
  return { start, sentEmail, providerCalls: () => providerCalls };
}

postgresTest("postgres credit grants deduplicate one purchase across concurrent connections and restart", async (t) => {
  const f = await fixture(t);
  const first = await f.start();
  const second = await f.start();
  const user = await first.repository.createUser({ email: "credits@example.test", passwordHash: "unused", emailVerified: true });
  const grant = { ownerId: user.id, amount: 100, idempotencyKey: "stripe:checkout:same-purchase" };
  const responses = await Promise.all(Array.from({ length: 16 }, (_, index) => (index % 2 ? first : second).repository.grantCredits(grant)));
  assert.equal(responses.length, 16, "Every duplicate delivery must return successfully");
  assert.equal((await first.repository.getCreditAccount(user.id)).available_credits, 100);
  const rows = await first.repository.pool.query("SELECT count(*)::int AS count FROM iabt_credit_entries WHERE owner_id=$1 AND entry_type='grant'", [user.id]);
  assert.equal(rows.rows[0].count, 1);
  await first.close();
  const restarted = await f.start();
  assert.equal((await restarted.repository.grantCredits(grant)).available_credits, 100);
  assert.equal((await restarted.repository.grantCredits({ ...grant, idempotencyKey: "stripe:checkout:different-purchase" })).available_credits, 200);
});

postgresTest("postgres HTTP: verified account, automatic source review, private artifacts and learning survive restart without repeat charges", async (t) => {
  const f = await fixture(t);
  const first = await f.start();
  const email = "creator@example.test";
  const registration = await first.api("/v1/auth/register", { body: { email, password: "TestCreatorPassword123" } });
  assert.equal(registration.status, 201, JSON.stringify(registration.payload));
  const verified = await first.api("/v1/auth/verify-otp", { body: { email, code: registration.payload.dev_otp || f.sentEmail.at(-1).code } });
  assert.equal(verified.status, 200, JSON.stringify(verified.payload));
  const token = verified.payload.access_token;
  const user = verified.payload.user;
  assert.equal(user.email_verified, true);
  const opening = await first.repository.getCreditAccount(user.id);
  assert.ok(opening.available_credits >= 1);
  const createdChat = await first.api("/v1/agents/conversations", { token, body: { agent_name: "iabt_creator" } });
  assert.equal(createdChat.status, 201);
  const chatId = createdChat.payload.id;
  const marker = "PG-AUTONOMY-SOURCE-ONLY-20260920";
  const form = new FormData();
  form.append("file", new Blob([`# Source requirements\nMarker: ${marker}\n- Account history must survive restarts.\n- Require verification before successful delivery.\n`], { type: "text/markdown" }), "requirements.md");
  const uploadResponse = await fetch(first.origin + "/v1/files", { method: "POST", headers: { Authorization: "Bearer " + token }, body: form });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  const asset = await first.api("/v1/entities/Asset", { token, body: { name: "requirements.md", file_id: upload.file_id, project_id: "conversation:" + chatId, conversation_id: chatId, mime_type: "text/markdown" } });
  assert.equal(asset.status, 201);
  const body = { role: "user", content: "Create a report summarizing the attached source requirements.", file_ids: [upload.file_id], submission_id: "stable-source-report" };
  const peer = await f.start();
  const submissions = await Promise.all([first, peer].map((instance) => instance.api(`/v1/agents/conversations/${chatId}/messages`, { token, body })));
  assert.ok(submissions.every((result) => result.status === 200), JSON.stringify(submissions));
  assert.ok(submissions.every((result) => result.payload.messages.length === 2), "Concurrent retries must persist one conversation exchange");
  assert.equal(new Set(submissions.map((result) => result.payload.messages.at(-1).metadata.job_id)).size, 1, "Concurrent API instances must reserve one objective job");
  const sent = submissions[0];
  assert.equal(sent.status, 200, JSON.stringify(sent.payload));
  const assistant = sent.payload.messages.at(-1);
  assert.equal(assistant.metadata.automatic_execution, true);
  const jobId = assistant.metadata.job_id;
  const queued = await first.repository.getJob(jobId, user);
  assert.equal(queued.status, "queued");
  assert.equal(queued.approval.source, "autonomy_policy");
  assert.equal(queued.input.file_references[0].sha256, upload.sha256);
  assert.equal((await first.repository.getCreditAccount(user.id)).reserved_credits, 1);
  const worker = createJobWorker({ ...first, workerId: "postgres-http-autonomy-worker" });
  const finished = await worker.runOnce();
  assert.equal(finished.job.status, "succeeded", JSON.stringify(finished));
  assert.equal(finished.artifacts.length, 3);
  const lessons = await first.api("/v1/functions/get-jericho-learning", { token, body: {} });
  assert.equal(lessons.status, 200);
  const lesson = lessons.payload.data.lessons.find((item) => item.source.job_id === jobId);
  assert.ok(lesson, "Successful worker should persist an account-scoped observation");
  assert.equal(lesson.status, "verified_delivery");
  assert.equal(lesson.evidence.length, 3);
  const completed = await first.repository.getCreditAccount(user.id);
  assert.equal(completed.available_credits, opening.available_credits - 1);
  assert.equal(completed.reserved_credits, 0);
  await first.close();
  await peer.close();

  const restarted = await f.start();
  const reopened = await restarted.api(`/v1/agents/conversations/${chatId}`, { token });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.payload.messages[0].file_references[0].sha256, upload.sha256);
  assert.equal((await restarted.api(`/v1/entities/Asset/${asset.payload.id}`, { token })).payload.file_id, upload.file_id);
  for (const artifact of finished.artifacts) {
    const access = await restarted.api(`/v1/files/${artifact.id}/access`, { token });
    assert.equal(access.status, 200);
    const download = await fetch(access.payload.file_url);
    assert.equal(download.status, 200);
    assert.ok(Buffer.from(await download.arrayBuffer()).includes(Buffer.from(marker)), artifact.original_name);
  }
  const replay = await restarted.api(`/v1/agents/conversations/${chatId}/messages`, { token, body });
  assert.equal(replay.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.messages.length, 2, "Restart replay must not append duplicate messages");
  const conflict = await restarted.api(`/v1/agents/conversations/${chatId}/messages`, { token, body: { ...body, content: "Create a different report" } });
  assert.equal(conflict.status, 409);
  assert.equal(replay.payload.messages.at(-1).metadata.job_id, jobId);
  assert.equal((await restarted.repository.listJobs(user)).length, 1);
  assert.equal((await restarted.repository.getCreditAccount(user.id)).available_credits, completed.available_credits);
  assert.equal((await restarted.repository.getCreditAccount(user.id)).reserved_credits, 0);
  const reloadedLearning = await restarted.api("/v1/functions/get-jericho-learning", { token, body: {} });
  assert.equal(reloadedLearning.payload.data.lessons.filter((item) => item.source.job_id === jobId).length, 1);

  const another = await f.start();
  const correctionBody = { job_id: jobId, category: "missing_requirement", request_id: "same-correction-across-instances" };
  const corrections = await Promise.all([restarted, another].map((instance) => instance.api("/v1/functions/record-jericho-correction", { token, body: correctionBody })));
  assert.ok(corrections.every((result) => result.status === 200), JSON.stringify(corrections));
  assert.equal(corrections[0].payload.data.id, corrections[1].payload.data.id);
  const proposals = await Promise.all([restarted, another].map((instance) => instance.api("/v1/functions/propose-jericho-improvement", { token, body: { lesson_id: corrections[0].payload.data.id } })));
  assert.ok(proposals.every((result) => result.status === 200));
  assert.equal(proposals[0].payload.data.id, proposals[1].payload.data.id);
  assert.equal(proposals[0].payload.data.execution_authorized, false);
  assert.equal(proposals[0].payload.data.deployment_authorized, false);
  assert.equal((await another.api("/v1/functions/get-jericho-learning", { token, body: {} })).payload.data.proposals.length, 1);
  for (const content of ["Hello", "Thanks", "Do not create anything yet", "Please don't build an app yet", "Can you create apps?"]) {
    const chatOnly = await another.api(`/v1/agents/conversations/${chatId}/messages`, { token, body: { role: "user", content } });
    assert.equal(chatOnly.status, 200, JSON.stringify(chatOnly.payload));
    assert.equal(Boolean(chatOnly.payload.messages.at(-1).metadata?.job_id), false, content);
  }
  assert.equal((await another.repository.listJobs(user)).length, 1, "Conversation and explicit withholding must not create jobs");
  assert.equal((await another.repository.listRecords("CreationPlan", user)).length, 1, "Read-only conversation must not create quotes");
  assert.equal((await another.repository.getCreditAccount(user.id)).available_credits, completed.available_credits);
  assert.equal((await another.repository.getCreditAccount(user.id)).reserved_credits, 0);
  assert.equal(f.providerCalls(), 0);
});
