import { createHash } from "node:crypto";
import { repositoryUrl } from "../../../shared/workspace-sources.js";

const ENTITY = "WorkspaceSource";
const fail = (code, message) => Object.assign(new Error(message), { status: 400, code });
const actor = (user) => ({ ...user, role: "user" });
const keys = new Set(["kind", "title", "repository_url", "sha256", "filename", "location", "commit_sha", "notes"]);
const bounded = (value, max = 160) => typeof value === "string" && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value.trim() : "";

export function validateWorkspaceSource(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !keys.has(key))) throw fail("invalid_workspace_source", "Use only source reference fields. Do not include credentials or account settings.");
  const title = bounded(input.title), kind = input.kind;
  if (!title || !["repository", "archive", "local"].includes(kind)) throw fail("invalid_workspace_source", "Choose a source name and supported reference type.");
  const notes = bounded(input.notes, 600), location = bounded(input.location, 400);
  if ((input.notes && !notes) || (input.location && !location)) throw fail("invalid_workspace_source", "Keep notes and source locations within the displayed limits.");
  const commit = input.commit_sha || "";
  if (commit && !/^[a-f0-9]{40}$/i.test(commit)) throw fail("invalid_workspace_source", "Use a full Git commit SHA when recording a snapshot.");
  if (kind === "repository") {
    const url = repositoryUrl(input.repository_url);
    if (!url || input.sha256 || input.filename) throw fail("invalid_workspace_source", "Use a plain HTTPS GitHub repository URL without credentials or query parameters.");
    return { kind, title, repository_url: url, commit_sha: commit.toLowerCase(), notes, location };
  }
  if (input.repository_url || commit) throw fail("invalid_workspace_source", "Repository fields belong only to repository references.");
  const filename = bounded(input.filename);
  if (!filename || /[\\/]/.test(filename) || filename === "." || filename === "..") throw fail("invalid_workspace_source", "Use a filename without directory components.");
  const sha256 = input.sha256 || "";
  if ((kind === "archive" && !/^[a-f0-9]{64}$/i.test(sha256)) || (sha256 && !/^[a-f0-9]{64}$/i.test(sha256))) throw fail("invalid_workspace_source", "Archive references require a full SHA-256 checksum.");
  return { kind, title, filename, sha256: sha256.toLowerCase(), notes, location };
}

export async function handleWorkspaceSources({ name, body, user, repository }) {
  if (!["get-workspace-sources", "save-workspace-sources"].includes(name)) return null;
  if (!user?.email_verified) throw Object.assign(new Error("Verify your account before saving source references."), { status: 403, code: "verified_account_required" });
  const list = (repo) => repo.listRecords(ENTITY, actor(user), { query: { user_id: user.id }, sort: "-updated_date", limit: 500 });
  if (name === "get-workspace-sources") return { status: 200, payload: { data: { sources: await list(repository), access_scope: "signed_in_account", repository_sync: false } } };
  if (!Array.isArray(body.sources) || !body.sources.length || body.sources.length > 100) throw fail("invalid_workspace_catalog", "Import between 1 and 100 source references at a time.");
  const sources = body.sources.map(validateWorkspaceSource);
  if (typeof repository.withRecordTransaction !== "function") throw Object.assign(new Error("Durable source catalog is unavailable."), { status: 503, code: "workspace_storage_unavailable" });
  const saved = await repository.withRecordTransaction(async (tx) => {
    const current = await list(tx), map = new Map(current.map((item) => [item.source_key, item]));
    for (const source of sources) {
      const identity = source.kind === "repository" ? source.repository_url.toLowerCase() : source.sha256 || source.location + "/" + source.filename;
      const source_key = createHash("sha256").update(source.kind + ":" + identity).digest("hex");
      if (map.has(source_key)) continue;
      if (map.size >= 500) throw fail("workspace_catalog_full", "This account already has 500 source references. Originals have not been changed.");
      const row = await tx.createRecord(ENTITY, actor(user), { ...source, source_key, user_id: user.id, evidence: "reference_only", repository_sync: false });
      map.set(source_key, row);
    }
    return [...map.values()];
  });
  return { status: 200, payload: { data: { sources: saved, access_scope: "signed_in_account", repository_sync: false } } };
}
