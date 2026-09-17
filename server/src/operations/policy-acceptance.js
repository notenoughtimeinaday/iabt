import { IABT_ACCEPTANCE_TEXT, IABT_POLICY_VERSION } from "./policy-version.js";

const invalid = (code, message, status = 400) =>
  Object.assign(new Error(message), { code, status });

export const recordPolicyAcceptance = async ({ repository, user, input = {} }) => {
  if (!user?.id) throw invalid("auth_required", "Authentication required", 401);
  if (input.policy_version !== IABT_POLICY_VERSION) {
    throw invalid("policy_version_mismatch", "Review the current policy version before accepting", 409);
  }
  if (
    input.terms_accepted !== true ||
    input.privacy_acknowledged !== true ||
    input.acceptable_use_accepted !== true
  ) {
    throw invalid("policy_consent_required", "Explicit agreement to each current policy is required");
  }
  // An administrator accepts for their own account too. Never trust body identity,
  // timestamps, acceptance text, source, or ownership fields.
  const existing = await repository.listRecords("PolicyAcceptance", { ...user, role: "user" }, {
    query: { owner_id: user.id, user_id: user.id, policy_version: IABT_POLICY_VERSION },
    sort: "-accepted_at",
    limit: 1
  });
  const accepted = existing[0];
  if (accepted?.terms_accepted && accepted?.privacy_acknowledged && accepted?.acceptable_use_accepted) {
    return accepted;
  }
  const record = await repository.createRecord("PolicyAcceptance", user, {
    user_id: user.id,
    user_email: user.email,
    policy_version: IABT_POLICY_VERSION,
    terms_accepted: true,
    privacy_acknowledged: true,
    acceptable_use_accepted: true,
    acceptance_text: IABT_ACCEPTANCE_TEXT,
    accepted_at: new Date().toISOString(),
    source: "in_app"
  });
  await repository.appendAudit(user, "policy.accepted", {
    record_id: record.id,
    policy_version: IABT_POLICY_VERSION
  });
  return record;
};
