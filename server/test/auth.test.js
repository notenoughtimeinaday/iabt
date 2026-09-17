import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { hashPassword, hashToken } from "../src/security.js";

// PostgreSQL is opt-in and must point to an isolated verification branch.
const adapters = ["memory", ...(process.env.IABT_AUTH_TEST_DATABASE_URL ? ["postgres"] : [])];

const fixture = async (t, adapter, { delivery = "development" } = {}) => {
  const prefix = `auth-${randomUUID()}-`;
  const repository = adapter === "postgres"
    ? new PostgresRepository({ connectionString: process.env.IABT_AUTH_TEST_DATABASE_URL })
    : new MemoryRepository();
  if (repository.ready) await repository.ready();
  const rateKeys = new Set();
  const consumeLimit = repository.consumeAuthRateLimit.bind(repository);
  repository.consumeAuthRateLimit = (input) => {
    rateKeys.add(input.keyHash);
    return consumeLimit(input);
  };
  const config = loadConfig({
    NODE_ENV: delivery === "development" ? "test" : "production",
    IABT_AUTH_SECRET: randomUUID(),
    IABT_EXPOSE_DEV_OTP: delivery === "development" ? "true" : "false"
  });
  const messages = [];
  let failingDelivery = false;
  const sender = {
    configured: delivery !== "missing",
    kind: "test",
    health: async () => ({ ok: delivery !== "missing", adapter: "test" }),
    sendChallenge: async (input) => {
      if (failingDelivery) throw new Error("private-provider-credential must not be exposed");
      messages.push(input);
      return { id: randomUUID() };
    }
  };
  const server = createServer(createIabtHandler({
    repository, config, emailSender: sender,
    storage: { health: async () => ({ ok: true, adapter: "test" }) }
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (adapter === "postgres") {
      await repository.pool.query("DELETE FROM iabt_auth_challenges WHERE email LIKE $1", [`${prefix}%`]);
      await repository.pool.query("DELETE FROM iabt_users WHERE email LIKE $1", [`${prefix}%`]);
      await repository.pool.query("DELETE FROM iabt_auth_rate_limits WHERE key_hash = ANY($1::text[])", [[...rateKeys]]);
      await repository.close();
    }
  });
  const request = async (path, body, token) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const email = `${prefix}owner@example.test`;
  const password = "StrongPassword123";
  const register = () => request("/v1/auth/register", { email, password });
  const verify = (code) => request("/v1/auth/verify-otp", { email, code });
  return { repository, config, request, email, password, register, verify, messages, failDelivery: (value) => { failingDelivery = value; } };
};

for (const adapter of adapters) {
  test(`${adapter}: missing email blocks readiness and registration before account creation`, async (t) => {
    const f = await fixture(t, adapter, { delivery: "missing" });
    assert.equal((await f.request("/healthz")).status, 200);
    const readiness = await f.request("/readyz");
    assert.equal(readiness.status, 503);
    assert.equal(readiness.body.account_access.ok, false);
    assert.equal((await f.register()).status, 503);
    assert.equal(await f.repository.findUserByEmail(f.email), null);
    assert.equal((await f.request("/v1/auth/reset-request", { email: f.email })).status, 503);
  });

  test(`${adapter}: interrupted signup retries safely and delivery failure preserves an earlier code`, async (t) => {
    const f = await fixture(t, adapter, { delivery: "mock" });
    f.failDelivery(true);
    const failed = await f.register();
    assert.equal(failed.status, 502);
    assert.equal(JSON.stringify(failed).includes("private-provider-credential"), false);
    assert.equal((await f.repository.findUserByEmail(f.email)).email_verified, false);
    const differentPassword = await f.request("/v1/auth/register", { email: f.email, password: "AttackerPassword456" });
    assert.equal(differentPassword.status, 409);
    f.failDelivery(false);
    assert.equal((await f.register()).status, 201);
    const code = f.messages.at(-1).code;
    f.failDelivery(true);
    assert.equal((await f.request("/v1/auth/resend-otp", { email: f.email })).status, 502);
    const verified = await f.verify(code);
    assert.equal(verified.status, 200);
    assert.ok(verified.body.access_token);
    assert.equal("password_hash" in verified.body.user, false);
  });

  test(`${adapter}: verification tolerates a typo, is single-use, and cannot bypass a verified account password`, async (t) => {
    const f = await fixture(t, adapter);
    const registration = await f.register();
    const code = registration.body.dev_otp;
    assert.equal((await f.verify("000000")).status, 400);
    assert.equal((await f.verify(code)).status, 200);
    assert.equal((await f.verify(code)).status, 400);
    const resend = await f.request("/v1/auth/resend-otp", { email: f.email });
    const unknown = await f.request("/v1/auth/resend-otp", { email: f.email.replace("owner", "missing") });
    assert.deepEqual(resend.body, { accepted: true });
    assert.deepEqual(unknown.body, resend.body);
    await f.repository.saveChallenge({ email: f.email, purpose: "verify_email", codeHash: hashToken(`${f.config.authSecret}:verify_email:${f.email}:123456`), expiresAt: new Date(Date.now() + 60000).toISOString() });
    assert.equal((await f.verify("123456")).status, 400);
  });

  test(`${adapter}: five wrong codes exhaust the challenge and resend provides recovery`, async (t) => {
    const f = await fixture(t, adapter);
    const code = (await f.register()).body.dev_otp;
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await f.verify("000000")).status, 400);
    assert.equal((await f.verify(code)).status, 400);
    const resend = await f.request("/v1/auth/resend-otp", { email: f.email });
    assert.equal((await f.verify(resend.body.dev_otp)).status, 200);
  });

  test(`${adapter}: password reset preserves a code on weak input and revokes all existing sessions`, async (t) => {
    const f = await fixture(t, adapter);
    const firstSession = (await f.verify((await f.register()).body.dev_otp)).body.access_token;
    const secondSession = (await f.request("/v1/auth/login", { email: f.email, password: f.password })).body.access_token;
    const code = (await f.request("/v1/auth/reset-request", { email: f.email })).body.dev_otp;
    const reset = (newPassword) => f.request("/v1/auth/reset", { email: f.email, code, newPassword });
    assert.equal((await reset("weak")).status, 400);
    assert.equal((await reset("ReplacementPassword456")).status, 200);
    assert.equal((await f.request("/v1/auth/me", undefined, firstSession)).status, 401);
    assert.equal((await f.request("/v1/auth/me", undefined, secondSession)).status, 401);
    assert.equal((await reset("ReplayPassword456")).status, 400);
    assert.equal((await f.request("/v1/auth/login", { email: f.email, password: f.password })).status, 401);
    assert.equal((await f.request("/v1/auth/login", { email: f.email, password: "ReplacementPassword456" })).status, 200);
  });

  test(`${adapter}: reset recovers an unverified account and invalidates old verification codes`, async (t) => {
    const f = await fixture(t, adapter);
    const verificationCode = (await f.register()).body.dev_otp;
    const resetCode = (await f.request("/v1/auth/reset-request", { email: f.email })).body.dev_otp;
    assert.equal((await f.request("/v1/auth/reset", { email: f.email, code: resetCode, newPassword: "ReplacementPassword456" })).status, 200);
    assert.equal((await f.repository.findUserByEmail(f.email)).email_verified, true);
    assert.equal((await f.verify(verificationCode)).status, 400);
    assert.equal((await f.request("/v1/auth/login", { email: f.email, password: "ReplacementPassword456" })).status, 200);
  });

  test(`${adapter}: email and login rate limits are bounded and persisted by the repository`, async (t) => {
    const f = await fixture(t, adapter);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await f.request("/v1/auth/reset-request", { email: f.email })).status, 200);
    }
    assert.equal((await f.request("/v1/auth/resend-otp", { email: f.email })).status, 429);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await f.request("/v1/auth/login", { email: f.email, password: "incorrect" })).status, 401);
    }
    assert.equal((await f.request("/v1/auth/login", { email: f.email, password: "incorrect" })).status, 429);
  });

  test(`${adapter}: a racing stale-password session cannot survive password reset`, async (t) => {
    const f = await fixture(t, adapter);
    await f.verify((await f.register()).body.dev_otp);
    const stored = await f.repository.findUserByEmail(f.email, { includeSecret: true });
    const replacementHash = await hashPassword("ReplacementPassword456");
    await f.repository.saveChallenge({ email: f.email, purpose: "reset_password", codeHash: "test-reset-hash", expiresAt: new Date(Date.now() + 60000).toISOString() });
    const tokenHash = hashToken(randomUUID());
    await Promise.all([
      f.repository.createSession({ tokenHash, userId: stored.id, expiresAt: new Date(Date.now() + 60000).toISOString(), expectedPasswordHash: stored.password_hash }),
      f.repository.completeAuthChallenge({ email: f.email, purpose: "reset_password", codeHash: "test-reset-hash", passwordHash: replacementHash })
    ]);
    assert.equal(await f.repository.getSession(tokenHash), null);
    assert.equal(await f.repository.createSession({ tokenHash, userId: stored.id, expiresAt: new Date(Date.now() + 60000).toISOString(), expectedPasswordHash: stored.password_hash }), false);
  });

  test(`${adapter}: two concurrent signup requests create one account and no null-user success`, async (t) => {
    const f = await fixture(t, adapter);
    const registrations = await Promise.all([f.register(), f.register()]);
    for (const result of registrations) {
      assert.ok([201, 409].includes(result.status));
      if (result.status === 201) assert.ok(result.body.user.id);
    }
    assert.ok(await f.repository.findUserByEmail(f.email));
  });
}
