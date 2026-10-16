import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { loadConfig } from "../src/config.js";
import { createJobWorker } from "../src/worker.js";
import { createMaintenanceWorker } from "../src/maintenance/worker.js";
import { ensureMaintenanceSchedule, configureMaintenance, readMaintenanceStatus } from "../src/maintenance/service.js";

const databaseUrl = process.env.IABT_AUTH_TEST_DATABASE_URL;
const adapters = ["memory", ...(databaseUrl ? ["postgres"] : [])];
const fixture = async (t, adapter, env = {}) => {
  let repository;
  let twin;
  if (adapter === "memory") { repository = new MemoryRepository(); twin = repository; }
  else {
    const url = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.match(url.pathname, /test/);
    assert.notEqual(process.env.NODE_ENV, "production");
    const schema = "maintenance_test_" + randomUUID().replaceAll("-", "");
    const control = new pg.Pool({ connectionString: databaseUrl });
    await control.query(`CREATE SCHEMA ${schema}`);
    const options = { connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 5 };
    repository = new PostgresRepository({ pool: new pg.Pool(options) });
    twin = new PostgresRepository({ pool: new pg.Pool(options) });
    t.after(async () => { await repository.close(); await twin.close(); try { await control.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await control.end(); } });
    await repository.ready();
  }
  const user = await repository.createUser({ email: "maintained@example.test", passwordHash: "unused", emailVerified: true });
  const other = await repository.createUser({ email: "other@example.test", passwordHash: "unused", emailVerified: true, role: "admin" });
  const config = loadConfig({ NODE_ENV: "test", ...env });
  const objects = new Map();
  let reads = 0;
  const storage = { kind: "test", read: async (key) => { reads += 1; return objects.get(key); } };
  const worker = createMaintenanceWorker({ repository, storage, config, workerId: "maintenance-test" });
  t.after(() => worker.stop());
  const due = async (ownerId = user.id) => {
    if (adapter === "memory") repository.maintenanceSchedules.get(ownerId).next_run_at = "2000-01-01T00:00:00.000Z";
    else await repository.pool.query("UPDATE iabt_maintenance SET next_run_at = '2000-01-01' WHERE owner_id = $1", [ownerId]);
  };
  const expire = async (ownerId = user.id) => {
    if (adapter === "memory") repository.maintenanceSchedules.get(ownerId).lease_expires_at = "2000-01-01T00:00:00.000Z";
    else await repository.pool.query("UPDATE iabt_maintenance SET lease_expires_at = '2000-01-01' WHERE owner_id = $1", [ownerId]);
  };
  await ensureMaintenanceSchedule({ repository, user, config });
  await ensureMaintenanceSchedule({ repository, user: other, config });
  await configureMaintenance({ repository, user: other, config, enabled: false });
  const makeJob = async ({ contents = ["artifact evidence"], owner = user, jobType = "provider.openai.response", planStatus = "executing", creditAmount = 0 } = {}) => {
    const plan = await repository.createRecord("CreationPlan", owner, { status: planStatus });
    if (creditAmount) await repository.grantCredits({ ownerId: owner.id, amount: creditAmount, idempotencyKey: randomUUID() });
    const job = await repository.enqueueJob({ ownerId: owner.id, jobType, input: { plan_id: plan.id }, idempotencyKey: randomUUID(), creditAmount });
    await repository.updateRecord("CreationPlan", plan.id, owner, { execution_job_id: job.id });
    const claimed = await repository.claimNextJob({ workerId: "creation-test" });
    assert.equal(claimed.id, job.id);
    const artifacts = contents.map((content, index) => {
      const id = randomUUID();
      const bytes = Buffer.from(content);
      const storageKey = owner.id + "/" + id;
      objects.set(storageKey, bytes);
      return { id, ownerId: owner.id, storageProvider: storage.kind, storageKey, originalName: "private-" + index + ".txt", contentType: "text/plain", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    const result = await repository.completeJob({ jobId: job.id, workerId: "creation-test", output: { verified: true, artifact_manifest: artifacts.map((item) => ({ id: item.id, name: item.originalName, size_bytes: item.sizeBytes, sha256: item.sha256 })) }, artifacts });
    return { job: result.job, plan, artifacts: result.artifacts };
  };
  return { adapter, repository, twin, user, other, config, objects, storage, worker, due, expire, makeJob, reads: () => reads };
};

for (const adapter of adapters) {
  test(`${adapter}: maintenance repairs bound plan projections, backfills observations and verifies files without touching credits`, async (t) => {
    const context = await fixture(t, adapter);
    const { repository, user, config } = context;
    const created = await context.makeJob({ creditAmount: 1 });
    const credits = await repository.getCreditAccount(user.id);
    const result = await context.worker.runOnce();
    assert.equal(result.summary.plans_reconciled, 1);
    assert.equal(result.summary.lessons_ensured, 1);
    assert.equal(result.summary.artifacts_verified, 1);
    assert.equal((await repository.getRecord("CreationPlan", created.plan.id, user)).status, "completed");
    assert.equal((await repository.listRecordsExact("JerichoLesson", { id: user.id, role: "user" })).length, 1);
    assert.deepEqual(await repository.getCreditAccount(user.id), credits);
    assert.equal((await repository.getJob(created.job.id, user)).attempt_count, 1);
    await context.due();
    await context.worker.runOnce();
    assert.equal((await repository.listRecordsExact("JerichoLesson", { id: user.id, role: "user" })).length, 1);
    const status = await readMaintenanceStatus({ repository, user, config });
    assert.equal(status.summary.plans_reconciled, 0);
    assert.doesNotMatch(JSON.stringify(status), /lease_token|storage_key|password_hash|private-0/);
  });

  test(`${adapter}: persisted pause survives reenrollment and owner scopes cannot configure another schedule`, async (t) => {
    const context = await fixture(t, adapter);
    const { repository, user, other, config } = context;
    await configureMaintenance({ repository, user, config, enabled: false, intervalMinutes: 10 });
    await ensureMaintenanceSchedule({ repository, user, config });
    await repository.enrollVerifiedMaintenance({ intervalMs: 900000 });
    const status = await readMaintenanceStatus({ repository: context.twin, user, config });
    assert.equal(status.enabled, false);
    assert.equal(status.interval_minutes, 10);
    await configureMaintenance({ repository, user: other, config, enabled: true, owner_id: user.id });
    assert.equal((await repository.getMaintenance(user.id)).enabled, false);
    await assert.rejects(configureMaintenance({ repository, user, config, enabled: "true" }), { code: "maintenance_enabled_required" });
    await assert.rejects(configureMaintenance({ repository, user, config, enabled: true, intervalMinutes: 1 }), { code: "invalid_maintenance_interval" });
    await assert.rejects(ensureMaintenanceSchedule({ repository, user: { ...user, email_verified: false }, config }), { code: "verified_account_required" });
  });

  test(`${adapter}: only one maintenance lease wins and recovered leases reject stale writes transactionally`, async (t) => {
    const context = await fixture(t, adapter);
    const { repository, twin, user } = context;
    const claims = await Promise.all([repository.claimDueMaintenance({ workerId: "first", leaseMs: 30000 }), twin.claimDueMaintenance({ workerId: "second", leaseMs: 30000 })]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean);
    await repository.saveMaintenanceProgress({ ownerId: user.id, leaseToken: first.lease_token, checkpoint: { cursor: { completed_at: "2020-01-01T00:00:00.000Z", job_id: randomUUID() } } });
    await context.expire();
    const next = await twin.claimDueMaintenance({ workerId: "replacement", leaseMs: 30000 });
    assert.notEqual(first.lease_token, next.lease_token);
    assert.ok(next.checkpoint.cursor);
    await assert.rejects(repository.saveMaintenanceProgress({ ownerId: user.id, leaseToken: first.lease_token, checkpoint: { forged: true } }), { code: "maintenance_lease_lost" });
    const record = await repository.createRecord("Project", user, { title: "original" });
    await assert.rejects(repository.withMaintenanceLease({ ownerId: user.id, leaseToken: next.lease_token }, async (tx) => {
      await tx.updateRecord("Project", record.id, user, { title: "must roll back" });
      await tx.saveMaintenanceProgress({ ownerId: user.id, leaseToken: next.lease_token, checkpoint: { must_rollback: true } });
      throw new Error("test rollback");
    }));
    assert.equal((await repository.getRecord("Project", record.id, user)).title, "original");
    assert.equal((await repository.getMaintenance(user.id)).checkpoint.must_rollback, undefined);
  });

  test(`${adapter}: bounded passes preserve scan cursor and continue without restarting completed jobs`, async (t) => {
    const context = await fixture(t, adapter, { IABT_MAINTENANCE_MAX_JOBS: "1" });
    await context.makeJob();
    await context.makeJob();
    const first = await context.worker.runOnce();
    assert.equal(first.summary.jobs_checked, 1);
    const cursor = first.checkpoint.cursor;
    await context.due();
    const replacement = createMaintenanceWorker({ ...context, repository: context.twin, workerId: "replacement" });
    t.after(() => replacement.stop());
    const second = await replacement.runOnce();
    assert.equal(second.summary.jobs_checked, 1);
    assert.notEqual(second.checkpoint.cursor.job_id, cursor.job_id);
    await context.due();
    const final = await replacement.runOnce();
    assert.equal(final.summary.pass_complete, true);
    assert.equal(final.checkpoint.cursor, null);
    assert.equal((await context.repository.listJobs(context.user)).every((job) => job.status === "succeeded" && job.attempt_count === 1), true);
  });

  test(`${adapter}: missing or corrupt artifact findings never delete files, modify credits or replay generation`, async (t) => {
    const context = await fixture(t, adapter);
    const first = await context.makeJob({ creditAmount: 1 });
    context.objects.set(first.artifacts[0].storage_key, Buffer.from("corrupt bytes"));
    const credits = await context.repository.getCreditAccount(context.user.id);
    const result = await context.worker.runOnce();
    assert.equal(result.summary.findings.some((item) => item.code === "artifact_integrity_mismatch"), true);
    assert.equal(result.summary.status, "needs_attention");
    assert.deepEqual(await context.repository.getCreditAccount(context.user.id), credits);
    assert.equal(context.objects.size, 1);
    assert.equal((await context.repository.getJob(first.job.id, context.user)).status, "succeeded");
  });

  test(`${adapter}: transient storage retry checkpoints survive restarts and stop after three reads`, async (t) => {
    const context = await fixture(t, adapter);
    await context.makeJob();
    let attempts = 0;
    context.storage.read = async () => { attempts += 1; throw Object.assign(new Error("private transient details"), { code: "ECONNRESET" }); };
    for (let i = 0; i < 3; i += 1) {
      const replacement = createMaintenanceWorker({ ...context, repository: context.twin, workerId: "replacement-" + i });
      const result = await replacement.runOnce();
      await replacement.stop();
      if (i < 2) { assert.equal(result.summary.status, "retry_pending"); assert.equal(result.checkpoint.current_job.read_attempts, i + 1); }
      else assert.equal(result.summary.findings.some((item) => item.code === "artifact_read_retry_exhausted"), true);
      await context.due();
    }
    assert.equal(attempts, 3);
    assert.doesNotMatch(JSON.stringify(await readMaintenanceStatus(context)), /private transient details/);
  });

  test(`${adapter}: per-pass byte limit checkpoints artifact position instead of silently skipping files`, async (t) => {
    const context = await fixture(t, adapter, { IABT_MAINTENANCE_MAX_PASS_BYTES: "10" });
    await context.makeJob({ contents: ["1234567890", "abcdefghij"] });
    const first = await context.worker.runOnce();
    assert.equal(first.summary.artifact_bytes_read, 10);
    assert.equal(first.checkpoint.current_job.artifact_index, 1);
    await context.due();
    const second = await context.worker.runOnce();
    assert.equal(second.summary.artifact_bytes_read, 10);
    assert.equal(second.summary.jobs_checked, 1);
    assert.equal(context.reads(), 2);
  });

  test(`${adapter}: pause during a storage read revokes lease before another checkpoint or repair`, async (t) => {
    const context = await fixture(t, adapter);
    const created = await context.makeJob();
    let release;
    let entered;
    const waiting = new Promise((resolve) => { entered = resolve; });
    context.storage.read = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
    const pass = context.worker.runOnce();
    await waiting;
    await configureMaintenance({ ...context, enabled: false });
    release(context.objects.get(created.artifacts[0].storage_key));
    await assert.rejects(pass, { code: "maintenance_lease_lost" });
    assert.equal((await readMaintenanceStatus(context)).status, "paused");
    assert.equal((await context.repository.getMaintenance(context.user.id)).checkpoint.current_job.artifact_index, 0);
  });

  test(`${adapter}: remote readback is unverified by default and requires the operator metered-read setting`, async (t) => {
    const context = await fixture(t, adapter);
    context.storage.kind = "s3";
    await context.makeJob();
    const disabled = await context.worker.runOnce();
    assert.equal(context.reads(), 0);
    assert.equal(disabled.summary.plans_reconciled, 1);
    assert.equal(disabled.summary.findings.some((item) => item.code === "remote_readback_disabled_unverified"), true);
    assert.equal((await readMaintenanceStatus(context)).remote_readback_enabled, false);
    await context.due();
    const enabledConfig = loadConfig({ NODE_ENV: "test", IABT_MAINTENANCE_REMOTE_READBACK_ENABLED: "true" });
    const enabled = createMaintenanceWorker({ ...context, config: enabledConfig });
    t.after(() => enabled.stop());
    const result = await enabled.runOnce();
    assert.equal(context.reads(), 1);
    assert.equal(result.summary.artifacts_verified, 1);
    assert.equal(result.summary.findings.length, 0);
  });
}

test("maintenance completion logs only safe counts after a committed pass", async (t) => {
  const context = await fixture(t, "memory");
  await context.makeJob();
  const entries = [];
  const worker = createMaintenanceWorker({ ...context, log: (entry) => entries.push(entry) });
  t.after(() => worker.stop());
  await worker.runOnce();
  assert.deepEqual(entries, [{
    event: "jericho_maintenance_pass", status: "pass_finished", findings_count: 0,
    jobs_checked: 1, plans_reconciled: 1, lessons_ensured: 1,
    artifacts_verified: 1, artifact_bytes_read: 17, artifact_reads: 1
  }]);
  await worker.runOnce();
  assert.equal(entries.length, 1, "an idle tick must not claim a pass completed");
  await context.due();
  const brokenLogger = createMaintenanceWorker({ ...context, log: () => { throw new Error("logger unavailable"); } });
  t.after(() => brokenLogger.stop());
  assert.equal((await brokenLogger.runOnce()).summary.status, "pass_finished");
});

test("postgres: lease expiration is checked after waiting for a database transaction lock", { skip: !databaseUrl }, async (t) => {
  const context = await fixture(t, "postgres");
  const lease = await context.repository.claimDueMaintenance({ workerId: "soon-expired", leaseMs: 100 });
  const blocker = await context.repository.pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(1782451011)");
    const renewal = assert.rejects(context.twin.renewMaintenanceLease({ ownerId: context.user.id, leaseToken: lease.lease_token, leaseMs: 30000 }), { code: "maintenance_lease_lost" });
    await delay(150);
    await blocker.query("COMMIT");
    await renewal;
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
});

test("the running application worker enrolls existing verified owners without a browser or login", async (t) => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "existing@example.test", passwordHash: "unused", emailVerified: true });
  const unverified = await repository.createUser({ email: "unverified@example.test", passwordHash: "unused" });
  const config = loadConfig({ NODE_ENV: "test" });
  const worker = createJobWorker({ repository, storage: { kind: "test" }, providers: {}, config });
  t.after(() => worker.stop());
  const result = await worker.runMaintenanceOnce();
  assert.equal(result.owner_id, user.id);
  assert.equal(result.summary.pass_complete, true);
  assert.equal(await repository.getMaintenance(unverified.id), null);
  await configureMaintenance({ repository, user, config, enabled: false });
  assert.equal(await worker.runMaintenanceOnce(), null);
});
