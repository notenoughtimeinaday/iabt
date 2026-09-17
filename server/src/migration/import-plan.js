import { createHash } from "node:crypto";
import { validateBase44Export } from "./base44-export.js";
import { base44SourceIdToUuid } from "./identity.js";

export const IMPORT_PASSWORD_SENTINEL = "migration:reset-required";
export const MAX_IMPORT_FILE_BYTES = 256 * 1024 * 1024;
const credentialKey = /(?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)/i;
const supportedEntities = new Set(["Project", "Asset", "CreationArtifact", "PolicyAcceptance"]);
const referenceEntities = {
  project_id: "Project", project_ids: "Project", plan_id: "CreationPlan",
  job_id: "GenerationJob", execution_job_id: "GenerationJob", artifact_id: "CreationArtifact",
  artifact_ids: "CreationArtifact", room_id: "CollaborationRoom", project_need_id: "ProjectNeed",
  introduction_request_id: "IntroductionRequest", match_id: "MatchRecord",
  candidate_profile_id: "CollaborationProfile", runbook_id: "AutomationRunbook",
  source_run_id: "AutomationRun", approval_grant_id: "ConsentGrant"
};
const sortValue = (value) => Array.isArray(value)
  ? value.map(sortValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]))
    : value;
export const importDigest = (value) => createHash("sha256")
  .update(JSON.stringify(sortValue(value))).digest("hex");
export const bytesDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

const inspectCredentials = (value, path, errors) => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (credentialKey.test(key)) errors.push({ code: "credential_field_forbidden", path: `${path}/${key}` });
    inspectCredentials(child, `${path}/${key}`, errors);
  }
};

// A plan contains private account/project data. Only summarizeImportPlan is safe
// for terminal output. Planning does not write to a database or object store.
export const prepareBase44Import = async (bundle, {
  readFileBytes,
  expectedAppId = "6a849bcd3e04d068553b4af7",
  maxFileBytes = MAX_IMPORT_FILE_BYTES
} = {}) => {
  const validation = validateBase44Export(bundle, { expectedAppId });
  const errors = [...validation.errors];
  const blockers = [];
  if (!Array.isArray(bundle?.users) || !Array.isArray(bundle?.files) ||
      !bundle?.entities || typeof bundle.entities !== "object" || Array.isArray(bundle.entities)) {
    errors.push({ code: "export_sections_required", message: "users, entities and files must be explicitly present" });
  }
  inspectCredentials(bundle, "", errors);
  if (errors.length) return { valid: false, importable: false, errors, blockers, source: validation.reconciliation };

  for (const [kind, ids] of [
    ["user", bundle.users.map((user) => user.source_user_id)],
    ["file", bundle.files.map((file) => file.source_file_id || file.id)],
    ...Object.entries(bundle.entities).map(([name, records]) => [name, records.map((record) => record.id)])
  ]) {
    if (ids.some((id) => typeof id !== "string" || id.trim() !== id)) {
      errors.push({ code: "source_id_invalid", path: kind });
    }
  }
  if (errors.length) return { valid: false, importable: false, errors, blockers, source: validation.reconciliation };

  const users = bundle.users.map((user) => ({
    id: base44SourceIdToUuid(user.source_user_id),
    source_id: user.source_user_id,
    email: user.email.trim().toLowerCase(),
    name: String(user.name || user.full_name || ""),
    // Privileges and legacy email assertions are not authentication evidence.
    role: "user", email_verified: false, password_hash: IMPORT_PASSWORD_SENTINEL
  })).sort((a, b) => a.id.localeCompare(b.id));
  const identities = new Map();
  for (const user of users) {
    for (const alias of [user.source_id, user.email]) {
      if (identities.has(alias) && identities.get(alias).id !== user.id) {
        errors.push({ code: "identity_alias_ambiguous", message: "A source ID overlaps another user's email" });
      }
      identities.set(alias, user);
    }
  }
  const resolveUser = (value) => identities.get(String(value)) || identities.get(String(value).trim().toLowerCase());
  const ownerFor = (record, path) => {
    const explicit = [record.owner_id, record.user_id].filter(Boolean);
    const candidates = explicit.length ? explicit : [record.created_by || record.user_email].filter(Boolean);
    const owners = candidates.map(resolveUser);
    if (!owners.length || owners.some((owner) => !owner)) {
      errors.push({ code: "owner_unmapped", path });
      return null;
    }
    if (new Set(owners.map((owner) => owner.id)).size !== 1) {
      errors.push({ code: "owner_ambiguous", path });
      return null;
    }
    return owners[0].id;
  };
  const entityIds = new Map(Object.entries(bundle.entities).map(([name, records]) => [
    name, new Map(records.map((record) => [String(record.id), base44SourceIdToUuid(record.id)]))
  ]));
  const entityOwners = new Map(Object.entries(bundle.entities).map(([name, records]) => [
    name, new Map(records.map((record, index) => [String(record.id), ownerFor(record, `entities/${name}/${index}`)]))
  ]));
  const files = [];
  const fileAliases = new Map();
  for (const [index, source] of bundle.files.entries()) {
    const path = `files/${index}`;
    const id = base44SourceIdToUuid(source.source_file_id || source.id);
    const file = {
      id, source_id: String(source.source_file_id || source.id),
      owner_id: ownerFor(source, path), original_name: String(source.filename || "download"),
      content_type: String(source.content_type || source.mime_type || "application/octet-stream"),
      size_bytes: Number(source.size_bytes), sha256: source.sha256.toLowerCase(),
      local_path: source.local_path
    };
    if (typeof file.local_path !== "string" || !file.local_path) {
      errors.push({ code: "file_bytes_missing", path });
    } else if (file.size_bytes > maxFileBytes) {
      errors.push({ code: "file_too_large", path });
    } else if (typeof readFileBytes !== "function") {
      errors.push({ code: "file_reader_required", path });
    } else {
      try {
        const bytes = await readFileBytes(source, { maxBytes: maxFileBytes });
        if (!(bytes instanceof Uint8Array)) fail("file_bytes_invalid", "File reader must return bytes");
        if (bytes.byteLength !== file.size_bytes) fail("file_size_mismatch", "File byte count differs from manifest");
        if (bytesDigest(bytes) !== file.sha256) fail("file_hash_mismatch", "File SHA-256 differs from manifest");
      } catch (error) {
        errors.push({ code: error.code || "file_bytes_unreadable", path });
      }
    }
    for (const alias of [file.source_id, source.source_uri, source.source_url].filter(Boolean)) {
      if (fileAliases.has(alias) && fileAliases.get(alias).id !== file.id) {
        errors.push({ code: "file_alias_ambiguous", path });
      }
      fileAliases.set(alias, file);
    }
    files.push(file);
  }

  const rewrite = (value, ownerId, path, key = "") => {
    if (Array.isArray(value)) return value.map((child, index) => rewrite(child, ownerId, `${path}/${index}`, key));
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([field, child]) => [field, rewrite(child, ownerId, `${path}/${field}`, field)])
    );
    if (value == null || value === "") return value;
    if (key === "user_id" || key.endsWith("_user_id") || key === "owner_id") {
      const user = resolveUser(value);
      if (!user) errors.push({ code: "user_reference_unmapped", path });
      return user?.id || value;
    }
    if (referenceEntities[key]) {
      const target = entityIds.get(referenceEntities[key])?.get(String(value));
      if (!target) errors.push({ code: "entity_reference_unmapped", path, target_entity: referenceEntities[key] });
      else if (supportedEntities.has(referenceEntities[key]) &&
               entityOwners.get(referenceEntities[key])?.get(String(value)) !== ownerId) {
        errors.push({ code: "entity_reference_owner_mismatch", path, target_entity: referenceEntities[key] });
      }
      return target || value;
    }
    if (key === "conversation_id") {
      blockers.push({ code: "conversation_migration_required", path });
      return value;
    }
    if (["file_uri", "file_url", "attachment_ids", "file_id"].includes(key)) {
      const file = fileAliases.get(value);
      if (!file) errors.push({ code: "file_reference_unmapped", path });
      else if (file.owner_id !== ownerId) errors.push({ code: "file_owner_mismatch", path });
      return file ? (key.endsWith("id") || key.endsWith("ids") ? file.id : `iabt-file:${file.id}`) : value;
    }
    return value;
  };
  const entities = [];
  for (const [entityName, records] of Object.entries(bundle.entities)) {
    if (records.length && !supportedEntities.has(entityName)) {
      blockers.push({ code: "runtime_conversion_required", entity_name: entityName, record_count: records.length });
    }
    for (const [index, record] of records.entries()) {
      const path = `entities/${entityName}/${index}`;
      const ownerId = entityOwners.get(entityName).get(String(record.id));
      const { id, owner_id: _ownerId, created_date, updated_date, ...payload } = record;
      const createdAt = created_date || bundle.exported_at;
      const updatedAt = updated_date || createdAt;
      if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
        errors.push({ code: "record_timestamp_invalid", path });
      }
      entities.push({
        entity_name: entityName, id: base44SourceIdToUuid(id), source_id: id,
        owner_id: ownerId, payload: rewrite(payload, ownerId, path),
        created_at: createdAt, updated_at: updatedAt
      });
    }
  }
  entities.sort((a, b) => `${a.entity_name}:${a.id}`.localeCompare(`${b.entity_name}:${b.id}`));
  files.sort((a, b) => a.id.localeCompare(b.id));
  const data = { version: 1, source: validation.reconciliation, users, entities, files };
  return {
    ...data, valid: errors.length === 0, importable: errors.length === 0 && blockers.length === 0,
    errors, blockers, digest: importDigest(data)
  };
};

export const summarizeImportPlan = (plan) => ({
  valid: plan.valid, importable: plan.importable, digest: plan.digest || null,
  // Messages from the legacy validator can contain emails; report codes only.
  errors: plan.errors.map(({ code, path }) => ({ code, ...(path ? { path } : {}) })),
  blockers: plan.blockers,
  counts: plan.source ? {
    users: plan.source.user_count, entities: plan.source.entity_record_count,
    files: plan.source.file_count, file_bytes: plan.source.total_file_bytes
  } : null,
  account_policy: "All imported accounts require email recovery; admin privileges are not copied",
  mutation_performed: false
});

export const assertReviewedImportPlan = (plan, expectedDigest) => {
  if (!plan?.importable) fail("import_plan_blocked", "Import plan has unresolved errors or runtime conversions");
  const { version, source, users, entities, files } = plan;
  const digest = importDigest({ version, source, users, entities, files });
  if (!expectedDigest || digest !== expectedDigest || digest !== plan.digest) {
    fail("import_plan_digest_mismatch", "Use the exact digest from the reviewed dry run");
  }
  return digest;
};
