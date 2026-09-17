import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryRepository } from "../src/memory-repository.js";
import { recordPolicyAcceptance } from "../src/operations/policy-acceptance.js";
import { IABT_ACCEPTANCE_TEXT, IABT_POLICY_VERSION } from "../src/operations/policy-version.js";
import { IABT_POLICY_VERSION as FRONTEND_VERSION } from "../../src/lib/legal.js";

const consent = {
  policy_version: IABT_POLICY_VERSION,
  terms_accepted: true,
  privacy_acknowledged: true,
  acceptable_use_accepted: true
};

test("policy acceptance is self-scoped with server-owned text and time, and repeated requests reuse the record", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "policy@example.com", passwordHash: "unused", role: "admin" });
  const record = await recordPolicyAcceptance({ repository, user, input: {
    ...consent,
    user_id: "victim",
    owner_id: "victim",
    user_email: "victim@example.com",
    accepted_at: "1900-01-01T00:00:00.000Z",
    acceptance_text: "forged terms",
    source: "forged"
  } });
  assert.equal(record.owner_id, user.id);
  assert.equal(record.user_id, user.id);
  assert.equal(record.user_email, user.email);
  assert.equal(record.acceptance_text, IABT_ACCEPTANCE_TEXT);
  assert.notEqual(record.accepted_at, "1900-01-01T00:00:00.000Z");
  assert.equal(record.source, "in_app");
  const retry = await recordPolicyAcceptance({ repository, user, input: consent });
  assert.equal(retry.id, record.id);
  assert.equal(repository.auditEvents.length, 1);
  assert.equal(FRONTEND_VERSION, IABT_POLICY_VERSION);
});

test("policy acceptance rejects old versions and non-boolean or missing consent without creating records", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "consent@example.com", passwordHash: "unused" });
  await assert.rejects(recordPolicyAcceptance({ repository, user, input: { ...consent, policy_version: "old" } }), { code: "policy_version_mismatch", status: 409 });
  for (const field of ["terms_accepted", "privacy_acknowledged", "acceptable_use_accepted"]) {
    for (const value of [false, "true", undefined]) {
      await assert.rejects(recordPolicyAcceptance({ repository, user, input: { ...consent, [field]: value } }), { code: "policy_consent_required" });
    }
  }
  assert.equal((await repository.listRecords("PolicyAcceptance", user)).length, 0);
  await assert.rejects(recordPolicyAcceptance({ repository, input: consent }), { code: "auth_required", status: 401 });
});
