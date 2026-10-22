import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { MemoryRepository } from '../src/memory-repository.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { recoverOwner } from '../src/owner-recovery.js';
import { hashToken, verifyPassword } from '../src/security.js';

const databaseUrl = process.env.IABT_AUTH_TEST_DATABASE_URL;
const adapters = ['memory', ...(databaseUrl ? ['postgres'] : [])];
async function fixture(t, adapter) {
  if (adapter === 'memory') return new MemoryRepository();
  const url = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /test/);
  assert.notEqual(process.env.NODE_ENV, 'production');
  const schema = 'autonomy_test_' + randomUUID().replaceAll('-', '');
  const control = new pg.Pool({ connectionString: databaseUrl });
  await control.query(`CREATE SCHEMA ${schema}`);
  const repository = new PostgresRepository({ pool: new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 5 }) });
  t.after(async () => {
    await repository.close();
    try { await control.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await control.end(); }
  });
  await repository.ready();
  return repository;
}

for (const adapter of adapters) {
  test(`${adapter}: durable checkpoints retain recovery evidence and reject stale workers`, async (t) => {
    const repository = await fixture(t, adapter);
    const user = await repository.createUser({ email: 'durable@example.test', passwordHash: 'unused', emailVerified: true });
    await repository.grantCredits({ ownerId: user.id, amount: 2, idempotencyKey: 'grant' });
    const request = { ownerId: user.id, jobType: 'artifact.echo', input: {}, idempotencyKey: 'same', creditAmount: 1 };
    const jobs = await Promise.all(Array.from({ length: 5 }, () => repository.enqueueJob(request)));
    assert.equal(new Set(jobs.map(j => j.id)).size, 1);
    assert.equal((await repository.getCreditAccount(user.id)).available_credits, 1);
    const job = await repository.claimNextJob({ workerId: 'worker-a' });
    const evidence = { objective: 'Private objective', stage: 'polling', response_id: 'resp_test' };
    await repository.checkpointJob({ jobId: job.id, workerId: 'worker-a', outputPatch: { orchestration: evidence } });
    await assert.rejects(repository.checkpointJob({ jobId: job.id, workerId: 'stale', outputPatch: { forged: true } }), { code: 'job_lease_lost' });
    await repository.deferJob({ jobId: job.id, workerId: 'worker-a', outputPatch: { verified_checkpoint: true } });
    const continued = await repository.claimNextJob({ workerId: 'worker-b' });
    assert.deepEqual(continued.output.orchestration, evidence);
    assert.equal(continued.output.verified_checkpoint, true);
    const failed = await repository.failJob({ jobId: job.id, workerId: 'worker-b', error: { code: 'no_safe_recovery' } });
    assert.deepEqual(failed.job.output.orchestration, evidence);
    assert.equal((await repository.getCreditAccount(user.id)).available_credits, 2);
  });

  test(`${adapter}: server-selected record identities are atomic and owner isolated`, async (t) => {
    const repository = await fixture(t, adapter);
    const a = await repository.createUser({ email: 'a@example.test', passwordHash: 'unused' });
    const b = await repository.createUser({ email: 'b@example.test', passwordHash: 'unused', role: 'admin' });
    const id = randomUUID();
    const records = await Promise.all(Array.from({ length: 4 }, () => repository.createRecord('CreationPlan', a, { value: 'first' }, { id })));
    assert.equal(new Set(records.map(r => r.id)).size, 1);
    assert.equal((await repository.createRecord('CreationPlan', a, { value: 'overwrite' }, { id })).value, 'first');
    await assert.rejects(repository.createRecord('CreationPlan', b, {}, { id }), { code: 'record_conflict' });
    assert.notEqual((await repository.createRecord('CreationPlan', a, { id })).id, id);
  });

  test(`${adapter}: operator recovery preserves identity and revokes existing sessions`, async (t) => {
    const repository = await fixture(t, adapter);
    const owner = await repository.createUser({ email: 'owner@example.test', passwordHash: 'old', role: 'admin', emailVerified: true });
    const tokenHash = hashToken('old-session');
    await repository.createSession({ tokenHash, userId: owner.id, expiresAt: new Date(Date.now() + 60000).toISOString() });
    await recoverOwner({ repository, email: ' OWNER@example.test ', password: 'ChangedPassword123' });
    assert.equal(await repository.getSession(tokenHash), null);
    const after = await repository.findUserByEmail(owner.email, { includeSecret: true });
    assert.equal(after.id, owner.id);
    assert.equal(after.role, 'admin');
    assert.equal(await verifyPassword('ChangedPassword123', after.password_hash), true);
    await assert.rejects(recoverOwner({ repository, email: 'missing@example.test', password: 'ChangedPassword123' }), { code: 'existing_admin_required' });
  });
}
