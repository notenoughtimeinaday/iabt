import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import pg from "pg";
import { createIabtHandler } from "../src/app.js";
import { ensureStarterCredits } from "../src/auth/starter-credits.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { hashPassword, hashToken } from "../src/security.js";

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;
const adapters = ["memory", ...(connectionString ? ["postgres"] : [])];
const ledgerArtifact = (ownerId) => ({
  id: randomUUID(), ownerId, storageProvider: "test", storageKey: "starter-fixture/" + randomUUID(),
  originalName: "fixture.txt", contentType: "text/plain", sizeBytes: 7,
  sha256: createHash("sha256").update("fixture").digest("hex")
});

async function fixture(t, adapter) {
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: randomUUID(), IABT_EXPOSE_DEV_OTP: "true" });
  const repositories = [];
  const servers = [];
  let control, options, schema;
  if (adapter === "postgres") {
    const url = new URL(connectionString);
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
    schema = "starter_test_" + randomUUID().replaceAll("-", "");
    control = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
    options = { connectionString, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 5000 };
    await control.query(`CREATE SCHEMA ${schema}`);
  }
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await Promise.all(repositories.map((repository) => repository.close?.()));
    if (control) {
      try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
      finally { await control.end(); }
    }
  });
  const start = async () => {
    const repository = adapter === "postgres" ? new PostgresRepository({ pool: new pg.Pool(options) }) : new MemoryRepository();
    repositories.push(repository);
    if (repository.ready) await repository.ready();
    const server = createServer(createIabtHandler({ repository, config,
      emailSender: { configured: true, kind: "test", sendChallenge: async () => { throw new Error("Tests must never send email"); } },
      storage: { health: async () => ({ ok: true, adapter: "test" }) }
    }));
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const request = async (path, body, token) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    return { repository, request };
  };
  const first = await start();
  const password = "StarterPassword123!";
  const passwordHash = await hashPassword(password);
  const createExisting = (fields = {}) => first.repository.createUser({ email: randomUUID() + "@example.test", emailVerified: true, passwordHash, ...fields });
  const session = async (user) => {
    const token = randomUUID();
    await first.repository.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600000).toISOString() });
    return token;
  };
  const grants = async (ownerId) => adapter === "postgres"
    ? (await first.repository.pool.query("SELECT id, amount, idempotency_key, metadata FROM iabt_credit_entries WHERE owner_id=$1 AND entry_type='grant'", [ownerId])).rows
    : first.repository.creditEntries.filter((row) => row.owner_id === ownerId && row.entry_type === "grant");
  return { ...first, start, createExisting, session, grants, password };
}

for (const adapter of adapters) {
  test(`${adapter}: starter credits follow email verification, not unverified signup or failed verification`, async (t) => {
    const f = await fixture(t, adapter);
    const email = "new@example.test";
    const first = await f.request("/v1/auth/register", { email, password: f.password });
    assert.equal(first.status, 201);
    const user = first.body.user;
    assert.equal((await f.repository.getCreditAccount(user.id)).available_credits, 0);
    assert.equal((await f.grants(user.id)).length, 0);
    const retry = await f.request("/v1/auth/register", { email, password: f.password });
    assert.equal(retry.status, 201);
    assert.equal((await f.request("/v1/auth/verify-otp", { email, code: "invalid" })).status, 400);
    assert.equal((await f.grants(user.id)).length, 0);
    const verified = await f.request("/v1/auth/verify-otp", { email, code: retry.body.dev_otp });
    assert.equal(verified.status, 200);
    assert.ok(verified.body.access_token);
    assert.equal((await f.repository.getCreditAccount(user.id)).available_credits, 10);
    assert.equal((await f.grants(user.id)).length, 1);
  });

  test(`${adapter}: existing verified accounts receive their missing allowance through login or entitlement access`, async (t) => {
    const f = await fixture(t, adapter);
    const loginOwner = await f.createExisting();
    const login = await f.request("/v1/auth/login", { email: loginOwner.email, password: f.password });
    assert.equal(login.status, 200);
    assert.equal((await f.repository.getCreditAccount(loginOwner.id)).available_credits, 10);
    const sessionOwner = await f.createExisting();
    const token = await f.session(sessionOwner);
    const entitlement = await f.request("/v1/functions/get-account-entitlement", { user_id: loginOwner.id, amount: 99999, idempotency_key: "caller-controlled" }, token);
    assert.equal(entitlement.status, 200);
    assert.equal(entitlement.body.data.total_iabt_credits_remaining, 10);
    assert.equal((await f.repository.getCreditAccount(loginOwner.id)).available_credits, 10);
    const [grant] = await f.grants(sessionOwner.id);
    assert.equal(grant.idempotency_key, "signup:free:v1");
    assert.equal(grant.metadata.source, "initial_free_allowance");
    assert.equal(grant.amount, 10);
  });

  test(`${adapter}: claiming a migrated account preserves identity and provisions starter credits once after recovery`, async (t) => {
    const f = await fixture(t, adapter);
    const user = await f.createExisting({ passwordHash: "migration:reset-required", emailVerified: false });
    assert.equal((await f.request("/v1/auth/login", { email: user.email, password: f.password })).status, 403);
    assert.equal((await f.grants(user.id)).length, 0);
    const recovery = await f.request("/v1/auth/reset-request", { email: user.email });
    assert.equal(recovery.status, 200);
    assert.equal((await f.request("/v1/auth/reset", { email: user.email, code: "wrong", newPassword: f.password })).status, 400);
    assert.equal((await f.grants(user.id)).length, 0);
    const reset = await f.request("/v1/auth/reset", { email: user.email, code: recovery.body.dev_otp, newPassword: f.password });
    assert.equal(reset.status, 200);
    assert.equal((await f.repository.findUserByEmail(user.email)).id, user.id);
    const login = await f.request("/v1/auth/login", { email: user.email, password: f.password });
    assert.equal(login.status, 200);
    assert.equal((await f.request("/v1/functions/get-account-entitlement", {}, login.body.access_token)).body.data.credits_remaining, 10);
    assert.equal((await f.grants(user.id)).length, 1);
  });

  test(`${adapter}: spending starter credits does not replenish them after login, reset or entitlement reload`, async (t) => {
    const f = await fixture(t, adapter);
    const user = await f.createExisting();
    await ensureStarterCredits({ repository: f.repository, user });
    const job = await f.repository.enqueueJob({ ownerId: user.id, jobType: "fixture.spend_starter", idempotencyKey: "consume-once", creditAmount: 10 });
    await f.repository.claimNextJob({ workerId: "starter-test" });
    await f.repository.completeJob({ jobId: job.id, workerId: "starter-test", artifact: ledgerArtifact(user.id) });
    assert.equal((await f.repository.getCreditAccount(user.id)).available_credits, 0);
    const login = await f.request("/v1/auth/login", { email: user.email, password: f.password });
    assert.equal(login.status, 200);
    const entitlement = await f.request("/v1/functions/get-account-entitlement", {}, login.body.access_token);
    assert.equal(entitlement.status, 200);
    assert.equal(entitlement.body.data.credits_remaining, 0);
    const recovery = await f.request("/v1/auth/reset-request", { email: user.email });
    assert.equal((await f.request("/v1/auth/reset", { email: user.email, code: recovery.body.dev_otp, newPassword: f.password })).status, 200);
    assert.equal((await f.repository.getCreditAccount(user.id)).available_credits, 0);
    assert.equal((await f.grants(user.id)).length, 1);
  });

  test(`${adapter}: historical starter provenance prevents another allowance and stays owner scoped`, async (t) => {
    const f = await fixture(t, adapter);
    const historical = await f.createExisting();
    await f.repository.grantCredits({ ownerId: historical.id, amount: 7, idempotencyKey: "reviewed-import:starter", metadata: { source: "initial_free_allowance" } });
    const job = await f.repository.enqueueJob({ ownerId: historical.id, jobType: "fixture.spend_history", idempotencyKey: "consume-history", creditAmount: 7 });
    await f.repository.claimNextJob({ workerId: "starter-test" });
    await f.repository.completeJob({ jobId: job.id, workerId: "starter-test", artifact: ledgerArtifact(historical.id) });
    const token = await f.session(historical);
    assert.equal((await f.request("/v1/functions/get-account-entitlement", {}, token)).body.data.credits_remaining, 0);
    assert.equal((await f.grants(historical.id)).length, 1);
    const other = await f.createExisting({ role: "admin" });
    assert.equal(await f.repository.findStarterCreditGrant(other.id), null);
    await ensureStarterCredits({ repository: f.repository, user: other });
    assert.equal((await f.repository.getCreditAccount(other.id)).available_credits, 10);
    assert.equal((await f.repository.getCreditAccount(historical.id)).available_credits, 0);
  });

  test(`${adapter}: a transient allowance fault preserves successful authentication and normal access repairs it`, async (t) => {
    const f = await fixture(t, adapter);
    const email = "interrupted@example.test";
    const registration = await f.request("/v1/auth/register", { email, password: f.password });
    const originalGrant = f.repository.grantCredits.bind(f.repository);
    f.repository.grantCredits = async () => { throw new Error("private database detail"); };
    const verified = await f.request("/v1/auth/verify-otp", { email, code: registration.body.dev_otp });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.starter_credits_pending, true);
    assert.ok(verified.body.access_token);
    assert.equal(JSON.stringify(verified).includes("private database detail"), false);
    assert.equal((await f.request("/v1/auth/me", undefined, verified.body.access_token)).status, 200);
    f.repository.grantCredits = originalGrant;
    const repaired = await f.request("/v1/functions/get-account-entitlement", {}, verified.body.access_token);
    assert.equal(repaired.status, 200);
    assert.equal(repaired.body.data.credits_remaining, 10);
    assert.equal((await f.grants(verified.body.user.id)).length, 1);
  });

  test(`${adapter}: allowance checks reject forged verification and preserve existing purchased credits`, async (t) => {
    const f = await fixture(t, adapter);
    const unverified = await f.createExisting({ emailVerified: false });
    await assert.rejects(ensureStarterCredits({ repository: f.repository, user: { ...unverified, email_verified: true } }), { code: "email_verification_required" });
    assert.equal((await f.grants(unverified.id)).length, 0);
    assert.equal((await f.request("/v1/functions/get-account-entitlement", { user_id: unverified.id })).status, 401);
    const paid = await f.createExisting();
    await f.repository.grantCredits({ ownerId: paid.id, amount: 100, idempotencyKey: "stripe:checkout:purchase", metadata: { product_type: "ai_credit_pack" } });
    await ensureStarterCredits({ repository: f.repository, user: paid });
    await ensureStarterCredits({ repository: f.repository, user: paid });
    assert.equal((await f.repository.getCreditAccount(paid.id)).available_credits, 110);
    assert.equal((await f.grants(paid.id)).length, 2);
  });
}

test("PostgreSQL missing starter allowance repairs once across API instances and restart", { skip: !connectionString }, async (t) => {
  const f = await fixture(t, "postgres");
  const user = await f.createExisting();
  const token = await f.session(user);
  const second = await f.start();
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? f : second).request("/v1/functions/get-account-entitlement", {}, token)));
  assert.ok(results.every((result) => result.status === 200 && result.body.data.credits_remaining === 10));
  assert.equal((await f.grants(user.id)).length, 1);
  const reopened = await f.start();
  assert.equal((await reopened.request("/v1/functions/get-account-entitlement", {}, token)).body.data.credits_remaining, 10);
  assert.equal((await f.grants(user.id)).length, 1);
});
