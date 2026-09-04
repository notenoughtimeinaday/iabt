import { createHash } from "node:crypto";

const unsafeKey = /(?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)/i;

const walkKeys = (value, path = "", findings = []) => {
  if (!value || typeof value !== "object") return findings;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, path + "[" + index + "]", findings));
    return findings;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? path + "." + key : key;
    if (unsafeKey.test(key)) findings.push(childPath);
    walkKeys(child, childPath, findings);
  }
  return findings;
};

const sortedDigest = (values) =>
  createHash("sha256")
    .update([...values].sort().join("\n"))
    .digest("hex");

const error = (code, message) => ({ code, message });

export const validateBase44Export = (input, {
  expectedAppId = "6a849bcd3e04d068553b4af7"
} = {}) => {
  const errors = [];
  const warnings = [];
  const bundle = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (bundle.schema_version !== 1) {
    errors.push(error("schema_version_invalid", "schema_version must be 1"));
  }
  if (String(bundle.source_app_id || "") !== expectedAppId) {
    errors.push(error("source_app_mismatch", "source_app_id does not match the IABT Base44 app"));
  }
  if (!Number.isFinite(Date.parse(String(bundle.exported_at || "")))) {
    errors.push(error("export_timestamp_invalid", "exported_at must be an ISO timestamp"));
  }

  const users = Array.isArray(bundle.users) ? bundle.users : [];
  const userIds = new Set();
  const emails = new Set();
  for (const [index, user] of users.entries()) {
    const id = String(user?.source_user_id || "");
    const email = String(user?.email || "").trim().toLowerCase();
    if (!id) errors.push(error("user_id_missing", "users[" + index + "] is missing source_user_id"));
    else if (userIds.has(id)) errors.push(error("user_id_duplicate", "Duplicate source user ID: " + id));
    else userIds.add(id);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      errors.push(error("user_email_invalid", "users[" + index + "] has an invalid email"));
    } else if (emails.has(email)) {
      errors.push(error("user_email_duplicate", "Duplicate user email: " + email));
    } else {
      emails.add(email);
    }
  }

  const entities =
    bundle.entities && typeof bundle.entities === "object" && !Array.isArray(bundle.entities)
      ? bundle.entities
      : {};
  const recordKeys = [];
  const entityCounts = {};
  for (const [entityName, recordsValue] of Object.entries(entities)) {
    const records = Array.isArray(recordsValue) ? recordsValue : [];
    if (!Array.isArray(recordsValue)) {
      errors.push(error("entity_records_invalid", entityName + " must be an array"));
    }
    entityCounts[entityName] = records.length;
    const ids = new Set();
    for (const [index, record] of records.entries()) {
      const id = String(record?.id || "");
      const ownerId = String(record?.owner_id || record?.created_by || "");
      if (!id) errors.push(error("record_id_missing", entityName + "[" + index + "] is missing id"));
      else if (ids.has(id)) errors.push(error("record_id_duplicate", entityName + " has duplicate id " + id));
      else {
        ids.add(id);
        recordKeys.push(entityName + ":" + id);
      }
      if (!ownerId) {
        warnings.push(error("record_owner_missing", entityName + "[" + index + "] has no owner mapping"));
      } else if (!userIds.has(ownerId)) {
        warnings.push(error("record_owner_unmapped", entityName + ":" + id + " owner is not in users"));
      }
      const unsafe = walkKeys(record, entityName + "[" + index + "]");
      for (const path of unsafe) {
        errors.push(error("credential_field_forbidden", "Unsafe credential field found at " + path));
      }
    }
  }

  const files = Array.isArray(bundle.files) ? bundle.files : [];
  const fileIds = new Set();
  const fileKeys = [];
  let totalFileBytes = 0;
  for (const [index, file] of files.entries()) {
    const id = String(file?.source_file_id || file?.id || "");
    const ownerId = String(file?.owner_id || "");
    const sha256 = String(file?.sha256 || "").toLowerCase();
    const size = Number(file?.size_bytes);
    if (!id) errors.push(error("file_id_missing", "files[" + index + "] is missing source_file_id"));
    else if (fileIds.has(id)) errors.push(error("file_id_duplicate", "Duplicate source file ID: " + id));
    else {
      fileIds.add(id);
      fileKeys.push(id);
    }
    if (ownerId && !userIds.has(ownerId)) {
      warnings.push(error("file_owner_unmapped", "File " + id + " owner is not in users"));
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      errors.push(error("file_sha256_invalid", "File " + id + " is missing a valid SHA-256"));
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      errors.push(error("file_size_invalid", "File " + id + " has an invalid size_bytes"));
    } else {
      totalFileBytes += size;
    }
  }

  const declared = bundle.counts || {};
  if (declared.users != null && Number(declared.users) !== users.length) {
    errors.push(error("user_count_mismatch", "Declared user count does not match users array"));
  }
  if (declared.files != null && Number(declared.files) !== files.length) {
    errors.push(error("file_count_mismatch", "Declared file count does not match files array"));
  }
  if (declared.entities && typeof declared.entities === "object") {
    for (const [name, count] of Object.entries(declared.entities)) {
      if (Number(count) !== Number(entityCounts[name] || 0)) {
        errors.push(error("entity_count_mismatch", "Declared count does not match entity " + name));
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reconciliation: {
      source_app_id: String(bundle.source_app_id || ""),
      exported_at: String(bundle.exported_at || ""),
      user_count: users.length,
      entity_counts: entityCounts,
      entity_record_count: Object.values(entityCounts).reduce((sum, count) => sum + count, 0),
      file_count: files.length,
      total_file_bytes: totalFileBytes,
      user_identity_digest: sortedDigest(userIds),
      entity_identity_digest: sortedDigest(recordKeys),
      file_identity_digest: sortedDigest(fileKeys)
    }
  };
};
