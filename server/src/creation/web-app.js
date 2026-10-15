import { createHash } from "node:crypto";
import { createZip } from "./zip.js";
import { readTextSources, SOURCE_LIMITS } from "../files/text-sources.js";

const fail = (code, message, status = 422, details = {}) => Object.assign(new Error(message), { code, status, ...details });
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const SECURITY_TAGS = '\n<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n<meta name="referrer" content="no-referrer">';

const includes = (pattern) => (text) => pattern.test(text);
const includesAll = (...patterns) => (text) => patterns.every((pattern) => pattern.test(text));
const OBJECTIVE_REQUIREMENTS = Object.freeze([
  { id: "add", label: "add items", requested: includes(/\badd\b/i), evidenced: includes(/\badd\b/i) },
  { id: "edit", label: "edit existing items", requested: includes(/\b(?:edit|editable|modify existing|update existing)\b/i), evidenced: includes(/\b(?:edit|editing|editable|contenteditable)\b/i) },
  { id: "complete", label: "complete items", requested: includes(/\b(?:complete|mark(?:ing)?\s+(?:as\s+)?done)\b/i), evidenced: includes(/\b(?:complete|completed|mark(?:ing)?\s+(?:as\s+)?done)\b/i) },
  { id: "delete", label: "delete items", requested: includes(/\b(?:delete|remove)\b/i), evidenced: includes(/\b(?:delete|remove)\b/i) },
  { id: "equipment_name", label: "equipment name", requested: includes(/\bequipment\s+name\b/i), evidenced: includes(/\bequipment\s+name\b/i) },
  { id: "priority", label: "priority", requested: includes(/\bpriorit(?:y|ies)\b/i), evidenced: includes(/\bpriorit(?:y|ies)\b/i) },
  { id: "due_date", label: "due date", requested: includes(/\bdue\s+date\b/i), evidenced: includes(/\bdue\s+date\b/i) },
  { id: "notes", label: "notes", requested: includes(/\bnotes?\b/i), evidenced: includes(/\bnotes?\b/i) },
  { id: "search", label: "search", requested: includes(/\bsearch\b/i), evidenced: includes(/\bsearch\b/i) },
  { id: "filter", label: "filters", requested: includes(/\bfilter(?:s|ed|ing)?\b/i), evidenced: includes(/\bfilter(?:s|ed|ing)?\b/i) },
  { id: "status", label: "status", requested: includes(/\bstatus\b/i), evidenced: includes(/\bstatus\b/i) },
  { id: "overdue", label: "overdue summary", requested: includes(/\boverdue\b/i), evidenced: includes(/\boverdue\b/i) },
  { id: "upcoming", label: "upcoming summary", requested: includes(/\bupcoming\b/i), evidenced: includes(/\bupcoming\b/i) },
  { id: "browser_storage", label: "browser storage persistence", requested: includes(/\b(?:browser|local)\s+storage\b|\bpersist\w*\b[^.]{0,80}\b(?:browser|local)\b/i), evidenced: includes(/\b(?:localStorage|indexedDB)\b/) },
  { id: "json_import", label: "JSON import", requested: includesAll(/\bimport\b/i, /\bJSON\b/i), evidenced: includesAll(/\bimport\b/i, /\bJSON\.parse\s*\(/) },
  { id: "json_export", label: "JSON export", requested: includesAll(/\bexport\b/i, /\bJSON\b/i), evidenced: includesAll(/\bexport\b/i, /\bJSON\.stringify\s*\(/) },
  { id: "sample_data", label: "realistic sample data", requested: includes(/\b(?:sample|demo|seed)\s+data\b/i), evidenced: includes(/\b(?:sample|demo|seed)\s+data\b/i) },
  { id: "empty_state", label: "clear empty states", requested: includes(/\bempty\s+states?\b/i), evidenced: includes(/\bempty\b|\bno\s+(?:tasks?|items?|results?|records?)\b/i) },
  { id: "responsive", label: "phone and desktop layout", requested: includesAll(/\bphone\b/i, /\bdesktop\b/i), evidenced: includesAll(/<meta\b[^>]*name\s*=\s*["']viewport["']/i, /@media\b/i) }
]);

// This is a format and network-default contract, not proof of application
// correctness. Generated code is never executed by the API or worker.
export function prepareWebAppHtml(input) {
  const html = typeof input === "string" ? input.trim().replaceAll(SECURITY_TAGS, "") : "";
  if (!/^<!doctype\s+html\s*>\s*<html(?:\s+(?:lang|dir)\s*=\s*["'][a-z0-9-]+["'])*\s*>\s*<head\s*>/i.test(html) || !/<\/head>/i.test(html) || !/<body(?:\s[^>]*)?>/i.test(html) || !/<\/body>\s*<\/html>\s*$/i.test(html)) {
    throw fail("web_app_incomplete", "Create a complete HTML document with head and body elements.");
  }
  if (/<(?:base|iframe|object|embed|link)\b/i.test(html) || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html) || /<script\b[^>]*\bsrc\s*=/i.test(html) || /(?:src|href|action|formaction)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:)/i.test(html) || /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/.test(html) || /\blocation\s*(?:=|\.|\[)|\b(?:window|self|parent|top)\s*\.\s*open\s*\(/.test(html)) {
    throw fail("web_app_external_dependency", "Use inline code and styles, embedded images, and local interactions. External services and navigation are not part of this preview.");
  }
  const secured = html.replace(/<head\s*>/i, (head) => head + SECURITY_TAGS);
  if (Buffer.byteLength(secured) > SOURCE_LIMITS.fileBytes || secured.split(/\r?\n/).length > SOURCE_LIMITS.fileLines || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(secured)) {
    throw fail("web_app_too_large", "Keep this app within 128 KiB and 2,000 lines of readable HTML.");
  }
  return secured;
}

// This bounded lexical contract catches an obvious omission and gives the
// model a concrete repair target. It does not execute code or prove behavior.
export function validateWebAppObjective({ request, html }) {
  const objective = typeof request === "string" ? request.slice(0, 20_000) : "";
  const required = OBJECTIVE_REQUIREMENTS.filter((item) => item.requested(objective));
  const missing = required.filter((item) => !item.evidenced(html));
  if (missing.length) {
    throw fail("web_app_requirements_missing", "The app omitted explicitly requested features.", 422, {
      missing_requirements: missing.map((item) => item.label)
    });
  }
  return { version: 1, method: "bounded_lexical_evidence", checked: required.map((item) => item.id), passed: required.map((item) => item.id) };
}

export async function readRevisionSource({ repository, storage, user, fileId, expectedReferences }) {
  const [source] = await readTextSources({ repository, storage, user, fileIds: [fileId], expectedReferences });
  if (!/\.html$/i.test(source.reference.name) || !/^text\/html(?:;|$)/i.test(source.reference.mime_type) || !/<!doctype\s+html/i.test(source.text) || !/<\/html>/i.test(source.text)) {
    throw fail("revision_source_unsupported", "Choose a saved HTML app to make a change.");
  }
  return source;
}

export function buildWebAppArtifacts({ title, html, request = "", revision = null }) {
  const name = String(title || "My app").replace(/[^a-zA-Z0-9 ._-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100).replace(/[. ]+$/, "") || "My app";
  const content = prepareWebAppHtml(html);
  const objectiveContract = revision ? { version: 1, method: "revision_not_lexically_checked", checked: [], passed: [] } : validateWebAppObjective({ request, html: content });
  const bytes = Buffer.from(content, "utf8");
  const metadata = {
    preview_ready: true, interactive: true, delivery_mode: "web_app_source", runtime_tested: false,
    objective_contract: objectiveContract,
    ...(revision ? { revision_of_file_id: revision.file_id, revision_of_sha256: revision.sha256 } : {}),
    source_sha256: createHash("sha256").update(bytes).digest("hex"),
    limitations: ["Try the app before publishing. Cloud accounts, shared data and payments are not connected.", "The private preview is sandboxed; browser storage may be unavailable. Export is a standalone HTML app.", "Objective checks find bounded labels and code markers; they do not prove the interactions work."]
  };
  const readme = `# ${name}\n\nOpen index.html in a browser. No installation, build service or external libraries are required.\n\nThis file is identical to the saved preview. Test its actual interactions before publishing. Cloud accounts, shared data and payments are not connected. Local browser storage, when used, is device-specific and may be blocked in the private preview.\n\nGenerated code was not executed on the IABT server.\n`;
  return {
    metadata,
    artifacts: [
      { filename: name + ".html", contentType: "text/html", kind: "app", bytes, metadata },
      { filename: name + "-source.zip", contentType: "application/zip", kind: "archive", bytes: createZip({ "index.html": content, "README.md": readme }), metadata: { ...metadata, preview_ready: false, interactive: false, source_format: "standalone_html" } }
    ]
  };
}
