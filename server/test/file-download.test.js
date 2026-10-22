import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createOpaqueToken, hashToken } from "../src/security.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { S3ObjectStorage } from "../src/storage/s3-storage.js";
import { MAX_DOWNLOAD_BYTES, streamPrivateDownload } from "../src/storage/download-gateway.js";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixture = async (t) => {
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "download-fixture-only" });
  const repository = new MemoryRepository();
  const storage = new S3ObjectStorage({ bucket: "private-fixture", apiOrigin: "http://127.0.0.1", signingSecret: config.authSecret });
  const objects = new Map();
  const reads = [];
  const previews = [];
  storage.modules = {
    GetObjectCommand: class { constructor(input) { this.input = input; } },
    getSignedUrl: async (_client, command, options) => {
      previews.push({ input: command.input, options });
      return "https://private-storage.example.test/preview?signature=fixture-only";
    }
  };
  storage.client = { send: async (command, options) => {
    reads.push({ input: command.input, signal: options.abortSignal });
    const value = objects.get(command.input.Key);
    if (!value) throw new Error("SECRET provider key and diagnostic");
    return { Body: Readable.from([value]), ContentLength: value.length,
      // Simulate the actual provider: inline even though the app needs download.
      ContentType: "text/markdown", ContentDisposition: "inline" };
  } };
  const server = createServer(createIabtHandler({ repository, config, storage }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  storage.apiOrigin = origin;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const account = async (email, role = "user") => {
    const user = await repository.createUser({ email, role, emailVerified: true, passwordHash: "unused" });
    const token = createOpaqueToken();
    await repository.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000).toISOString() });
    return { user, token };
  };
  const owner = await account("owner@example.test");
  const other = await account("other@example.test");
  const admin = await account("admin@example.test", "admin");
  const addFile = async (id, bytes = Buffer.from("IABT-MAINTENANCE-20260920\n"), extra = {}) => {
    const key = `${owner.user.id}/${id}`;
    objects.set(key, bytes);
    return repository.createStoredObject({ id, ownerId: owner.user.id,
      storageProvider: "s3", storageKey: key, originalName: "owner's source review ü.md",
      contentType: "text/markdown", sizeBytes: bytes.length, sha256: sha256(bytes), ...extra });
  };
  const access = (id, token = owner.token, { download = true } = {}) => fetch(`${origin}/v1/files/${encodeURIComponent(id)}/access${download ? "?download=1" : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { config, repository, storage, objects, reads, previews, origin, owner, other, admin, addFile, access };
};

test("explicit S3 download access uses the gateway while default access preserves signed storage preview behavior", async (t) => {
  const f = await fixture(t);
  const record = await f.addFile("saved-report");
  const preview = await (await f.access(record.id, f.owner.token, { download: false })).json();
  assert.equal(preview.file_url, "https://private-storage.example.test/preview?signature=fixture-only");
  assert.equal(f.previews.length, 1);
  assert.deepEqual(f.previews[0], {
    input: { Bucket: "private-fixture", Key: record.storage_key,
      ResponseContentType: "text/markdown",
      ResponseContentDisposition: "attachment; filename*=UTF-8''" + encodeURIComponent(record.original_name) },
    options: { expiresIn: 300 }
  });
  assert.equal(f.reads.length, 0);
  for (let i = 0; i < 2; i += 1) {
    const access = await f.access(record.id);
    assert.equal(access.status, 200);
    const ticket = await access.json();
    const url = new URL(ticket.file_url);
    assert.equal(url.origin, f.origin);
    assert.equal(url.pathname, "/v1/files/saved-report/content");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["expires", "signature"]);
    assert.ok(!ticket.file_url.includes(f.config.authSecret));
    const download = await fetch(url);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.equal(download.headers.get("content-disposition"), "attachment; filename*=UTF-8''owner%27s%20source%20review%20%C3%BC.md");
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(download.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.length, record.size_bytes);
    assert.equal(sha256(bytes), record.sha256);
  }
  assert.equal(f.previews.length, 1, "downloads must not create provider-signed preview URLs");
  assert.equal(f.reads.length, 2);
  for (const read of f.reads) {
    assert.deepEqual(read.input, { Bucket: "private-fixture", Key: record.storage_key });
    assert.ok(read.signal instanceof AbortSignal);
  }
});

test("only the file owner can mint a link, and expired, forged, or wrong-file tickets cannot read storage", async (t) => {
  const f = await fixture(t);
  const record = await f.addFile("private-file");
  await f.addFile("other-file");
  assert.equal((await f.access(record.id, null)).status, 401);
  assert.equal((await f.access(record.id, f.other.token)).status, 404);
  assert.equal((await f.access(record.id, f.admin.token)).status, 404);
  const ticket = await (await f.access(record.id)).json();
  const expired = new URL(ticket.file_url);
  expired.searchParams.set("expires", "1");
  expired.searchParams.set("signature", f.storage.signature(record.id, 1));
  const forged = new URL(ticket.file_url);
  forged.searchParams.set("signature", "forged");
  const wrongFile = new URL(ticket.file_url);
  wrongFile.pathname = "/v1/files/other-file/content";
  for (const url of [expired, forged, wrongFile]) assert.equal((await fetch(url)).status, 403);
  assert.equal(f.reads.length, 0);
});

test("gateway rejects provider mismatch and oversized metadata without a storage read; missing objects stay sanitized", async (t) => {
  const f = await fixture(t);
  for (const [id, extra] of [["wrong-provider", { storageProvider: "local" }], ["oversized", { sizeBytes: MAX_DOWNLOAD_BYTES + 1 }]]) {
    const record = await f.addFile(id, Buffer.from("bytes"), extra);
    const ticket = await (await f.access(record.id)).json();
    assert.equal((await fetch(ticket.file_url)).status, 409);
  }
  assert.equal(f.reads.length, 0);
  const record = await f.addFile("missing");
  f.objects.delete(record.storage_key);
  const ticket = await (await f.access(record.id)).json();
  const response = await fetch(ticket.file_url);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes("SECRET"));
});

test("original local signed content URLs remain valid and use bounded streaming with app-owned headers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "iabt-download-"));
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "local-compatibility-fixture" });
  const repository = new MemoryRepository();
  const storage = new LocalObjectStorage({ rootDirectory: directory, signingSecret: config.authSecret });
  await storage.ready();
  const user = await repository.createUser({ email: "local@example.test", emailVerified: true, passwordHash: "unused" });
  const bytes = Buffer.from("old local link still downloads");
  const object = await storage.put({ ownerId: user.id, objectId: "old", bytes });
  const record = await repository.createStoredObject({ id: "old", ownerId: user.id,
    storageProvider: object.storage_provider, storageKey: object.storage_key,
    originalName: "old.txt", contentType: "text/plain", sizeBytes: bytes.length, sha256: sha256(bytes) });
  const server = createServer(createIabtHandler({ repository, config, storage }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const expires = Date.now() + 60000;
  const oldSignature = createHmac("sha256", config.authSecret).update(`old:${expires}`).digest("base64url");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/files/old/content?expires=${expires}&signature=${oldSignature}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  // Ensure the file handle is closed after completion (including on Windows).
  await writeFile(storage.resolveKey(record.storage_key), bytes);
});

const streamFixture = ({ bytes, size = bytes.length, hash = sha256(bytes), source, sizeBytes = size, missingSize = false, timeoutMs = 1000, slow = false }) => {
  const req = new EventEmitter();
  const chunks = [];
  let release;
  const res = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
    this.headersSent = true;
    chunks.push(Buffer.from(chunk));
    if (slow) release = done;
    else done();
  } });
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
  let signal;
  const input = source || Readable.from([bytes]);
  const storage = { kind: "s3", openReadStream: async (_key, options) => {
    signal = options.signal;
    return { stream: input, ...(missingSize ? {} : { sizeBytes }) };
  } };
  const run = streamPrivateDownload({ req, res, storage, timeoutMs,
    record: { storage_provider: "s3", storage_key: "persisted-owner/key", original_name: "download.bin", size_bytes: size, sha256: hash } });
  return { req, res, chunks, run, input, signal: () => signal, release: () => release?.() };
};

test("streamed truncation, overrun and same-size corruption never complete a download or release the final chunk", async () => {
  const bytes = Buffer.alloc(128 * 1024, 97);
  for (const change of [{ size: bytes.length + 1 }, { size: bytes.length - 1 }, { hash: sha256("wrong bytes") }]) {
    const f = streamFixture({ bytes, ...change, missingSize: true });
    await f.run;
    assert.equal(f.res.writableFinished, false);
    assert.equal(f.res.destroyed, true);
    assert.ok(Buffer.concat(f.chunks).length < (change.size || bytes.length));
    assert.equal(f.input.destroyed, true);
  }
});

test("storage byte count mismatch is rejected before headers or body are written", async () => {
  const f = streamFixture({ bytes: Buffer.from("abc"), sizeBytes: 99 });
  await assert.rejects(f.run, (error) => error.code === "file_download_failed" && error.status === 502);
  assert.equal(f.res.statusCode, undefined);
  assert.equal(f.chunks.length, 0);
  assert.equal(f.input.destroyed, true);
});

test("download timeout and client disconnect abort upstream storage and close the body", async () => {
  for (const disconnect of [false, true]) {
    const input = new Readable({ read() {} });
    const f = streamFixture({ bytes: Buffer.from("waiting"), source: input, timeoutMs: 30 });
    if (disconnect) setTimeout(() => f.res.destroy(), 5);
    await f.run;
    assert.equal(f.signal().aborted, true);
    assert.equal(input.destroyed, true);
    assert.equal(f.res.writableFinished, false);
  }
});

test("a pending upstream open is aborted on timeout, and an already-disconnected client does not open storage", async () => {
  const record = { storage_provider: "s3", storage_key: "owner/key", size_bytes: 1, sha256: sha256("x") };
  const response = () => {
    const res = new Writable({ write(_chunk, _encoding, done) { done(); } });
    res.writeHead = () => {};
    return res;
  };
  let calls = 0;
  let receivedSignal;
  const storage = { kind: "s3", openReadStream: async (_key, { signal }) => {
    calls += 1;
    receivedSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("SECRET timeout diagnostic")), { once: true }));
  } };
  await assert.rejects(streamPrivateDownload({ req: new EventEmitter(), res: response(), storage, record, timeoutMs: 20 }),
    (error) => error.status === 502 && !error.message.includes("SECRET"));
  assert.equal(receivedSignal.aborted, true);
  assert.equal(calls, 1);

  const req = new EventEmitter();
  req.aborted = true;
  await streamPrivateDownload({ req, res: response(), storage, record });
  assert.equal(calls, 1);
});

test("slow clients apply backpressure instead of buffering the full artifact", async () => {
  const chunk = Buffer.alloc(64 * 1024);
  const count = 256;
  let produced = 0;
  const input = new Readable({ highWaterMark: chunk.length, read() {
    if (produced === count) return this.push(null);
    produced += 1;
    this.push(chunk);
  } });
  const hash = createHash("sha256");
  for (let i = 0; i < count; i += 1) hash.update(chunk);
  const f = streamFixture({ bytes: chunk, size: chunk.length * count, hash: hash.digest("hex"), source: input, slow: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(produced < count / 2, `backpressure should stop the producer, got ${produced} chunks`);
  assert.equal(f.chunks.length, 1);
  f.res.destroy();
  f.release();
  await f.run;
  assert.equal(input.destroyed, true);
});
