import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PostgresRepository } from "../src/postgres-repository.js";
import { handleExchangeFunction } from "../src/functions/exchange.js";

const connectionString = process.env.IABT_AUTH_TEST_DATABASE_URL;

// This suite may create and drop only its own generated schema in a disposable
// local test database. It never falls back to the application's database URL.
const assertDisposableDatabase = () => {
  const url = new URL(connectionString);
  assert.notEqual(process.env.NODE_ENV, "production", "Production mode cannot run database mutation tests");
  assert.ok(["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname), "Database regression tests require a local database");
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|_)test(?:$|_)/, "Database name must explicitly identify a test database");
};

const fixture = async (t) => {
  assertDisposableDatabase();
  const schema = "workflow_test_" + randomUUID().replaceAll("-", "");
  assert.match(schema, /^workflow_test_[a-f0-9]{32}$/);
  const control = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const options = { connectionString, options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis: 5000 };
  const repository = new PostgresRepository({ pool: new pg.Pool(options) });
  const otherInstance = new PostgresRepository({ pool: new pg.Pool(options) });
  t.after(async () => {
    await Promise.all([repository.close(), otherInstance.close()]);
    try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await control.end(); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  await repository.ready();
  const users = {};
  for (const name of ["founder", "member", "outsider"]) {
    users[name] = await repository.createUser({ email: `${name}@example.test`, name, passwordHash: "test-only-unused", emailVerified: true });
  }
  const call = async (name, who = "founder", body = {}, instance = repository) =>
    (await handleExchangeFunction({ name, body, user: users[who], repository: instance })).payload.data;
  for (const who of ["founder", "member"]) await call("save-exchange-profile", who, {
    public_alias: `${who} alias`, headline: "Application engineer", skills: ["React"], status: "active", visibility: "match_only", availability: "project_based",
    relationship_types: ["paid_contractor"], compensation_preferences: ["paid"], project_stage_preferences: ["idea"], contact_disclosure_fields: ["email"]
  });
  const { need } = await call("save-project-need", "founder", {
    title: "A collaboration app", public_summary: "Looking for application expertise", private_summary: "CONFIDENTIAL_TEST_NOTES", required_capabilities: ["React"],
    relationship_requested: ["paid_contractor"], compensation_model: ["paid"], project_stage: "idea", status: "active", visibility: "match_only"
  });
  const matched = await call("find-collaboration-matches", "founder", { project_need_id: need.id });
  assert.equal(matched.matches.length, 1);
  const match = matched.matches[0];
  const { introduction } = await call("request-introduction", "founder", { match_id: match.id, request_message: "Discuss this application?", disclosure_fields: ["email", "private_project_summary"] });
  const service = { id: users.founder.id, role: "admin" };
  return { repository, otherInstance, schema, users, call, need, match, introduction, service };
};

const postgresTest = (name, callback) => test(name, {
  skip: !connectionString && "Set IABT_AUTH_TEST_DATABASE_URL to the disposable local PostgreSQL test database",
  timeout: 30000
}, callback);

postgresTest("postgres: workspace scalar filtering and pagination transfer only the requested rows", async (t) => {
  const f = await fixture(t);
  await f.repository.pool.query(`INSERT INTO iabt_entity_records(entity_name, id, owner_id, payload, created_at)
    SELECT 'CreationPlan', md5($1 || ordinal::text)::uuid, $2::uuid,
      jsonb_build_object('conversation_id', CASE WHEN ordinal <= 5 THEN 'selected' ELSE 'unrelated' END,
        'ordinal', ordinal, 'source', repeat('unneeded-source-', 100)),
      '2020-01-01'::timestamptz + ordinal * interval '1 second'
    FROM generate_series(1, 5006) AS ordinal`, [randomUUID(), f.users.founder.id]);
  await f.repository.createRecord("CreationPlan", f.users.outsider, { conversation_id: "selected", ordinal: 999 });
  const originalQuery = f.repository.pool.query.bind(f.repository.pool);
  let transferredRows = 0;
  f.repository.pool.query = async (...args) => {
    const result = await originalQuery(...args);
    transferredRows += result.rows.length;
    return result;
  };
  const records = await f.repository.listRecords("CreationPlan", f.users.founder, {
    query: { conversation_id: "selected" }, sort: "created_date", limit: 2, skip: 1
  });
  assert.deepEqual(records.map((row) => row.ordinal), [2, 3]);
  assert.equal(transferredRows, 2, "filtering and pagination must happen before rows leave Postgres");
  assert.ok(records.every((row) => row.owner_id === f.users.founder.id));
  const literal = "selected' OR TRUE --";
  await f.repository.createRecord("CreationPlan", f.users.founder, { conversation_id: literal });
  assert.equal((await f.repository.listRecords("CreationPlan", f.users.founder, { query: { conversation_id: literal } })).length, 1);
});

postgresTest("postgres: lightweight workspace jobs retain status and manifests without transferring durable source", async (t) => {
  const f = await fixture(t);
  const source = "PRIVATE_SOURCE_".repeat(40000);
  const job = await f.repository.enqueueJob({ ownerId: f.users.founder.id, jobType: "creation.orchestrated",
    input: { conversation_id: "chat", request_text: source }, approval: { pricing_version: "test", secret: source }, idempotencyKey: "summary" });
  const metadata = { runtime_tested: false, revision_of_file_id: randomUUID() };
  const output = {
    plan_id: "plan", artifact_manifest: [{ id: randomUUID(), kind: "app", metadata }],
    provider_metadata: { delivery_mode: "web_app_source", limitations: ["Untested behavior"] },
    orchestration: { phase: "complete", turn: 3, inspected_file_ids: [randomUUID()], failures: [{ code: "repaired" }],
      pending_response: source, artifacts: [{ content_base64: source }],
      execution_graph: { nodes: [{ id: "build", tool: "create_web_app", status: "succeeded", depends_on: [], attempts: [{ result: source }] }] } }
  };
  await f.repository.pool.query("UPDATE iabt_jobs SET output=$2::jsonb WHERE id=$1", [job.id, JSON.stringify(output)]);
  const full = await f.repository.getJob(job.id, f.users.founder);
  const summary = await f.repository.getJob(job.id, f.users.founder, { summaryOnly: true });
  assert.equal(full.input.request_text, source, "worker recovery retains exact durable input");
  assert.equal(full.output.orchestration.pending_response, source);
  assert.equal(summary.id, full.id);
  assert.equal(summary.status, full.status);
  assert.equal(summary.input.conversation_id, "chat");
  assert.deepEqual(summary.output.artifact_manifest, output.artifact_manifest);
  assert.deepEqual(summary.output.provider_metadata, output.provider_metadata);
  assert.deepEqual(summary.output.orchestration.execution_graph.nodes, [{ id: "build", tool: "create_web_app", status: "succeeded", depends_on: [] }]);
  assert.equal(JSON.stringify(summary).includes("PRIVATE_SOURCE_"), false);
  assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length / 100);
  assert.equal(await f.repository.getJob(job.id, f.users.outsider, { summaryOnly: true }), null);
  assert.deepEqual(await f.repository.listJobs(f.users.outsider, { summaryOnly: true }), []);
  assert.deepEqual((await f.repository.listJobs(f.users.founder, { summaryOnly: true }))[0], summary);
});

postgresTest("postgres: an older active block remains effective behind 5,001 newer unrelated records", async (t) => {
  const f = await fixture(t);
  const block = await f.repository.createRecord("ExchangeBlock", f.users.member, {
    blocker_user_id: f.users.member.id, blocked_user_id: f.users.founder.id, status: "active", created_at: "2000-01-01T00:00:00Z"
  });
  await f.repository.pool.query("UPDATE iabt_entity_records SET created_at = '2000-01-01', updated_at = '2000-01-01' WHERE entity_name = 'ExchangeBlock' AND id = $1", [block.id]);
  await f.repository.pool.query(
    `INSERT INTO iabt_entity_records (entity_name, id, owner_id, payload)
     SELECT 'ExchangeBlock', md5($1 || ordinal::text)::uuid, $2::uuid,
       jsonb_build_object('blocker_user_id', $2::text, 'blocked_user_id', 'unrelated-' || ordinal::text, 'status', 'active')
     FROM generate_series(1, 5001) AS ordinal`,
    [randomUUID(), f.users.outsider.id]
  );
  const exact = await f.repository.listRecordsExact("ExchangeBlock", f.service, {
    query: { owner_id: f.users.member.id, blocker_user_id: f.users.member.id, blocked_user_id: f.users.founder.id, status: "active" }, limit: 1
  });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].id, block.id);
  assert.equal((await f.call("find-collaboration-matches", "founder", { project_need_id: f.need.id })).match_count, 0);
  await assert.rejects(
    f.call("respond-to-introduction", "member", { introduction_id: f.introduction.id, action: "accept", disclosure_fields: ["email"] }),
    (error) => error.code === "exchange_blocked"
  );
  assert.equal((await f.repository.getRecord("IntroductionRequest", f.introduction.id, f.service)).status, "pending");
  assert.equal((await f.repository.listRecordsExact("CollaborationRoom", f.service)).length, 0);
});

postgresTest("postgres: concurrent consent across API instances creates exactly one accepted room", async (t) => {
  const f = await fixture(t);
  const body = { introduction_id: f.introduction.id, action: "accept", disclosure_fields: ["email"] };
  const results = await Promise.allSettled([
    f.call("respond-to-introduction", "member", body),
    f.call("respond-to-introduction", "member", body, f.otherInstance)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "introduction_resolved");
  const rooms = await f.repository.listRecordsExact("CollaborationRoom", f.service, { query: { introduction_request_id: f.introduction.id } });
  assert.equal(rooms.length, 1);
  const persisted = await f.repository.getRecord("IntroductionRequest", f.introduction.id, f.service);
  assert.equal(persisted.status, "accepted");
  assert.equal(persisted.requester_disclosure_consent, true);
  assert.equal(persisted.recipient_disclosure_consent, true);
  const visible = await f.call("get-collaboration-room", "member", { room_id: rooms[0].id }, f.otherInstance);
  assert.deepEqual(visible.other_contact, { email: "founder@example.test" });
  assert.equal(visible.project_need.private_summary, "CONFIDENTIAL_TEST_NOTES");
  await f.call("block-exchange-user", "member", { target_user_id: f.users.founder.id }, f.otherInstance);
  const blocked = await f.call("get-collaboration-room", "member", { room_id: rooms[0].id });
  assert.deepEqual(blocked.other_contact, {});
  assert.equal(blocked.project_need.private_summary, "");
  assert.equal(blocked.room.status, "suspended");
});

postgresTest("postgres: a failed audit atomically rolls back consent, room creation, and match changes", async (t) => {
  const f = await fixture(t);
  await f.repository.pool.query(`
    CREATE FUNCTION fail_test_acceptance_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.entity_name = 'ExchangeAuditEvent' AND NEW.payload->>'event_type' = 'introduction_accepted' THEN
        RAISE EXCEPTION 'test acceptance audit unavailable';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER fail_test_acceptance_audit BEFORE INSERT ON iabt_entity_records
    FOR EACH ROW EXECUTE FUNCTION fail_test_acceptance_audit();
  `);
  await assert.rejects(
    f.call("respond-to-introduction", "member", { introduction_id: f.introduction.id, action: "accept", disclosure_fields: ["email"] }),
    /test acceptance audit unavailable/
  );
  assert.equal((await f.repository.getRecord("IntroductionRequest", f.introduction.id, f.service)).status, "pending");
  assert.equal((await f.repository.getRecord("MatchRecord", f.match.id, f.service)).status, "introduction_requested");
  assert.equal((await f.repository.listRecordsExact("CollaborationRoom", f.service)).length, 0);
  await f.repository.pool.query("DROP TRIGGER fail_test_acceptance_audit ON iabt_entity_records");
  const recovered = await f.call("respond-to-introduction", "member", { introduction_id: f.introduction.id, action: "accept", disclosure_fields: ["email"] }, f.otherInstance);
  assert.equal(recovered.room.status, "active");
  assert.equal((await f.repository.listRecordsExact("CollaborationRoom", f.service)).length, 1);
});
