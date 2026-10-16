import { createHash } from "node:crypto";

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const types = new Set(["text/markdown", "text/x-markdown", "text/plain", "text/csv", "application/json"]);
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

// Read-only, owner-scoped display. This does not parse Office files or execute
// source, and administrator access is deliberately narrowed to own files.
export async function readStoredTextPreview({ repository, storage, user, fileId }) {
  if (!user?.id) fail(401, "auth_required", "Sign in to read your file.");
  if (typeof fileId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(fileId)) fail(400, "invalid_file_id", "Choose a saved file to preview.");
  const record = await repository.getStoredObject(fileId, { ...user, role: "user" });
  if (!record || record.owner_id !== user.id) fail(404, "file_not_found", "This file was not found in your account.");
  const mime = String(record.content_type || "").split(";")[0].trim().toLowerCase();
  if (!types.has(mime)) fail(415, "preview_type_unsupported", "Download this file to open it in its usual application.");
  const size = Number(record.size_bytes);
  if (!Number.isSafeInteger(size) || size < 0 || !/^[a-f0-9]{64}$/.test(record.sha256 || "")) fail(409, "preview_integrity_failed", "This file could not be verified. Your original remains saved.");
  if (size > TEXT_PREVIEW_MAX_BYTES) fail(413, "preview_too_large", "This file is too large for the reading view. Download the complete file instead.");
  if (!storage?.read || record.storage_provider !== storage.kind) fail(503, "preview_unavailable", "The reading view is temporarily unavailable. Try again later.");
  let bytes;
  try { bytes = await storage.read(record.storage_key, { maxBytes: TEXT_PREVIEW_MAX_BYTES }); }
  catch { fail(503, "preview_unavailable", "The reading view is temporarily unavailable. Try again later."); }
  if (!Buffer.isBuffer(bytes) || bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== record.sha256) fail(409, "preview_integrity_failed", "This file could not be verified. Your original remains saved.");
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail(415, "preview_not_text", "This file is not readable UTF-8 text. Download it to open it in its usual application."); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) fail(415, "preview_not_text", "This file contains binary content. Download it instead.");
  if (content.length > 100000) fail(413, "preview_too_large", "This file is too large for the reading view. Download the complete file instead.");
  return { file_id: record.id, sha256: record.sha256, mime_type: mime, content };
}
