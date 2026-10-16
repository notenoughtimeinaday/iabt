import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import pg from "pg";
import { createCreationPlan, executeCreationPlan, verifyQuoteSignature } from "../src/creation/planner.js";
import { loadConfig } from "../src/config.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { createJobWorker } from "../src/worker.js";

// A synthetic neutral image, never a user's photo or a provider request.
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const bytes = Buffer.concat([Buffer.alloc(4), Buffer.from(type), data, Buffer.alloc(4)]);
  bytes.writeUInt32BE(data.length);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
};
const header = Buffer.alloc(13);
header.writeUInt32BE(32, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
const image = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc((32 * 3 + 1) * 64))), chunk("IEND", Buffer.alloc(0))]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);
const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;

test("postgres: signed image quote, one approved submission and private video delivery survive instance restart", {
  skip: !connectionString && "Set IABT_AUTH_TEST_DATABASE_URL to a disposable local PostgreSQL test database",
  timeout: 30000
}, async (t) => {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname));
  assert.equal(url.search, "");
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
  const schema = "image_video_test_" + randomUUID().replaceAll("-", "");
  assert.match(schema, /^image_video_test_[a-f0-9]{32}$/);
  const control = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const directory = await mkdtemp(join(tmpdir(), "iabt-image-video-pg-"));
  const openRepositories = new Set();
  t.after(async () => {
    for (const repository of openRepositories) await repository.close();
    try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await control.end(); await rm(directory, { recursive: true, force: true }); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  const open = async () => {
    const repository = new PostgresRepository({ pool: new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 5000 }) });
    openRepositories.add(repository);
    await repository.ready();
    return repository;
  };
  const config = loadConfig({ NODE_ENV: "test", IABT_CREATION_PROFILE: "advanced", IABT_AUTH_SECRET: randomUUID(), LUMA_API_KEY: "local-test-only", IABT_ENABLE_PAID_MEDIA: "true", IABT_MEDIA_BILLING_READY: "true", IABT_LUMA_COST_PER_5_SECONDS_CENTS: "3" });
  const storage = new LocalObjectStorage({ rootDirectory: directory, apiOrigin: "http://127.0.0.1", signingSecret: config.authSecret });
  await storage.ready();
  const calls = [];
  const providers = createProviderRegistry(config, { fetchImpl: async (target, options = {}) => {
    calls.push({ target, method: options.method });
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.video.keyframes, [{ media_type: "image/png", data: image.toString("base64") }]);
      return Response.json({ id: "persisted_video_123", state: "queued" });
    }
    if (target.endsWith("/persisted_video_123")) return Response.json({ id: "persisted_video_123", state: "completed", output: [{ url: "https://mock.example.test/video.mp4" }] });
    if (target === "https://mock.example.test/video.mp4") return new Response(mp4);
    throw new Error("Unexpected mocked request");
  } });
  const first = await open();
  const peer = await open();
  const user = await first.createUser({ email: "photo-owner@example.test", role: "admin", passwordHash: "unused", emailVerified: true });
  await first.grantCredits({ ownerId: user.id, amount: 20, idempotencyKey: "image-video-opening" });
  const id = randomUUID();
  const stored = await storage.put({ ownerId: user.id, objectId: id, bytes: image });
  const file = await first.createStoredObject({ id, ownerId: user.id, storageProvider: storage.kind, storageKey: stored.storage_key, originalName: "neutral-portrait.png", contentType: "image/png", sizeBytes: image.length, sha256: createHash("sha256").update(image).digest("hex") });
  const quoted = await createCreationPlan({ repository: first, config, providers, storage, user, requestText: "Animate this image into a 5 second portrait video", fileIds: [file.id], automatic: true, submissionId: "persistent-photo-quote" });
  const reloaded = await peer.getRecord("CreationPlan", quoted.plan.id, user);
  assert.equal(verifyQuoteSignature(config, reloaded), true, "JSONB storage must preserve signed source and normalized-video terms");
  assert.equal(reloaded.normalized_spec.source_kind, "image");
  assert.equal((await peer.listJobs(user)).length, 0, "quoting cannot dispatch paid work");
  const body = { plan_id: reloaded.id, approved: true, pricing_version: reloaded.pricing_version, accepted_total_cents: reloaded.total_estimated_cost_cents };
  const approvals = await Promise.all([first, peer].map(repository => executeCreationPlan({ repository, config, storage, user, body })));
  assert.equal(approvals[0].job.id, approvals[1].job.id);
  assert.equal((await peer.listJobs(user)).length, 1);
  const worker = createJobWorker({ repository: first, config, storage, providers, workerId: "image-video-before-restart" });
  const submitted = await worker.runOnce();
  assert.equal(submitted.deferred, true);
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  const persisted = await peer.getJob(submitted.job.id, user);
  assert.equal(persisted.input.provider_job_id, "persisted_video_123");
  assert.equal(persisted.input.file_references[0].sha256, file.sha256);
  assert.equal(JSON.stringify(persisted).includes(image.toString("base64")), false);
  for (const repository of [first, peer]) { await repository.close(); openRepositories.delete(repository); }
  const restarted = await open();
  const resumed = createJobWorker({ repository: restarted, config, storage, providers, workerId: "image-video-after-restart" });
  const completed = await resumed.runOnce();
  assert.equal(completed.job.status, "succeeded");
  assert.equal(calls.filter(call => call.method === "POST").length, 1, "restart must poll the saved generation ID, never submit it again");
  assert.deepEqual(await storage.read(completed.artifact.storage_key), mp4);
  assert.equal(completed.job.output.artifact_manifest[0].metadata.source_references[0].sha256, file.sha256);
  const replayed = await executeCreationPlan({ repository: restarted, config, storage, user, body });
  assert.equal(replayed.job.id, submitted.job.id);
  assert.equal(replayed.job.status, "succeeded");
  assert.equal((await restarted.listJobs(user)).length, 1);
  const credits = await restarted.getCreditAccount(user.id);
  assert.equal(credits.available_credits, 19);
  assert.equal(credits.reserved_credits, 0);
});
