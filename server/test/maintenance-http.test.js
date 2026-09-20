import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createOpaqueToken, hashToken } from "../src/security.js";

async function fixture(t) {
  const repository = new MemoryRepository();
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "maintenance-http-test-only" });
  const server = createServer(createIabtHandler({ repository, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const account = async (name, role = "user", emailVerified = true) => {
    const user = await repository.createUser({ email: `${name}@example.test`, role, emailVerified, passwordHash: "unused" });
    const token = createOpaqueToken();
    await repository.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600000).toISOString() });
    return { user, token };
  };
  const invoke = async (token, name, body = {}) => {
    const response = await fetch(`${origin}/v1/functions/${name}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { repository, account, invoke };
}

test("maintenance HTTP requires a verified session and rejects coercive settings", async (t) => {
  const f = await fixture(t);
  const owner = await f.account("owner");
  const unverified = await f.account("unverified", "user", false);
  for (const name of ["get-jericho-maintenance", "configure-jericho-maintenance"]) {
    assert.equal((await f.invoke(null, name)).status, 401);
    assert.equal((await f.invoke(unverified.token, name)).status, 401, "Unverified accounts cannot receive a session");
  }
  for (const body of [{}, { enabled: "false" }, { enabled: 1 }, { enabled: true, interval_minutes: 0 }, { enabled: true, interval_minutes: 1441 }]) {
    const response = await f.invoke(owner.token, "configure-jericho-maintenance", body);
    assert.equal(response.status, 400, JSON.stringify(response));
  }
});

test("maintenance HTTP owner settings survive reload and cannot target another account", async (t) => {
  const f = await fixture(t);
  const owner = await f.account("owner");
  const admin = await f.account("administrator", "admin");
  const opening = await f.invoke(owner.token, "get-jericho-maintenance");
  assert.equal(opening.status, 200, JSON.stringify(opening));
  assert.equal(opening.body.data.enabled, true);
  const paused = await f.invoke(owner.token, "configure-jericho-maintenance", { enabled: false, interval_minutes: 30 });
  assert.equal(paused.status, 200, JSON.stringify(paused));
  assert.equal(paused.body.data.enabled, false);
  assert.equal((await f.invoke(owner.token, "get-jericho-maintenance")).body.data.enabled, false);
  const attempted = await f.invoke(admin.token, "configure-jericho-maintenance", { enabled: true, owner_id: owner.user.id, user_id: owner.user.id });
  assert.equal(attempted.status, 200);
  assert.equal(attempted.body.data.enabled, true);
  assert.equal((await f.invoke(owner.token, "get-jericho-maintenance")).body.data.enabled, false);
  const balance = await f.repository.getCreditAccount(owner.user.id);
  assert.equal(balance.available_credits, 0);
  assert.equal(balance.reserved_credits, 0);
  assert.equal((await f.repository.listJobs(owner.user)).length, 0);
});
