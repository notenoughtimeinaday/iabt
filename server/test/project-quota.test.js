import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import pg from "pg";
import { createIabtHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { createOpaqueToken, hashToken } from "../src/security.js";

const databaseUrl = process.env.IABT_AUTH_TEST_DATABASE_URL;

async function fixture(t, adapter) {
  let repository, twin;
  if (adapter === "memory") { repository = new MemoryRepository(); twin = repository; }
  else {
    const url = new URL(databaseUrl);
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
    const schema = "project_quota_test_" + randomUUID().replaceAll("-", "");
    const control = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
    const options = { connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis: 5000 };
    repository = new PostgresRepository({ pool: new pg.Pool(options) });
    twin = new PostgresRepository({ pool: new pg.Pool(options) });
    t.after(async () => {
      await Promise.all([repository.close(), twin.close()]);
      try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await control.end(); }
    });
    await control.query(`CREATE SCHEMA ${schema}`);
    await repository.ready();
  }
  const servers = [];
  const origins = [];
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "project-quota-test-only" });
  for (const instance of [repository, twin]) {
    const server = createServer(createIabtHandler({ repository: instance, config }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    origins.push(`http://127.0.0.1:${server.address().port}`);
  }
  t.after(async () => { await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))); });
  const account = async (name, role = "user") => {
    const user = await repository.createUser({ email: `${name}@example.test`, passwordHash: "unused", emailVerified: true, role });
    const token = createOpaqueToken();
    await repository.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600000).toISOString() });
    return { user, token };
  };
  const request = async (who, route = "", { method = "POST", body = {}, instance = 0, entity = "Project" } = {}) => {
    const response = await fetch(`${origins[instance]}/v1/entities/${entity}${route ? "/" + route : ""}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.token}` },
      ...(method !== "GET" ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  const entitlement = (who, plan, status = "active", extra = {}) => repository.createRecord("AccountEntitlement", who.user, {
    user_id: who.user.id, plan, status, ...extra
  });
  const projects = (who) => repository.listRecordsExact("Project", { ...who.user, role: "user" }, { limit: 500 });
  return { repository, twin, account, request, entitlement, projects };
}

for (const adapter of ["memory", "postgres"]) {
  const regression = (name, callback) => test(`${adapter}: ${name}`, { skip: adapter === "postgres" && !databaseUrl, timeout: 30000 }, callback);

  regression("concurrent direct Project POST requests share the account quota across API instances", async (t) => {
    const f = await fixture(t, adapter);
    const owner = await f.account("owner");
    const other = await f.account("other");
    // Another owner's unlimited plan and projects do not grant or consume this account's capacity.
    await f.entitlement(other, "agency");
    await f.repository.createRecord("Project", other.user, { title: "Other private project" });
    const credits = await f.repository.getCreditAccount(owner.user.id);
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => f.request(owner, "", {
      instance: index % 2, body: { title: "Concurrent " + index, owner_id: other.user.id, plan: "agency", project_limit: 0 }
    })));
    assert.equal(results.filter((result) => result.status === 201).length, 1, JSON.stringify(results));
    const denied = results.filter((result) => result.status !== 201);
    assert.equal(denied.length, 7);
    assert.ok(denied.every((result) => result.status === 403 && result.body.error === "project_limit_reached"), JSON.stringify(denied));
    const [created] = await f.projects(owner);
    assert.equal(created.owner_id, owner.user.id);
    assert.equal((await f.projects(owner)).length, 1);
    assert.equal((await f.projects(other)).length, 1);
    assert.deepEqual(await f.repository.getCreditAccount(owner.user.id), credits);
    assert.equal((await f.request(owner, "", { entity: "AccountEntitlement", body: { plan: "agency", status: "active" } })).status, 403);
  });

  regression("bulk creation is atomic and simultaneous batches cannot oversubscribe a paid plan", async (t) => {
    const f = await fixture(t, adapter);
    const owner = await f.account("builder");
    const denied = await f.request(owner, "bulk", { body: { records: [{ title: "A" }, { title: "B" }] } });
    assert.equal(denied.status, 403);
    assert.equal((await f.projects(owner)).length, 0, "Denied batches must not leave a partial import");
    await f.entitlement(owner, "builder", "past_due", { project_limit: 0 });
    assert.equal((await f.request(owner, "bulk", { body: { records: Array.from({ length: 3 }, (_, index) => ({ title: "Existing " + index })) } })).status, 201);
    const results = await Promise.all([0, 1].map((instance) => f.request(owner, "bulk", {
      instance, body: { records: [{ title: "New A" }, { title: "New B" }] }
    })));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 403]);
    assert.equal((await f.projects(owner)).length, 5, "Stored numeric overrides must not make builder unlimited");
    assert.equal((await f.request(owner, "bulk", { body: { records: [] } })).status, 201);
  });

  regression("administrators keep their own limits while trialing pro and agency plans retain advertised capacity", async (t) => {
    const f = await fixture(t, adapter);
    const admin = await f.account("admin", "admin");
    const pro = await f.account("pro");
    const agency = await f.account("agency");
    await f.entitlement(pro, "pro", "trialing");
    await f.entitlement(agency, "agency");
    for (const [who, count] of [[pro, 25], [agency, 35]]) {
      const created = await f.request(who, "bulk", { body: { records: Array.from({ length: count }, (_, index) => ({ title: "Project " + index })) } });
      assert.equal(created.status, 201, JSON.stringify(created));
    }
    assert.equal((await f.request(pro)).status, 403);
    assert.equal((await f.request(agency)).status, 201);
    assert.equal((await f.request(admin)).status, 201, "Other owners' projects do not count toward an administrator's own capacity");
    assert.equal((await f.request(admin)).status, 403, "Administration does not bypass the administrator's own subscription");
  });

  regression("inactive entitlement falls back to free and deleting an owned project restores capacity", async (t) => {
    const f = await fixture(t, adapter);
    const owner = await f.account("canceled");
    await f.entitlement(owner, "agency", "canceled", { project_limit: 0 });
    const created = await f.request(owner, "", { body: { title: "First" } });
    assert.equal(created.status, 201);
    assert.equal((await f.request(owner)).status, 403);
    assert.equal((await f.request(owner, created.body.id, { method: "PATCH", body: { title: "Still editable" } })).status, 200);
    assert.equal((await f.request(owner, created.body.id, { method: "DELETE" })).status, 200);
    assert.equal((await f.request(owner)).status, 201);
  });

  regression("internal migration may preserve over-limit records without enabling new public creates", async (t) => {
    const f = await fixture(t, adapter);
    const owner = await f.account("migrated");
    const original = await f.repository.createRecord("Project", owner.user, { title: "Imported A" });
    await f.repository.createRecord("Project", owner.user, { title: "Imported B" });
    assert.equal((await f.request(owner, "list", { body: { limit: 50 } })).body.length, 2);
    assert.equal((await f.request(owner, original.id, { method: "PATCH", body: { title: "Imported project retained" } })).status, 200);
    assert.equal((await f.request(owner)).status, 403);
    assert.equal((await f.projects(owner)).length, 2);
  });

  regression("unknown stored plans cannot accidentally resolve to an unlimited inherited property", async (t) => {
    const f = await fixture(t, adapter);
    const owner = await f.account("unknown-plan");
    await f.entitlement(owner, "toString", "active", { project_limit: 0 });
    assert.equal((await f.request(owner)).status, 201);
    assert.equal((await f.request(owner)).status, 403);
  });

  regression("an interrupted project batch rolls back every insertion", async (t) => {
    const f = await fixture(t, adapter);
    const owner = await f.account("rollback");
    await f.entitlement(owner, "builder");
    const originalTransaction = f.repository.withRecordTransaction.bind(f.repository);
    f.repository.withRecordTransaction = (callback) => originalTransaction(async (tx) => {
      const createRecord = tx.createRecord.bind(tx);
      let insertions = 0;
      tx.createRecord = async (...args) => {
        const result = await createRecord(...args);
        if (++insertions === 2) throw Object.assign(new Error("Test transaction interruption"), { status: 503, code: "test_write_interrupted" });
        return result;
      };
      return callback(tx);
    });
    const interrupted = await f.request(owner, "bulk", { body: { records: [{ title: "A" }, { title: "B" }] } });
    assert.equal(interrupted.status, 503);
    f.repository.withRecordTransaction = originalTransaction;
    assert.equal((await f.projects(owner)).length, 0);
    assert.equal((await f.request(owner, "bulk", { body: { records: [{ title: "A" }, { title: "B" }] } })).status, 201);
  });
}
