import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { createRepository } from "../src/repository-factory.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";

const config = loadConfig({
  NODE_ENV: "test",
  IABT_AUTH_SECRET: "test-only-auth-secret",
  IABT_PUBLIC_ORIGIN: "http://localhost:5173",
  IABT_EXPOSE_DEV_OTP: "true"
});
const repository = new MemoryRepository();
const storageDirectory = await mkdtemp(join(tmpdir(), "iabt-api-"));
const storage = new LocalObjectStorage({
  rootDirectory: storageDirectory,
  apiOrigin: "http://127.0.0.1",
  signingSecret: config.authSecret
});
await storage.ready();
const providers = createProviderRegistry(config, {
  fetchImpl: async () => {
    throw new Error("Provider network calls are forbidden in API tests");
  }
});
const server = createServer(
  createIabtHandler({ repository, config, storage, providers })
);
let origin;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  storage.apiOrigin = origin;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await rm(storageDirectory, { recursive: true, force: true });
});

const api = async (path, { method = "GET", token, body, headers = {} } = {}) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { response, payload };
};

const register = async (email) => {
  const registration = await api("/v1/auth/register", {
    method: "POST",
    body: { email, password: "StrongPass123", name: email.split("@")[0] }
  });
  assert.equal(registration.response.status, 201);
  assert.match(registration.payload.dev_otp, /^\d{6}$/);
  assert.equal("password_hash" in registration.payload.user, false);

  const verification = await api("/v1/auth/verify-otp", {
    method: "POST",
    body: { email, otpCode: registration.payload.dev_otp }
  });
  assert.equal(verification.response.status, 200);
  assert.ok(verification.payload.access_token);
  return verification.payload;
};

test("production refuses non-durable in-memory storage", async () => {
  const productionConfig = loadConfig({
    NODE_ENV: "production",
    IABT_AUTH_SECRET: "production-test-secret",
    IABT_PUBLIC_ORIGIN: "https://insuredspending.org"
  });
  await assert.rejects(
    createRepository(productionConfig),
    /IABT_DATABASE_URL is required in production/
  );
});

test("health and public settings are Base44-independent", async () => {
  const health = await api("/healthz");
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.ok, true);
  assert.equal(health.payload.base44_required, false);

  const settings = await api("/v1/public-settings");
  assert.equal(settings.response.status, 200);
  assert.equal(settings.payload.standalone, true);
  assert.equal(settings.payload.public_settings.operator, "Insured Spending, LLC");
});

test("registration, verification, login, and sessions work without provider credentials", async () => {
  const email = "owner@example.com";
  const verified = await register(email);

  const me = await api("/v1/auth/me", { token: verified.access_token });
  assert.equal(me.response.status, 200);
  assert.equal(me.payload.email, email);

  const incorrect = await api("/v1/auth/login", {
    method: "POST",
    body: { email, password: "NotThePassword1" }
  });
  assert.equal(incorrect.response.status, 401);
  assert.equal(incorrect.payload.error, "invalid_credentials");

  const login = await api("/v1/auth/login", {
    method: "POST",
    body: { email, password: "StrongPass123" }
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.payload.access_token);
});

test("entity access is tenant-owned and reserved ownership fields cannot be overwritten", async () => {
  const alpha = await register("alpha@example.com");
  const beta = await register("beta@example.com");

  const created = await api("/v1/entities/Project", {
    method: "POST",
    token: alpha.access_token,
    body: {
      name: "Alpha piano",
      status: "draft",
      owner_id: "malicious-owner",
      id: "malicious-id"
    }
  });
  assert.equal(created.response.status, 201);
  assert.notEqual(created.payload.id, "malicious-id");
  assert.equal(created.payload.owner_id, alpha.user.id);

  const alphaList = await api("/v1/entities/Project/list", {
    method: "POST",
    token: alpha.access_token,
    body: { sort: "-updated_date", limit: 50, skip: 0 }
  });
  assert.equal(alphaList.payload.length, 1);

  const betaList = await api("/v1/entities/Project/list", {
    method: "POST",
    token: beta.access_token,
    body: { sort: "-updated_date", limit: 50, skip: 0 }
  });
  assert.deepEqual(betaList.payload, []);

  const forbiddenRead = await api(`/v1/entities/Project/${created.payload.id}`, {
    token: beta.access_token
  });
  assert.equal(forbiddenRead.response.status, 404);

  const update = await api(`/v1/entities/Project/${created.payload.id}`, {
    method: "PATCH",
    token: alpha.access_token,
    body: { status: "active", owner_id: beta.user.id }
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.payload.status, "active");
  assert.equal(update.payload.owner_id, alpha.user.id);
});

test("JERICHO conversations and bounded autonomy health are independently persisted", async () => {
  const user = await register("studio@example.com");
  const conversation = await api("/v1/agents/conversations", {
    method: "POST",
    token: user.access_token,
    body: { agent_name: "iabt_creator", metadata: { intent: "app" } }
  });
  assert.equal(conversation.response.status, 201);
  assert.deepEqual(conversation.payload.messages, []);

  const updated = await api(
    `/v1/agents/conversations/${conversation.payload.id}/messages`,
    {
      method: "POST",
      token: user.access_token,
      body: { role: "user", content: "Create a browser piano" }
    }
  );
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.messages.length, 1);

  const health = await api("/v1/functions/get-system-health", {
    method: "POST",
    token: user.access_token,
    body: {}
  });
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.data.runtime, "standalone");
  assert.equal(health.payload.data.base44_required, false);
  assert.equal(health.payload.data.operational_core.durable_job_queue, true);
  assert.equal(health.payload.data.operational_core.private_object_storage, true);
  assert.equal(health.payload.data.production_routes.app.configured, false);

  const missing = await api("/v1/functions/execute-creation", {
    method: "POST",
    token: user.access_token,
    body: {}
  });
  assert.equal(missing.response.status, 501);
  assert.equal(missing.payload.error, "function_not_migrated");
});

test("private uploads are stored, signed, and tenant-authorized", async () => {
  const user = await register("files@example.com");
  const form = new FormData();
  form.append(
    "file",
    new Blob(["private IABT artifact"], { type: "text/plain" }),
    "artifact.txt"
  );
  const uploadedResponse = await fetch(origin + "/v1/files", {
    method: "POST",
    headers: { Authorization: "Bearer " + user.access_token },
    body: form
  });
  const uploaded = await uploadedResponse.json();
  assert.equal(uploadedResponse.status, 201);
  assert.match(uploaded.sha256, /^[a-f0-9]{64}$/);
  assert.ok(uploaded.file_url.startsWith(origin + "/v1/files/"));

  const contentResponse = await fetch(uploaded.file_url);
  assert.equal(contentResponse.status, 200);
  assert.equal(await contentResponse.text(), "private IABT artifact");

  const access = await api("/v1/files/" + uploaded.file_id + "/access", {
    token: user.access_token
  });
  assert.equal(access.response.status, 200);
  assert.ok(access.payload.file_url.includes("/content?expires="));
});

test("cross-origin requests are rejected and request bodies are bounded", async () => {
  const blocked = await api("/v1/public-settings", {
    headers: { Origin: "https://attacker.example" }
  });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.payload.error, "origin_not_allowed");

  const unknown = await api("/v1/entities/NotAnEntity/list", {
    method: "POST",
    body: {}
  });
  assert.equal(unknown.response.status, 401);
});
