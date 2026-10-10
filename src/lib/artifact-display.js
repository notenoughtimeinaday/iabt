import { documentTitleFromText } from "../../shared/document-title.js";
export const artifactMime = (artifact) => String(artifact?.mime_type || "").split(";")[0].trim().toLowerCase();
export const canReadArtifact = (artifact) => ["text/markdown", "text/x-markdown", "text/plain", "text/csv", "application/json"].includes(artifactMime(artifact));
export const isMarkdownArtifact = (artifact) => ["text/markdown", "text/x-markdown"].includes(artifactMime(artifact)) || (artifactMime(artifact) === "text/plain" && /\.md$/i.test(artifact?.name || ""));
export function artifactFormat(artifact) {
  const mime = artifactMime(artifact);
  if (mime === "application/pdf") return "PDF";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "Word";
  if (isMarkdownArtifact(artifact)) return "Markdown";
  if (mime === "text/html") return "HTML";
  if (mime === "application/zip") return "Source ZIP";
  return "File";
}

// Keep jobs in their existing order, collapse only known sibling formats, and
// retain unrelated/legacy files rather than hiding them behind an inferred job.
export function groupArtifactResults(rows = []) {
  const jobs = new Map();
  for (const row of rows) if (row.job_id) jobs.set(row.job_id, [...(jobs.get(row.job_id) || []), row]);
  const emitted = new Set(), results = [];
  for (const row of rows) {
    if (!row.job_id) { results.push({ primary: row, files: [row] }); continue; }
    if (emitted.has(row.job_id)) continue;
    emitted.add(row.job_id);
    const files = jobs.get(row.job_id);
    const app = files.find((file) => artifactMime(file) === "text/html");
    const document = files.find(isMarkdownArtifact);
    const primary = app || document;
    const allowed = app ? new Set(["text/html", "application/zip"]) : new Set(["text/markdown", "text/x-markdown", "text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
    if (primary && files.every((file) => allowed.has(artifactMime(file)))) results.push({ primary, files: [primary, ...files.filter((file) => file !== primary)] });
    else results.push(...files.map((file) => ({ primary: file, files: [file] })));
  }
  return results;
}

export function exportComposerDraft(value = "") {
  const match = String(value).match(/^Export this text as a document:\r?\n/i);
  return match ? { exporting: true, text: String(value).slice(match[0].length) } : { exporting: false, text: value };
}
export const exportComposerRequest = (text, exporting) => exporting ? "Export this text as a document:\n" + text : text;

export function workTitle(conversation) {
  if (conversation?.metadata?.title) return conversation.metadata.title;
  const content = conversation?.messages?.find((message) => message.role === "user")?.content;
  const text = typeof content === "string" ? content : content?.text || "";
  const draft = exportComposerDraft(text);
  return draft.exporting ? documentTitleFromText(draft.text) : text.trim() || "Untitled work";
}
