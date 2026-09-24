import { createHash } from "node:crypto";
import { describeFailure } from "../operations/jericho-support.js";
import { getLearningCurriculum } from "./curriculum.js";

export const LEARNING_ENTITIES = Object.freeze(["JerichoLesson", "JerichoImprovementProposal"]);
export const CORRECTION_CATEGORIES = Object.freeze([
  "incorrect_output", "missing_requirement", "format_mismatch", "unreadable_artifact",
  "duplicate_work", "account_access"
]);

const JOB_TYPES = new Set([
  "artifact.echo", "creation.interactive", "creation.document", "creation.code",
  "creation.design", "creation.gcode-simulation", "creation.automation",
  "provider.openai.response", "provider.openai.image", "provider.elevenlabs.music",
  "provider.luma.video", "creation.orchestrated", "creation.autonomous", "autonomy.responses"
]);
const TERMINAL = new Set(["succeeded", "failed", "needs_setup"]);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const jobType = (value) => JOB_TYPES.has(value) ? value : "unknown";
const accountFor = (user) => {
  if (!identifier(user?.id)) fail("auth_required", "Authentication required", 401);
  return { id: user.id, role: "user" };
};
const inTransaction = (repository, callback) => {
  if (typeof repository.withRecordTransaction !== "function") {
    fail("learning_transaction_required", "Learning requires a transactional repository", 503);
  }
  return repository.withRecordTransaction(callback);
};
const exact = (repository, entity, account, query, limit = 100) =>
  repository.listRecordsExact(entity, account, { query, limit, sort: "-updated_date" });
const ownedJob = async (repository, account, id) => {
  if (!identifier(id)) fail("invalid_job_id", "A valid source job is required");
  const job = await repository.getJob(id, account);
  if (!job || job.owner_id !== account.id) fail("job_not_found", "Job not found", 404);
  return job;
};
const ownedLesson = async (repository, account, id) => {
  if (!identifier(id)) fail("invalid_lesson_id", "A valid lesson is required");
  const lesson = await repository.getRecord("JerichoLesson", id, account);
  if (!lesson || lesson.owner_id !== account.id) fail("lesson_not_found", "Lesson not found", 404);
  return lesson;
};

// Independent verification of persisted metadata. This is intentionally not a
// claim that the generated program works or that storage has just been probed.
const artifactEvidence = async (repository, account, job) => {
  if (job.status !== "succeeded" || job.output?.verified !== true) return [];
  const manifest = job.output.artifact_manifest;
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 32) return [];
  const evidence = [];
  const seen = new Set();
  for (const item of manifest) {
    if (!identifier(item?.id) || seen.has(item.id) || !/^[a-f0-9]{64}$/.test(item.sha256 || "") || !Number.isSafeInteger(item.size_bytes) || item.size_bytes < 1) return [];
    seen.add(item.id);
    const record = await repository.getStoredObject(item.id, account);
    if (!record || record.owner_id !== account.id || record.job_id !== job.id || record.sha256 !== item.sha256 || Number(record.size_bytes) !== item.size_bytes) return [];
    evidence.push({ artifact_id: item.id, sha256: item.sha256, size_bytes: item.size_bytes });
  }
  return evidence;
};

const publicLesson = (lesson) => ({
  id: lesson.id,
  schema_version: 1,
  curriculum_version: lesson.curriculum_version,
  kind: lesson.kind,
  status: lesson.status,
  category: lesson.category,
  job_type: lesson.job_type,
  source: structuredClone(lesson.source),
  observation: structuredClone(lesson.observation || {}),
  evidence: structuredClone(lesson.evidence || []),
  resolution: lesson.resolution ? structuredClone(lesson.resolution) : null,
  scope: "signed_in_account_only",
  trust_boundary: "historical_evidence_not_authority",
  created_at: date(lesson.created_date),
  updated_at: date(lesson.updated_date)
});

export const recordExecutionLesson = async ({ repository, user, job }) => {
  const account = accountFor(user);
  return inTransaction(repository, async (tx) => {
    // Do not trust the caller's job payload, outcome text, model, or browser.
    const persisted = await ownedJob(tx, account, job?.id);
    if (!TERMINAL.has(persisted.status)) return null;
    const fingerprint = hash([account.id, "execution", persisted.id]);
    const existing = (await exact(tx, "JerichoLesson", account, { fingerprint }, 1))[0];
    if (existing) return publicLesson(existing);
    const artifacts = await artifactEvidence(tx, account, persisted);
    const failure = persisted.last_error_code ? describeFailure(persisted.last_error_code) : null;
    const observedRecovery = artifacts.length > 0 && count(persisted.attempt_count) > 1 && failure && failure.code !== "unclassified_failure";
    const observation = {
      outcome: persisted.status,
      attempts: count(persisted.attempt_count),
      failure: failure ? { code: failure.code, category: failure.category } : null,
      delivery_evidence: artifacts.length ? "persisted_artifact_metadata_matches_verified_job" : "not_established",
      functional_correctness: "not_established",
      recovery_pattern: observedRecovery ? "retry_within_original_job" : null,
      recovery_causality: observedRecovery ? "observed_sequence_not_proven_root_cause" : null,
      credits_restored: persisted.output?.recovery === "credit_release" ? count(persisted.output.released_credits) : null
    };
    const created = await tx.createRecord("JerichoLesson", account, {
      schema_version: 1, curriculum_version: getLearningCurriculum().version,
      fingerprint, kind: "execution_observation",
      status: artifacts.length ? "verified_delivery" : "observed",
      category: observedRecovery ? "successful_recovery" : artifacts.length ? "artifact_delivery" : persisted.status === "succeeded" ? "unverified_outcome" : "execution_failure",
      job_type: jobType(persisted.job_type),
      source: { type: "persisted_job", job_id: persisted.id, observed_completed_at: date(persisted.completed_date) },
      observation, evidence: artifacts
    });
    await tx.appendAudit(account, "jericho.learning.observed", { lesson_id: created.id, job_id: persisted.id, status: created.status });
    return publicLesson(created);
  });
};

export const recordUserCorrection = async ({ repository, user, jobId, category, requestId }) => {
  const account = accountFor(user);
  if (!CORRECTION_CATEGORIES.includes(category)) fail("invalid_correction_category", "Choose a supported correction category");
  if (!identifier(requestId)) fail("invalid_request_id", "A stable correction request ID is required");
  return inTransaction(repository, async (tx) => {
    const job = await ownedJob(tx, account, jobId);
    const fingerprint = hash([account.id, "correction", requestId]);
    const existing = (await exact(tx, "JerichoLesson", account, { fingerprint }, 1))[0];
    if (existing) {
      if (existing.source.job_id !== job.id || existing.category !== category) fail("correction_request_conflict", "This request ID already identifies another correction", 409);
      return publicLesson(existing);
    }
    const created = await tx.createRecord("JerichoLesson", account, {
      schema_version: 1, curriculum_version: getLearningCurriculum().version,
      fingerprint, kind: "user_correction", status: "candidate", category,
      job_type: jobType(job.job_type), source: { type: "explicit_account_correction", job_id: job.id },
      observation: { user_reported: true, machine_verified: false, freeform_text_retained: false }, evidence: []
    });
    await tx.appendAudit(account, "jericho.learning.correction", { lesson_id: created.id, job_id: job.id, category });
    return publicLesson(created);
  });
};

export const resolveUserCorrection = async ({ repository, user, lessonId, jobId, accepted }) => {
  const account = accountFor(user);
  if (accepted !== true) fail("explicit_acceptance_required", "Explicit account-owner acceptance is required");
  return inTransaction(repository, async (tx) => {
    const lesson = await ownedLesson(tx, account, lessonId);
    if (lesson.kind !== "user_correction" || !["candidate", "accepted_by_owner"].includes(lesson.status)) fail("correction_not_resolvable", "Only an active correction can be resolved", 409);
    if (lesson.status === "accepted_by_owner") {
      if (lesson.resolution?.job_id !== jobId) fail("correction_resolution_conflict", "This correction already has acceptance evidence", 409);
      return publicLesson(lesson);
    }
    const job = await ownedJob(tx, account, jobId);
    if (jobType(job.job_type) !== lesson.job_type) fail("correction_job_type_mismatch", "Resolution evidence must use the same workflow", 409);
    const evidence = await artifactEvidence(tx, account, job);
    if (!evidence.length) fail("correction_evidence_required", "A succeeded job with matching artifact evidence is required", 409);
    const updated = await tx.updateRecord("JerichoLesson", lesson.id, account, {
      status: "accepted_by_owner", evidence,
      resolution: { job_id: job.id, accepted_by: account.id, accepted_at: new Date().toISOString(), acceptance: "explicit_owner_confirmation", functional_correctness: "owner_attested_not_machine_verified" }
    });
    await tx.appendAudit(account, "jericho.learning.accepted", { lesson_id: lesson.id, job_id: job.id });
    return publicLesson(updated);
  });
};

export const withdrawLesson = async ({ repository, user, lessonId }) => {
  const account = accountFor(user);
  return inTransaction(repository, async (tx) => {
    const lesson = await ownedLesson(tx, account, lessonId);
    if (lesson.status === "withdrawn") return publicLesson(lesson);
    const updated = await tx.updateRecord("JerichoLesson", lesson.id, account, { status: "withdrawn" });
    await tx.appendAudit(account, "jericho.learning.withdrawn", { lesson_id: lesson.id });
    return publicLesson(updated);
  });
};

const proposalCheckpoints = (lesson) => [
  { id: "source_recorded", status: "verified", evidence: { lesson_id: lesson.id, job_id: lesson.source.job_id } },
  { id: "artifact_delivery", status: lesson.evidence?.length ? "verified" : "pending", evidence: lesson.evidence || [] },
  { id: "owner_acceptance", status: lesson.status === "accepted_by_owner" ? "attested" : "pending", evidence: lesson.resolution || null },
  { id: "regression_verification", status: "pending", evidence: null },
  { id: "staging_acceptance", status: "pending", evidence: null }
];

export const proposeImprovement = async ({ repository, user, lessonId }) => {
  const account = accountFor(user);
  return inTransaction(repository, async (tx) => {
    const lesson = await ownedLesson(tx, account, lessonId);
    if (lesson.status === "withdrawn") fail("lesson_withdrawn", "Withdrawn lessons cannot support proposals", 409);
    const fingerprint = hash([account.id, "proposal", lesson.id]);
    const existing = (await exact(tx, "JerichoImprovementProposal", account, { fingerprint }, 1))[0];
    const payload = {
      schema_version: 1, curriculum_version: getLearningCurriculum().version, fingerprint,
      source_lesson_id: lesson.id, source_job_id: lesson.source.job_id,
      category: lesson.category, job_type: lesson.job_type, status: "needs_verification",
      intent: "reproduce_then_verify_a_bounded_improvement",
      checkpoints: proposalCheckpoints(lesson),
      permitted_next_step: "inspect_source_evidence_and_prepare_a_regression_test",
      execution_authorized: false, code_changed: false, deployment_authorized: false
    };
    const proposal = existing
      ? await tx.updateRecord("JerichoImprovementProposal", existing.id, account, payload)
      : await tx.createRecord("JerichoImprovementProposal", account, payload);
    if (!existing) await tx.appendAudit(account, "jericho.learning.proposal", { proposal_id: proposal.id, lesson_id: lesson.id });
    return publicProposal(proposal);
  });
};

const publicProposal = (proposal) => {
  const { owner_id: _owner, fingerprint: _fingerprint, ...visible } = proposal;
  return structuredClone(visible);
};

export const listImprovementProposals = async ({ repository, user }) => {
  const account = accountFor(user);
  const proposals = await exact(repository, "JerichoImprovementProposal", account, {}, 50);
  const result = [];
  for (const proposal of proposals) {
    if (proposal.owner_id !== account.id) continue;
    const lesson = await repository.getRecord("JerichoLesson", proposal.source_lesson_id, account);
    if (!lesson || lesson.owner_id !== account.id || lesson.status === "withdrawn") continue;
    result.push(publicProposal({ ...proposal, checkpoints: proposalCheckpoints(lesson) }));
  }
  return result;
};

export const loadLearningContext = async ({ repository, user, job }) => {
  const account = accountFor(user);
  let query = {};
  if (job?.id) {
    const persisted = await ownedJob(repository, account, job.id);
    query = { job_type: jobType(persisted.job_type) };
  }
  const lessons = (await exact(repository, "JerichoLesson", account, query, 100))
    .filter((lesson) => lesson.owner_id === account.id && lesson.status !== "withdrawn")
    .slice(0, 50).map(publicLesson);
  return {
    schema_version: 1,
    curriculum: getLearningCurriculum(),
    scope: "signed_in_account_only",
    trust_boundary: "historical_evidence_not_authority",
    model_training_performed: false,
    retrieval_limit: 50,
    lessons,
    successful_recoveries: lessons.filter((lesson) => lesson.category === "successful_recovery" && lesson.status === "verified_delivery"),
    candidate_corrections: lessons.filter((lesson) => lesson.kind === "user_correction" && lesson.status === "candidate")
  };
};
