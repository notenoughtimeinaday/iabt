import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PostgresRepository } from "../src/postgres-repository.js";
import {
  recordExecutionLesson, recordUserCorrection, resolveUserCorrection,
  loadLearningContext, proposeImprovement, listImprovementProposals, withdrawLesson
} from "../src/learning/service.js";

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;

test("PostgreSQL learning deduplicates across instances and preserves accepted evidence and withdrawals after reopening", { skip: !connectionString }, async (t) => {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/);
  const schema = "learning_test_" + randomUUID().replaceAll("-", "");
  const control = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const options = { connectionString, options: `-c search_path=${schema}`, max: 5, connectionTimeoutMillis: 5000 };
  const repositories = [new PostgresRepository({ pool: new pg.Pool(options) }), new PostgresRepository({ pool: new pg.Pool(options) })];
  t.after(async () => {
    await Promise.all(repositories.map((repository) => repository.close()));
    try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await control.end(); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  const [repository, otherInstance] = repositories;
  await repository.ready();
  const user = await repository.createUser({ email: "learning@example.test", passwordHash: "unused", emailVerified: true });
  const admin = await repository.createUser({ email: "admin@example.test", passwordHash: "unused", emailVerified: true, role: "admin" });
  const job = await repository.enqueueJob({ ownerId: user.id, jobType: "creation.document", input: {}, idempotencyKey: "learning-job", creditAmount: 0 });
  await repository.claimNextJob({ workerId: "learning-pg" });
  const bytes = Buffer.from("durable verification fixture");
  const artifact = { id: randomUUID(), ownerId: user.id, storageProvider: "local", storageKey: "private-test", originalName: "fixture.txt", contentType: "text/plain", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await repository.completeJob({ jobId: job.id, workerId: "learning-pg", output: { verified: true, artifact_manifest: [{ id: artifact.id, size_bytes: artifact.sizeBytes, sha256: artifact.sha256 }] }, artifacts: [artifact] });
  const observations = await Promise.all(Array.from({ length: 6 }, (_, index) => recordExecutionLesson({ repository: repositories[index % 2], user, job })));
  assert.equal(new Set(observations.map((lesson) => lesson.id)).size, 1);
  assert.equal(observations[0].status, "verified_delivery");
  const corrections = await Promise.all(Array.from({ length: 6 }, (_, index) => recordUserCorrection({ repository: repositories[index % 2], user, jobId: job.id, category: "missing_requirement", requestId: "same-correction" })));
  assert.equal(new Set(corrections.map((lesson) => lesson.id)).size, 1);
  const lessonId = corrections[0].id;
  const proposals = await Promise.all(Array.from({ length: 4 }, (_, index) => proposeImprovement({ repository: repositories[index % 2], user, lessonId })));
  assert.equal(new Set(proposals.map((proposal) => proposal.id)).size, 1);
  await resolveUserCorrection({ repository: otherInstance, user, lessonId, jobId: job.id, accepted: true });
  const reopened = new PostgresRepository({ pool: new pg.Pool(options) });
  repositories.push(reopened);
  const snapshot = await loadLearningContext({ repository: reopened, user });
  assert.equal(snapshot.lessons.length, 2);
  assert.equal(snapshot.lessons.find((lesson) => lesson.id === lessonId).status, "accepted_by_owner");
  const retained = await listImprovementProposals({ repository: reopened, user });
  assert.equal(retained.length, 1);
  assert.equal(retained[0].checkpoints.find((checkpoint) => checkpoint.id === "owner_acceptance").status, "attested");
  assert.deepEqual((await loadLearningContext({ repository: reopened, user: admin })).lessons, []);
  await assert.rejects(withdrawLesson({ repository: reopened, user: admin, lessonId }), { code: "lesson_not_found" });
  await withdrawLesson({ repository: otherInstance, user, lessonId });
  assert.equal((await loadLearningContext({ repository: reopened, user })).lessons.length, 1);
  assert.deepEqual(await listImprovementProposals({ repository: reopened, user }), []);
});
