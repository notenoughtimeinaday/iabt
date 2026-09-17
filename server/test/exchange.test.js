import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryRepository } from "../src/memory-repository.js";
import { PostgresRepository } from "../src/postgres-repository.js";
import { handleExchangeFunction, EXCHANGE_FUNCTIONS } from "../src/functions/exchange.js";

const fixture = async () => {
  const repository = new MemoryRepository();
  const users = {};
  for (const name of ["founder", "member", "outsider", "admin"]) {
    users[name] = await repository.createUser({ email: `${name}@example.test`, name, passwordHash: "unused", role: name === "admin" ? "admin" : "user", emailVerified: true });
  }
  const call = async (name, who = "founder", body = {}) =>
    (await handleExchangeFunction({ name, body, user: users[who], repository })).payload.data;
  for (const who of ["founder", "member", "outsider"]) await call("save-exchange-profile", who, {
    public_alias: `${who} alias`, headline: "Application engineer", skills: ["React", "Node.js"], status: "active", visibility: "match_only", availability: "project_based",
    relationship_types: ["paid_contractor"], compensation_preferences: ["paid"], project_stage_preferences: ["idea"],
    contact_disclosure_fields: ["email"], phone: "PRIVATE_PHONE", organization: "PRIVATE_ORGANIZATION", website: "https://private.example.test"
  });
  await call("save-exchange-profile", "outsider", { visibility: "private" });
  const { need } = await call("save-project-need", "founder", {
    title: "Private application", public_summary: "A collaboration application", private_summary: "CONFIDENTIAL_ROADMAP", required_capabilities: ["React"],
    relationship_requested: ["paid_contractor"], compensation_model: ["paid"], project_stage: "idea", status: "active", visibility: "match_only"
  });
  const matched = await call("find-collaboration-matches", "founder", { project_need_id: need.id });
  assert.equal(matched.match_count, 1);
  return { repository, users, call, need, match: matched.matches[0] };
};
const introduce = async (f, fields = ["email"]) =>
  (await f.call("request-introduction", "founder", { match_id: f.match.id, request_message: "Could we discuss this project?", disclosure_fields: fields })).introduction;
const connect = async (f, fields = ["email"]) => {
  const intro = await introduce(f, fields);
  const accepted = await f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept", disclosure_fields: ["email", "phone"] });
  return { intro, room: accepted.room };
};
const denies = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test("Exchange dashboard and matching disclose no private fields before consent", async () => {
  const f = await fixture();
  for (const value of [f.match, await f.call("get-exchange-dashboard", "founder")]) {
    const candidateData = JSON.stringify(value.candidate || value.matches);
    for (const secret of ["member@example.test", "PRIVATE_PHONE", "PRIVATE_ORGANIZATION", "private.example.test"]) assert.equal(candidateData.includes(secret), false);
  }
  const intro = await introduce(f, ["email", "phone", "private_project_summary"]);
  assert.deepEqual(intro.requester_disclosure_fields, ["email", "private_project_summary"]);
  const received = await f.call("get-exchange-dashboard", "member");
  assert.equal(received.introductions.length, 1);
  assert.equal(received.rooms.length, 0);
  assert.equal(JSON.stringify(received).includes("CONFIDENTIAL_ROADMAP"), false);
  assert.equal(JSON.stringify(received).includes("founder@example.test"), false);
  assert.equal((await f.call("get-exchange-dashboard", "outsider")).introductions.length, 0);
});

test("only the recipient can consent; accepted room discloses each user's allowed fields", async () => {
  const f = await fixture();
  const intro = await introduce(f, ["email", "private_project_summary"]);
  await denies(f.call("respond-to-introduction", "founder", { introduction_id: intro.id, action: "accept" }), "consent_required");
  await denies(f.call("respond-to-introduction", "admin", { introduction_id: intro.id, action: "accept" }), "introduction_not_found");
  const { room } = await f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept", disclosure_fields: ["email", "phone"] });
  const result = await f.call("get-collaboration-room", "member", { room_id: room.id });
  assert.deepEqual(result.other_contact, { email: "founder@example.test" });
  assert.equal(result.project_need.private_summary, "CONFIDENTIAL_ROADMAP");
  assert.deepEqual((await f.call("get-collaboration-room", "founder", { room_id: room.id })).other_contact, { email: "member@example.test" });
  await denies(f.call("get-collaboration-room", "outsider", { room_id: room.id }), "room_not_found");
  await denies(f.call("get-collaboration-room", "admin", { room_id: room.id }), "room_not_found");
  const sent = await f.call("send-collaboration-message", "member", { room_id: room.id, message: "Private room message" });
  assert.equal(sent.message.sender_user_id, f.users.member.id);
  assert.equal((await f.call("get-collaboration-room", "founder", { room_id: room.id })).messages[0].mine, false);
  await denies(f.call("send-collaboration-message", "outsider", { room_id: room.id, message: "intrusion" }), "room_not_found");
  await denies(f.call("send-collaboration-message", "member", { room_id: room.id, message: "file", attachment_ids: ["private-object"] }), "room_attachments_unavailable");
});

test("concurrent accept/withdraw resolves once and creates at most one room", async () => {
  const f = await fixture();
  const intro = await introduce(f);
  const results = await Promise.allSettled([
    f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept", disclosure_fields: ["email"] }),
    f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept", disclosure_fields: ["email"] }),
    f.call("respond-to-introduction", "founder", { introduction_id: intro.id, action: "withdraw" })
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.code === "introduction_resolved"));
  assert.equal((await f.repository.listRecords("CollaborationRoom", f.users.admin)).length, 1);
});

test("blocking revokes live contact disclosure, prevents sending, and unblocking does not reopen rooms", async () => {
  const f = await fixture();
  const { room } = await connect(f, ["email", "private_project_summary"]);
  await f.call("block-exchange-user", "member", { target_user_id: f.users.founder.id, reason: "Stop contact" });
  const result = await f.call("get-collaboration-room", "member", { room_id: room.id });
  assert.equal(result.room.status, "suspended");
  assert.deepEqual(result.other_contact, {});
  assert.equal(result.project_need.private_summary, "");
  await denies(f.call("send-collaboration-message", "founder", { room_id: room.id, message: "should not send" }), "exchange_blocked");
  assert.equal((await f.call("find-collaboration-matches", "founder", { project_need_id: f.need.id })).match_count, 0);
  await f.call("block-exchange-user", "member", { target_user_id: f.users.founder.id, action: "unblock" });
  assert.deepEqual((await f.call("get-collaboration-room", "member", { room_id: room.id })).other_contact, {});
});

test("stale/private/suspended profiles cannot be disclosed or reactivate themselves", async () => {
  const f = await fixture();
  const memberProfile = (await f.call("get-exchange-dashboard", "member")).profile;
  await f.call("save-exchange-profile", "member", { visibility: "private" });
  assert.equal((await f.call("get-exchange-dashboard", "founder")).matches.length, 0);
  await denies(introduce(f), "collaboration_unavailable");
  await f.call("admin-review-exchange", "admin", { action: "set_profile_status", profile_id: memberProfile.id, status: "suspended" });
  await denies(f.call("save-exchange-profile", "member", { status: "active", visibility: "discoverable" }), "profile_suspended");
});

test("credential and identity spoofing fails; changing a reviewed claim revokes its badge", async () => {
  const f = await fixture();
  const saved = await f.call("save-exchange-profile", "member", { user_id: f.users.founder.id, verification_level: "organization_verified" });
  assert.equal(saved.profile.user_id, f.users.member.id);
  assert.equal(saved.profile.verification_level, "unverified");
  const { claim } = await f.call("save-credential-claim", "member", { credential_type: "React specialist", issuing_authority: "Authority", claim_summary: "Evidence to review", verification_status: "verified", user_id: f.users.founder.id });
  assert.equal(claim.user_id, f.users.member.id);
  assert.equal(claim.verification_status, "pending");
  await denies(f.call("admin-review-exchange", "member", { action: "review_credential", claim_id: claim.id, decision: "verified", verification_method: "official_registry" }), "administrator_required");
  await f.call("admin-review-exchange", "admin", { action: "review_credential", claim_id: claim.id, decision: "verified", verification_method: "official_registry" });
  assert.equal((await f.call("get-exchange-dashboard", "member")).profile.verification_level, "credential_verified");
  await f.call("save-credential-claim", "member", { claim_id: claim.id, claim_summary: "Changed evidence" });
  assert.equal((await f.call("get-exchange-dashboard", "member")).profile.verification_level, "unverified");
  await denies(f.call("save-credential-claim", "founder", { claim_id: claim.id, claim_summary: "Hijack" }), "claim_not_found");
});

test("expired introductions and mandatory credentials fail closed", async () => {
  const f = await fixture();
  const intro = await introduce(f);
  await f.repository.updateRecord("IntroductionRequest", intro.id, f.users.admin, { expires_at: "2000-01-01T00:00:00Z" });
  await denies(f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept" }), "introduction_resolved");
  assert.equal((await f.call("get-exchange-dashboard", "member")).introductions[0].status, "expired");
  await f.call("save-project-need", "founder", { need_id: f.need.id, mandatory_credentials: ["React specialist"] });
  const { claim } = await f.call("save-credential-claim", "member", { credential_type: "React specialist", issuing_authority: "Authority", claim_summary: "Evidence", expires_at: "2000-01-01" });
  await denies(f.call("admin-review-exchange", "admin", { action: "review_credential", claim_id: claim.id, decision: "verified", verification_method: "official_registry" }), "credential_expired");
  assert.equal((await f.call("find-collaboration-matches", "founder", { project_need_id: f.need.id })).match_count, 0);
});

test("ownership and administrator moderation boundaries cover all user inputs", async () => {
  const f = await fixture();
  await denies(f.call("save-project-need", "member", { need_id: f.need.id, public_summary: "Hijack" }), "need_not_found");
  await denies(f.call("find-collaboration-matches", "admin", { project_need_id: f.need.id }), "need_not_found");
  await denies(f.call("get-exchange-admin", "member"), "administrator_required");
  const { room } = await connect(f);
  await denies(f.call("report-exchange-user", "outsider", { room_id: room.id, reported_user_id: f.users.member.id, description: "An invalid room reference" }), "room_not_found");
  await denies(f.call("report-exchange-user", "founder", { room_id: room.id, reported_user_id: f.users.outsider.id, description: "An unrelated account report" }), "room_not_found");
  const { report } = await f.call("report-exchange-user", "founder", { room_id: room.id, reported_user_id: f.users.member.id, description: "A legitimate report to review", reason: "privacy_concern" });
  await f.call("admin-review-exchange", "admin", { action: "resolve_report", report_id: report.id, decision: "reviewing", admin_notes: "PRIVATE_MODERATOR_NOTES" });
  assert.equal(JSON.stringify(await f.call("get-exchange-dashboard", "founder")).includes("PRIVATE_MODERATOR_NOTES"), false);
  assert.equal((await f.call("get-exchange-admin", "admin")).open_reports[0].admin_notes, "PRIVATE_MODERATOR_NOTES");
});

test("a failed required audit rolls back consent, room, and match state", async () => {
  const f = await fixture();
  const intro = await introduce(f);
  const create = f.repository.createRecord;
  f.repository.createRecord = async function (entity, user, input) {
    if (entity === "ExchangeAuditEvent") throw new Error("audit storage unavailable");
    return create.call(this, entity, user, input);
  };
  await assert.rejects(f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept" }), /audit storage unavailable/);
  assert.equal((await f.repository.getRecord("IntroductionRequest", intro.id, f.users.admin)).status, "pending");
  assert.equal((await f.repository.getRecord("MatchRecord", f.match.id, f.users.admin)).status, "introduction_requested");
  assert.equal((await f.repository.listRecords("CollaborationRoom", f.users.admin)).length, 0);
});

test("a block-store failure cannot permit acceptance or expose contact", async () => {
  const f = await fixture();
  const intro = await introduce(f);
  const read = f.repository.listRecords;
  f.repository.listRecords = async function (entity, user, options) {
    if (entity === "ExchangeBlock") throw new Error("block storage unavailable");
    return read.call(this, entity, user, options);
  };
  await assert.rejects(f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept" }), /block storage unavailable/);
  assert.equal((await f.repository.getRecord("IntroductionRequest", intro.id, f.users.admin)).status, "pending");
});

test("local gap analysis preserves private context and is honest about its limitations", async () => {
  const f = await fixture();
  const project = await f.repository.createRecord("Project", f.users.founder, { title: "AI app", description: "Private application with Stripe checkout and AI" });
  const result = await f.call("analyze-project-needs", "founder", { project_id: project.id, founder_notes: "CONFIDENTIAL_IDEA" });
  assert.equal(result.analysis_method, "local_requirements_checklist");
  assert.equal(result.may_use_integration_credits, false);
  assert.equal(result.charged, false);
  assert.equal(result.analysis.suggested_public_summary, "");
  assert.ok(result.analysis.suggested_private_summary.includes("CONFIDENTIAL_IDEA"));
  assert.equal(result.analysis.project_stage, "");
  assert.ok(result.analysis.missing_capabilities.length > 0);
  assert.ok(result.analysis.missing_capabilities.every((item) => item.credential_or_jurisdiction === ""));
  await denies(f.call("analyze-project-needs", "member", { project_id: project.id }), "project_not_found");
});

test("memory record transactions isolate uncommitted writes and preserve unrelated concurrent changes", async () => {
  const repository = new MemoryRepository();
  const user = { id: "user", role: "user" };
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const transaction = repository.withRecordTransaction(async (tx) => {
    await tx.createRecord("CollaborationProfile", user, { user_id: user.id });
    started();
    await paused;
    throw new Error("rollback");
  });
  await began;
  assert.equal((await repository.listRecords("CollaborationProfile", user)).length, 0);
  const project = await repository.createRecord("Project", user, { title: "Concurrent project" });
  resume();
  await assert.rejects(transaction, /rollback/);
  assert.equal((await repository.getRecord("Project", project.id, user)).title, "Concurrent project");
});

test("Postgres record transaction pins operations to one client, locks, commits or rolls back", async () => {
  const queries = [];
  let releases = 0;
  const client = { query: async (sql) => { queries.push(sql); return { rows: [] }; }, release: () => { releases += 1; } };
  const pool = { connect: async () => client, query: () => assert.fail("transaction escaped its client") };
  const repository = new PostgresRepository({ pool });
  await repository.withRecordTransaction(async (tx) => { await tx.getUser("test-user"); });
  assert.equal(queries[0], "BEGIN");
  assert.ok(queries.some((query) => query.includes("pg_advisory_xact_lock")));
  assert.equal(queries.at(-1), "COMMIT");
  await assert.rejects(repository.withRecordTransaction(async () => { throw new Error("reject consent"); }), /reject consent/);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(releases, 2);
});

test("Exchange fails closed without transactions and handles only its known function names", async () => {
  assert.equal(EXCHANGE_FUNCTIONS.size, 14);
  assert.equal(await handleExchangeFunction({ name: "unrelated" }), null);
  await denies(handleExchangeFunction({ name: "get-exchange-dashboard", user: { id: "one" }, repository: {} }), "exchange_transactions_unavailable");
  await denies(handleExchangeFunction({ name: "get-exchange-dashboard" }), "authentication_required");
});

test("mandatory credentials are checked again at acceptance and current cards drop revoked badges", async () => {
  const f = await fixture();
  const { claim } = await f.call("save-credential-claim", "member", { credential_type: "React specialist", issuing_authority: "Authority", claim_summary: "Evidence to review" });
  await f.call("admin-review-exchange", "admin", { action: "review_credential", claim_id: claim.id, decision: "verified", verification_method: "official_registry" });
  await f.call("save-project-need", "founder", { need_id: f.need.id, mandatory_credentials: ["React specialist"] });
  f.match = (await f.call("find-collaboration-matches", "founder", { project_need_id: f.need.id })).matches[0];
  const intro = await introduce(f);
  await f.call("admin-review-exchange", "admin", { action: "review_credential", claim_id: claim.id, decision: "rejected", verification_method: "official_registry" });
  await denies(f.call("respond-to-introduction", "member", { introduction_id: intro.id, action: "accept" }), "match_not_eligible");
  assert.equal((await f.repository.listRecords("CollaborationRoom", f.users.admin)).length, 0);
  const dash = await f.call("get-exchange-dashboard", "founder");
  assert.equal(dash.introductions[0].recipient_snapshot.verification_level, "unverified");
  assert.deepEqual(dash.introductions[0].recipient_snapshot.verified_credentials, []);
});

test("negated free-text credentials cannot satisfy mandatory verified credential types", async () => {
  const f = await fixture();
  const { claim } = await f.call("save-credential-claim", "member", { credential_type: "Driver license", issuing_authority: "Authority", claim_summary: "This is not a professional engineer credential." });
  await f.call("admin-review-exchange", "admin", { action: "review_credential", claim_id: claim.id, decision: "verified", verification_method: "official_registry" });
  await f.call("save-project-need", "founder", { need_id: f.need.id, mandatory_credentials: ["professional engineer"] });
  assert.equal((await f.call("find-collaboration-matches", "founder", { project_need_id: f.need.id })).match_count, 0);
});

test("forged legacy ownership and room links do not expose private profiles or needs", async () => {
  const f = await fixture();
  const { room } = await connect(f, ["email", "private_project_summary"]);
  const otherNeed = await f.repository.createRecord("ProjectNeed", f.users.outsider, { owner_user_id: f.users.outsider.id, public_summary: "PRIVATE_OTHER_PROJECT", private_summary: "PRIVATE_OTHER_ROADMAP" });
  await f.repository.updateRecord("CollaborationRoom", room.id, f.users.admin, { project_need_id: otherNeed.id });
  await denies(f.call("get-collaboration-room", "founder", { room_id: room.id }), "consent_required");
  assert.equal(JSON.stringify(await f.call("get-exchange-dashboard", "founder")).includes("PRIVATE_OTHER_PROJECT"), false);
  await f.repository.createRecord("CollaborationProfile", f.users.outsider, { user_id: f.users.member.id, phone: "SPOOFED_PHONE", updated_at: "9999-01-01", status: "active" });
  assert.equal((await f.call("get-exchange-dashboard", "member")).profile.owner_id, f.users.member.id);
});

test("Postgres security lookups apply scalar predicates in SQL before LIMIT", async () => {
  let observed;
  const repository = new PostgresRepository({ pool: { query: async (sql, params) => { observed = { sql, params }; return { rows: [] }; } } });
  const attackerField = "created_at; DROP TABLE iabt_users; --";
  await repository.listRecordsExact("ExchangeBlock", { id: "admin", role: "admin" }, {
    query: { owner_id: "blocker", blocker_user_id: "blocker", blocked_user_id: "blocked", status: "active" }, sort: attackerField, limit: 1
  });
  assert.match(observed.sql, /WHERE entity_name = \$1 AND owner_id = \$2 AND payload @> \$3::jsonb/);
  assert.match(observed.sql, /ORDER BY payload ->> \$4 ASC NULLS LAST, id ASC\s+LIMIT \$5/);
  assert.equal(observed.sql.includes(attackerField), false);
  assert.equal(observed.params[3], attackerField);
  assert.equal(JSON.parse(observed.params[2]).status, "active");
  assert.equal(observed.params[4], 1);
});
