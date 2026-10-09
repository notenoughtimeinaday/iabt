import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { createIabtHandler } from "../src/app.js";
import { createCreationPlan, executeCreationPlan, creationRequestDisposition, inferCreationIntent } from "../src/creation/planner.js";
import { IMAGE_SOURCE_LIMITS, inspectImageSource, readImageSources } from "../src/files/image-sources.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { createJobWorker } from "../src/worker.js";
import { createOpaqueToken, hashToken } from "../src/security.js";

// A generated neutral PNG fixture; no user/private photographs in the suite.
const crc32 = (data) => {
  let value = 0xffffffff;
  for (const byte of data) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const bytes = Buffer.concat([Buffer.alloc(4), Buffer.from(type), data, Buffer.alloc(4)]);
  bytes.writeUInt32BE(data.length, 0);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
};
const png = (width = 32, height = 64) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc((32 * 3 + 1) * 64))), chunk("IEND", Buffer.alloc(0))]);
};
const image = png();
// A neutral black 32x64 JPEG encoded by the platform JPEG encoder.
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=", "base64");
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);
const request = "Animate the attached image into a 5-second non-explicit portrait video, preserving the clothing shown.";
const approval = (plan) => ({ plan_id: plan.id, approved: true, pricing_version: plan.pricing_version, accepted_total_cents: plan.total_estimated_cost_cents });
const fixture = async (t, overrides = {}) => {
  const directory = await mkdtemp(join(tmpdir(), "iabt-image-video-"));
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "image-video-tests-only", IABT_JOB_LEASE_MS: "1000", LUMA_API_KEY: "test-only", IABT_ENABLE_PAID_MEDIA: "true", IABT_MEDIA_BILLING_READY: "true", IABT_LUMA_COST_PER_5_SECONDS_CENTS: "3", ...overrides });
  const repository = new MemoryRepository();
  const storage = new LocalObjectStorage({ rootDirectory: directory, apiOrigin: "http://127.0.0.1", signingSecret: config.authSecret });
  await storage.ready();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const user = await repository.createUser({ email: "owner@example.test", role: "admin", emailVerified: true, passwordHash: "unused" });
  await repository.grantCredits({ ownerId: user.id, amount: 20, idempotencyKey: "opening" });
  const calls = [];
  const providers = createProviderRegistry(config, { fetchImpl: async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (options.method === "POST") return Response.json({ id: "generation_123", state: "queued" });
    if (url.endsWith("generation_123")) return Response.json({ id: "generation_123", state: "completed", output: [{ type: "video", url: "https://media.example.test/video.mp4" }] });
    if (url === "https://media.example.test/video.mp4") return new Response(mp4);
    throw new Error("Unexpected mocked provider call");
  } });
  const save = async (bytes = image, name = "portrait.png", type = "image/png") => {
    const id = randomUUID();
    const stored = await storage.put({ ownerId: user.id, objectId: id, bytes });
    return repository.createStoredObject({ id, ownerId: user.id, storageProvider: storage.kind, storageKey: stored.storage_key, originalName: name, contentType: type, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  const file = await save();
  const plan = (extra = {}) => createCreationPlan({ repository, config, providers, storage, user, requestText: request, fileIds: [file.id], ...extra });
  const execute = (plan, extra = {}) => executeCreationPlan({ repository, config, storage, user, body: approval(plan), ...extra });
  const worker = createJobWorker({ repository, config, storage, providers, workerId: "image-video-worker" });
  return { directory, config, repository, storage, user, providers, calls, file, save, plan, execute, worker };
};

test("photo animation and enhancement requests are understood without converting questions or holds into execution", () => {
  for (const text of [request, "Clear up the image", "Please enhance this photo", "Can you animate the attached photo?", "I want a video from this image"]) assert.equal(creationRequestDisposition(text).create, true, text);
  for (const text of ["Don't animate this image", "Do not clear up the image", "Never enhance that photo", "Can you animate images?", "Can you enhance photos?", "Why won't you animate my photo?", "Explain how to animate an image", "Animate the photo, but not yet", "Quote only: animate the photo"]) assert.equal(creationRequestDisposition(text).create, false, text);
  assert.equal(inferCreationIntent("Animate this photo"), "video");
  assert.equal(inferCreationIntent("Clear up the image"), "image");
});

test("image video is a signed paid quote; approval sends actual image bytes once and durable polling delivers MP4", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.plan({ automatic: true });
  assert.equal(plan.capability_id, "luma-ray-3.2-image-video-v1");
  assert.equal(plan.normalized_spec.source_kind, "image");
  assert.equal(plan.normalized_spec.aspect_ratio, "9:16");
  assert.equal(plan.job_type, "provider.luma.video");
  assert.equal(plan.autonomy_policy.automatic, false);
  assert.deepEqual(plan.file_references.map((file) => file.sha256), [f.file.sha256]);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.repository.listJobs(f.user)).length, 0);
  await assert.rejects(f.execute(plan, { body: { ...approval(plan), approved: false } }), { code: "explicit_approval_required" });
  const queued = await f.execute(plan);
  const duplicate = await f.execute(plan);
  assert.equal(queued.job.id, duplicate.job.id);
  const submitted = await f.worker.runOnce();
  assert.equal(submitted.deferred, true);
  assert.equal(f.calls.length, 1);
  const body = f.calls[0].body;
  assert.equal(body.model, "ray-3.2");
  assert.equal(body.type, "video");
  assert.deepEqual(body.video.keyframe_indexes, [0]);
  assert.deepEqual(body.video.keyframes, [{ media_type: "image/png", data: image.toString("base64") }]);
  assert.equal(body.video.duration, "5s");
  assert.equal(JSON.stringify(submitted.job).includes(image.toString("base64")), false, "source bytes must not enter persisted input/output checkpoints");
  const completed = await f.worker.runOnce();
  assert.equal(completed.job.status, "succeeded");
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(completed.artifact.content_type, "video/mp4");
  assert.equal(completed.job.output.artifact_manifest[0].metadata.source_references[0].sha256, f.file.sha256);
  assert.deepEqual(await f.storage.read(completed.artifact.storage_key), mp4);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 19);
});

test("ten-second image quote uses compatible keyframes and the documented three-times cost ceiling", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.plan({ requestText: "Make a 10 second video from the image" });
  assert.equal(plan.provider_cost_cents, 9);
  assert.equal(plan.credit_cost, 3);
  await f.execute(plan);
  await f.worker.runOnce();
  assert.equal(f.calls[0].body.video.duration, "10s");
  assert.deepEqual(f.calls[0].body.video.keyframe_indexes, [0]);
  assert.equal(f.calls[0].body.video.start_frame, undefined);
});

test("configured 30-cent 720p rate quotes 30/90 cents for both text and image video and binds duration/cost into approval", async (t) => {
  const f = await fixture(t, { IABT_LUMA_COST_PER_5_SECONDS_CENTS: "30" });
  for (const fileIds of [[], [f.file.id]]) {
    for (const [duration, expectedCents] of [[5, 30], [10, 90]]) {
      const { plan } = await f.plan({ fileIds, requestText: `Create a ${duration}-second video from the image` });
      assert.equal(plan.provider_cost_cents, expectedCents);
      assert.equal(plan.total_estimated_cost_cents, expectedCents);
      assert.equal(plan.normalized_spec.estimated_cost_cents, expectedCents);
      assert.equal(plan.credit_cost, expectedCents / 3);
      await assert.rejects(f.execute(plan, { body: { ...approval(plan), accepted_total_cents: expectedCents - 1 } }), { code: "quote_mismatch" });
    }
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
});

test("provider boundary rejects an old two-times estimate or unsupported expensive profile before any paid POST", async (t) => {
  const f = await fixture(t, { IABT_LUMA_COST_PER_5_SECONDS_CENTS: "30" });
  const context = { approval: { approved: true, approval_id: "old-quote", scope: "owner_demo", max_cost_cents: 60 }, idempotencyKey: "old-ten-second-job" };
  await assert.rejects(f.providers.execute("luma", "submit_video", { duration_seconds: 10, estimated_cost_cents: 60 }, context), { code: "cost_ceiling_exceeded" });
  await assert.rejects(f.providers.execute("luma", "submit_video", { duration_seconds: 10, estimated_cost_cents: 0 }, context), { code: "cost_ceiling_exceeded" });
  for (const payload of [{ duration_seconds: 20 }, { resolution: "1080p" }, { model: "different-model" }]) {
    await assert.rejects(f.providers.execute("luma", "submit_video", payload, { ...context, approval: { ...context.approval, max_cost_cents: 9999 } }), { code: "luma_video_profile_unsupported" });
  }
  assert.equal(f.calls.length, 0);
});

test("a price increase requires a new quote before reservation while submitted jobs still finish under their original approval", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.plan({ requestText: "Make a 10-second video" });
  const increased = { ...f.config, providers: { ...f.config.providers, luma: { ...f.config.providers.luma, costPerFiveSecondsCents: 30 } } };
  await assert.rejects(f.execute(plan, { config: increased }), { code: "quote_mismatch" });
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  await f.execute(plan);
  assert.equal((await f.worker.runOnce()).deferred, true);
  f.providers.config = increased;
  const completed = await f.worker.runOnce();
  assert.equal(completed.job.status, "succeeded");
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 17);
});

test("unconfigured image video and unimplemented image editing return actionable blockers without jobs or reservations", async (t) => {
  const f = await fixture(t, { LUMA_API_KEY: "" });
  await assert.rejects(f.plan({ automatic: true }), { code: "image_video_not_configured" });
  await assert.rejects(f.plan({ requestText: "Clear up the image", automatic: true }), (error) => error.code === "source_intent_unsupported" && /not implemented|cannot enhance/.test(error.message));
  assert.equal((await f.repository.listJobs(f.user)).length, 0);
  assert.equal((await f.repository.listRecords("CreationPlan", f.user)).length, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal(f.calls.length, 0);
});

test("image ownership cannot be bypassed by an administrator or a provider URL", async (t) => {
  const f = await fixture(t);
  const other = await f.repository.createUser({ email: "other@example.test", role: "admin", passwordHash: "unused" });
  await assert.rejects(f.plan({ user: other }), { code: "source_not_found" });
  await assert.rejects(f.plan({ fileIds: ["https://private.example/image.png"] }), { code: "invalid_file_ids" });
  const second = await f.save();
  await assert.rejects(f.plan({ fileIds: [f.file.id, second.id] }), { code: "image_source_count" });
  assert.equal(f.calls.length, 0);
});

test("image size, format, CRC and dimensional bounds reject invalid bytes before a quote", async (t) => {
  const f = await fixture(t);
  const broken = Buffer.from(image); broken[broken.length - 1] ^= 1;
  const invalidPngHeader = Buffer.from(image.subarray(16, 29)); invalidPngHeader[8] = 16; invalidPngHeader[9] = 3;
  const impossiblePng = Buffer.concat([image.subarray(0, 8), chunk("IHDR", invalidPngHeader), image.subarray(33)]);
  const impossibleJpeg = Buffer.from(jpeg); impossibleJpeg[impossibleJpeg.indexOf(Buffer.from([0xff, 0xc0])) + 9] = 0;
  const scanOffset = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  const emptyScan = Buffer.concat([jpeg.subarray(0, scanOffset), Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
  for (const [bytes, name, type, code] of [
    [Buffer.from("<svg><script/></svg>"), "x.png", "image/png", "image_source_invalid"],
    [image, "x.jpg", "image/jpeg", "image_source_invalid"],
    [image, "x.webp", "image/webp", "image_source_type_unsupported"],
    [image.subarray(0, image.length - 10), "x.png", "image/png", "image_source_invalid"],
    [broken, "x.png", "image/png", "image_source_invalid"],
    [impossiblePng, "x.png", "image/png", "image_source_invalid"],
    [impossibleJpeg, "x.jpg", "image/jpeg", "image_source_invalid"],
    [emptyScan, "x.jpg", "image/jpeg", "image_source_invalid"],
    [png(9000, 64), "x.png", "image/png", "image_source_dimensions"],
    [Buffer.alloc(IMAGE_SOURCE_LIMITS.fileBytes + 1), "x.png", "image/png", "image_source_too_large"]
  ]) {
    const file = await f.save(bytes, name, type);
    await assert.rejects(f.plan({ fileIds: [file.id] }), { code }, name);
  }
  assert.equal(f.calls.length, 0);
});

test("an encoded JPEG photo is accepted and sent as image/jpeg with the quoted landscape override", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(inspectImageSource(jpeg, "image/jpeg"), { width: 32, height: 64, contentType: "image/jpeg" });
  const file = await f.save(jpeg, "photo.jpeg", "image/jpeg");
  const { plan } = await f.plan({ fileIds: [file.id], requestText: "Animate this image into a 5 second landscape video at 16:9" });
  assert.equal(plan.normalized_spec.aspect_ratio, "16:9");
  await f.execute(plan);
  await f.worker.runOnce();
  assert.equal(f.calls[0].body.video.keyframes[0].media_type, "image/jpeg");
  assert.equal(f.calls[0].body.video.keyframes[0].data, jpeg.toString("base64"));
});

test("changed signed reference and altered source bytes fail before reservation", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.plan();
  f.repository.records.get("CreationPlan").get(plan.id).file_references[0].name = "different.png";
  await assert.rejects(f.execute(plan), { code: "quote_mismatch" });
  const fresh = (await f.plan()).plan;
  await writeFile(f.storage.resolveKey(f.file.storage_key), Buffer.from("changed"));
  await assert.rejects(f.execute(fresh), { code: "source_integrity_failed" });
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal(f.calls.length, 0);
});

test("worker revalidates source after approval and restores credits if it was replaced", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.plan();
  await f.execute(plan);
  await writeFile(f.storage.resolveKey(f.file.storage_key), Buffer.from("changed"));
  const result = await f.worker.runOnce();
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.last_error_code, "source_integrity_failed");
  assert.equal(f.calls.length, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
});

test("temporary private-image read failure retries original job before any paid submission", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.plan();
  await f.execute(plan);
  const read = f.storage.read.bind(f.storage);
  let failOnce = true;
  f.storage.read = (...args) => { if (failOnce) { failOnce = false; throw Object.assign(new Error("private diagnostic must stay private"), { code: "ECONNRESET" }); } return read(...args); };
  const retry = await f.worker.runOnce();
  assert.equal(retry.job.status, "queued");
  assert.equal(f.calls.length, 0);
  assert.equal(retry.job.output.luma_submission, undefined);
  f.repository.jobs.get(retry.job.id).available_at = new Date(0).toISOString();
  assert.equal((await f.worker.runOnce()).deferred, true);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});

test("uncertain paid image submission does not submit again on retry", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.plan();
  await f.execute(plan);
  let calls = 0;
  f.providers.fetch = async () => { calls += 1; throw Object.assign(new Error("socket lost after POST"), { code: "ECONNRESET" }); };
  const retry = await f.worker.runOnce();
  assert.equal(retry.job.status, "queued");
  f.repository.jobs.get(retry.job.id).available_at = new Date(0).toISOString();
  const failed = await f.worker.runOnce();
  assert.equal(failed.job.last_error_code, "provider_outcome_unknown");
  assert.equal(calls, 1);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
});

test("photo upload and natural-language animation travel through authenticated Studio HTTP into a quoted plan", async (t) => {
  const f = await fixture(t);
  const server = createServer(createIabtHandler(f));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = createOpaqueToken();
  await f.repository.createSession({ userId: f.user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000).toISOString() });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: "Bearer " + token };
  const form = new FormData(); form.append("file", new Blob([image], { type: "image/png" }), "portrait.png");
  const upload = await fetch(origin + "/v1/files", { method: "POST", headers, body: form });
  assert.equal(upload.status, 201);
  const file = await upload.json();
  const post = (path, body) => fetch(origin + path, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const conversation = await (await post("/v1/agents/conversations", { agent_name: "iabt_creator" })).json();
  const sent = await post(`/v1/agents/conversations/${conversation.id}/messages`, { role: "user", content: request, file_ids: [file.file_id], submission_id: "image-video-test" });
  assert.equal(sent.status, 200);
  const reopened = await sent.json();
  assert.equal(reopened.messages[0].file_references[0].sha256, file.sha256);
  const plans = await f.repository.listRecords("CreationPlan", f.user);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].intent, "video");
  assert.equal(plans[0].status, "quoted");
  assert.equal(f.calls.length, 0);
  assert.equal((await f.repository.listJobs(f.user)).length, 0);
});

test("image byte readers reject missing private storage and never leak storage diagnostics", async () => {
  await assert.rejects(readImageSources({ fileIds: [randomUUID()], user: { id: "owner" } }), { code: "source_storage_not_configured" });
  assert.throws(() => inspectImageSource(image, "image/jpeg"), { code: "image_source_invalid" });
});
