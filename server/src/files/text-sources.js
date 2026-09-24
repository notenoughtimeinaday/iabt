import { createHash } from "node:crypto";
import { extname } from "node:path";
import { classifyFailure } from "../autonomy/recovery.js";

// Storage accepts opaque uploads, but source review is deliberately narrower.
// These fixed ceilings also apply at approval and worker execution.
export const SOURCE_LIMITS = Object.freeze({ files: 12, fileBytes: 128 * 1024, totalBytes: 256 * 1024, fileLines: 2000, totalLines: 4000 });
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".tsv",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".html", ".css",
  ".java", ".c", ".h", ".cpp", ".hpp", ".go", ".rs", ".rb", ".php",
  ".sh", ".bash", ".sql", ".yaml", ".yml", ".xml", ".toml"
]);
const fail = (status, code, message) => {
  throw Object.assign(new Error(message), { status, code });
};

export const normalizeFileIds = (value = []) => {
  if (!Array.isArray(value) || value.length > SOURCE_LIMITS.files ||
      value.some((id) => typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) {
    fail(400, "invalid_file_ids", "Attach at most 12 saved files using their file IDs.");
  }
  return [...new Set(value)];
};

export const fileIdsFromRequest = (input) => {
  const ids = normalizeFileIds(input.file_ids);
  const legacyContexts = [input, input.context, ...(Array.isArray(input.custom_context) ? input.custom_context.map((item) => item?.data) : [])];
  const hasLegacyAttachments = legacyContexts.some((context) =>
    [context?.uploaded_assets, context?.uploaded_asset_ids].some((value) => Array.isArray(value) && value.length));
  if (!ids.length && hasLegacyAttachments) {
    fail(400, "source_file_ids_required", "These attachments do not include durable file IDs. Attach the files again before requesting source review.");
  }
  return ids;
};

export const sourceReferences = (sources) => sources.map(({ reference }) => reference);

// This stable projection is shared by quote signing and execution checks.
export const referenceBinding = (references = []) => references.map((reference) => [
  reference.file_id, reference.name, reference.mime_type, reference.size_bytes, reference.sha256
]);

export const readTextSources = async ({ repository, storage, user, fileIds, expectedReferences }) => {
  const ids = normalizeFileIds(fileIds);
  if (!ids.length) {
    if (expectedReferences?.length) fail(409, "source_changed", "The approved file references have changed. Request a new plan.");
    return [];
  }
  if (!user?.id) fail(401, "auth_required", "Sign in to read attached files.");
  if (!storage?.read) fail(503, "source_storage_not_configured", "Private file reading is not configured.");
  // Administrative authority never makes somebody else's upload a chat source.
  const actor = { ...user, role: "user" };
  const records = [];
  let totalBytes = 0;
  for (const id of ids) {
    const record = await repository.getStoredObject(id, actor);
    if (!record || record.owner_id !== user.id) fail(404, "source_not_found", "An attached file was not found in your account.");
    if (record.storage_provider !== storage.kind) fail(409, "source_storage_mismatch", "An attached file requires its original storage adapter.");
    if (!TEXT_EXTENSIONS.has(extname(record.original_name || "").toLowerCase())) {
      fail(415, "source_type_unsupported", "Source review supports UTF-8 text, Markdown, JSON, CSV, and common code files. PDF, Office, archives, and media are not parsed yet.");
    }
    const size = Number(record.size_bytes);
    if (!Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{64}$/.test(record.sha256 || "")) {
      fail(409, "source_integrity_failed", "An attached file has invalid integrity metadata. Upload it again.");
    }
    totalBytes += size;
    if (size > SOURCE_LIMITS.fileBytes || totalBytes > SOURCE_LIMITS.totalBytes) {
      fail(413, "source_too_large", "Source review allows 128 KiB per file and 256 KiB across all attached files.");
    }
    records.push(record);
  }

  const sources = [];
  let totalLines = 0;
  for (const record of records) {
    let bytes;
    try {
      bytes = await storage.read(record.storage_key, { maxBytes: SOURCE_LIMITS.fileBytes });
    } catch (error) {
      if (error.code === "source_too_large") throw error;
      const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
      const unavailablePermanently = [401, 403, 404].includes(status) ||
        ["ENOENT", "EACCES", "EPERM", "NoSuchKey", "NoSuchBucket", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"].includes(error?.code || error?.name);
      // Preserve only the retry classification, never a provider body, path,
      // signed URL or credentials in the safe public error. Known missing or
      // denied sources still fail immediately; temporary transport/service
      // failures retain the original job and its bounded retry reservation.
      const retryable = !unavailablePermanently && (classifyFailure(error).retryable ||
        error?.$retryable?.throttling === true || status === 429 || (status >= 500 && status <= 599));
      throw Object.assign(new Error(retryable
        ? "An attached file is temporarily unavailable in private storage. Try again after the service recovers."
        : "An attached file could not be read from private storage. Upload it again or try later."), {
        status: retryable ? 503 : 409, code: "source_unavailable", retryable
      });
    }
    if (!Buffer.isBuffer(bytes) || bytes.length !== Number(record.size_bytes) ||
        createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
      fail(409, "source_integrity_failed", "An attached file no longer matches its stored size and checksum. Upload it again.");
    }
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { fail(415, "source_not_utf8", "An attached file is not valid UTF-8 text. Export it as UTF-8 before source review."); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
      fail(415, "source_binary_content", "An attached file contains binary control characters. Source review accepts text only.");
    }
    if (!text.trim()) fail(400, "source_empty_text", "An attached file contains no readable text.");
    text = text.replace(/\r\n?/g, "\n");
    const lineCount = text.split("\n").length;
    totalLines += lineCount;
    if (lineCount > SOURCE_LIMITS.fileLines || totalLines > SOURCE_LIMITS.totalLines) {
      fail(413, "source_too_many_lines", "Source review allows 2,000 lines per file and 4,000 lines total. Attach a smaller excerpt.");
    }
    sources.push({
      reference: {
        file_id: record.id,
        name: record.original_name,
        mime_type: record.content_type,
        size_bytes: Number(record.size_bytes),
        sha256: record.sha256
      },
      text
    });
  }
  if (expectedReferences && JSON.stringify(referenceBinding(sourceReferences(sources))) !== JSON.stringify(referenceBinding(expectedReferences))) {
    fail(409, "source_changed", "The approved file references have changed. Request a new plan.");
  }
  return sources;
};
