import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { MemoryRepository } from "../src/memory-repository.js";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createOpaqueToken, hashToken } from "../src/security.js";
import { readStoredTextPreview, TEXT_PREVIEW_MAX_BYTES } from "../src/files/text-preview.js";

async function fixture() {
  const repository = new MemoryRepository(), objects = new Map(), reads = [];
  const user = await repository.createUser({ email: "reader@example.test", emailVerified: true, passwordHash: "unused" });
  const other = await repository.createUser({ email: "other@example.test", role: "admin", emailVerified: true, passwordHash: "unused" });
  await repository.grantCredits({ ownerId: user.id, amount: 20, idempotencyKey: "opening" });
  const storage = { kind: "test", read: async (key, options) => { reads.push({ key, options }); return objects.get(key); } };
  const save = async (value, mime = "text/markdown", owner = user) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), id = randomUUID();
    const record = await repository.createStoredObject({ id, ownerId: owner.id, storageProvider: "test", storageKey: id, originalName: "Private file.md", contentType: mime, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    objects.set(id, bytes); return record;
  };
  const read = (fileId, actor = user) => readStoredTextPreview({ repository, storage, user: actor, fileId });
  return { repository, objects, reads, user, other, storage, save, read };
}

test("reading a saved document preserves exact text, rechecks integrity and never mutates credits or jobs", async () => {
  const f = await fixture();
  const text = "\ufeff# Garden guide\r\n\r\n  Keep spaces.  \r\n", file = await f.save(text, "text/markdown;charset=utf-8");
  assert.deepEqual(await f.read(file.id), { file_id: file.id, mime_type: "text/markdown", sha256: file.sha256, content: text });
  assert.equal(f.reads[0].options.maxBytes, TEXT_PREVIEW_MAX_BYTES);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
  assert.equal((await f.repository.listJobs(f.user)).length, 0);
  f.objects.set(file.id, Buffer.from(text.replace("Garden", "Broken")));
  await assert.rejects(f.read(file.id), { code: "preview_integrity_failed" });
});

test("text previews reject cross-owner administrator reads before accessing storage", async () => {
  const f = await fixture(), file = await f.save("private content");
  await assert.rejects(f.read(file.id, f.other), { status: 404, code: "file_not_found" });
  assert.equal(f.reads.length, 0);
  await assert.rejects(f.read("../../private"), { status: 400 });
  await assert.rejects(readStoredTextPreview({ ...f, user: null, fileId: file.id }), { status: 401 });
});

test("preview bounds and types fail closed without claiming Office, HTML or binary interpretation", async () => {
  const f = await fixture();
  for (const mime of ["text/html", "application/pdf", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/svg+xml"]) {
    const file = await f.save("# disguised content", mime);
    await assert.rejects(f.read(file.id), { code: "preview_type_unsupported" });
  }
  const tooBig = await f.save(Buffer.alloc(TEXT_PREVIEW_MAX_BYTES + 1, 65));
  await assert.rejects(f.read(tooBig.id), { code: "preview_too_large" });
  assert.equal(f.reads.length, 0);
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from("binary\0text")]) {
    const file = await f.save(bytes);
    await assert.rejects(f.read(file.id), { code: "preview_not_text" });
  }
  const long = await f.save("a".repeat(100001));
  await assert.rejects(f.read(long.id), { code: "preview_too_large" });
  const unicode = await f.save("\ud83c\udf31".repeat(50000));
  assert.equal((await f.read(unicode.id)).content.length, 100000);
});

test("storage failure is a safe retryable preview error without exposing paths or supplier messages", async () => {
  const f = await fixture(), file = await f.save("content");
  f.storage.read = async () => { throw new Error("secret-token in private filesystem path"); };
  await assert.rejects(f.read(file.id), (error) => error.status === 503 && !error.message.includes("secret-token"));
});

test("the authenticated preview function returns owned inert content and denies missing or other-owner sessions", async (t) => {
  const f = await fixture(), file = await f.save('<script>alert("inert")</script>\n![remote](https://example.invalid/pixel)');
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "preview-http-only" });
  const server = createServer(createIabtHandler({ ...f, config, providers: {} }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const tokenFor = async (user) => { const token = createOpaqueToken(); await f.repository.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000).toISOString() }); return token; };
  const call = (token) => fetch(`http://127.0.0.1:${server.address().port}/v1/functions/get-text-preview`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ file_id: file.id }) });
  assert.equal((await call()).status, 401);
  assert.equal((await call(await tokenFor(f.other))).status, 404);
  const response = await call(await tokenFor(f.user));
  assert.equal(response.status, 200);
  assert.match((await response.json()).data.content, /<script>/);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
});
