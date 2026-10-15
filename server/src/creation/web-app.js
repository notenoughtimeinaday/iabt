import { createHash } from "node:crypto";
import { createZip } from "./zip.js";
import { readTextSources, SOURCE_LIMITS } from "../files/text-sources.js";
import { appReviewSteps } from "../../../shared/app-review.js";
import { validateWebAppScripts } from "./web-app-script-checks.js";
import { validateWebAppObjective } from "./web-app-objective.js";
export { requestedWebAppRequirements, validateWebAppObjective } from "./web-app-objective.js";

const fail = (code, message, status = 422, details = {}) => Object.assign(new Error(message), { code, status, ...details });
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const SECURITY_TAGS = '\n<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n<meta name="referrer" content="no-referrer">';

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
  const scriptChecks = validateWebAppScripts(content);
  const objectiveContract = revision ? { version: 1, method: "revision_not_lexically_checked", checked: [], passed: [] } : validateWebAppObjective({ request, html: content });
  const bytes = Buffer.from(content, "utf8");
  const metadata = {
    preview_ready: true, interactive: true, delivery_mode: "web_app_source", runtime_tested: false,
    objective_contract: objectiveContract,
    script_checks: scriptChecks,
    ...(revision ? { revision_of_file_id: revision.file_id, revision_of_sha256: revision.sha256 } : {}),
    source_sha256: createHash("sha256").update(bytes).digest("hex"),
    limitations: ["Try the app before publishing. Cloud accounts, shared data and payments are not connected.", "The private preview is sandboxed; browser storage may be unavailable. Export is a standalone HTML app.", "Objective checks find bounded labels and code markers; they do not prove the interactions work."]
  };
  const readme = `# ${name}\n\nOpen index.html in a browser. No installation, build service or external libraries are required.\n\nThis file is identical to the saved preview. Test its actual interactions before publishing. Cloud accounts, shared data and payments are not connected. Local browser storage, when used, is device-specific and may be blocked in the private preview.\n\nGenerated code was not executed on the IABT server.\n`;
  const review = `# Review before use\n\nThis is a manual checklist, not a completed test report or a certification. IABT checked delivery format, applicable bounded requirement markers and inline classic JavaScript compilation only. ${revision ? "Revision requirements were not lexically checked. " : ""}No generated code was executed on the server. Compilation does not verify browser APIs, interaction wiring, persistence, security or accessibility.\n\nOpen the downloaded index.html on your own device. Use disposable sample data first. Browser storage is device-specific; the private IABT preview may block it.\n\n${appReviewSteps(objectiveContract.checked).map((step) => "- [ ] " + step.text).join("\n")}\n\nRevisions must also preserve the useful behavior of the prior version. Compare with your full request and supplied files; the bounded checklist may omit requirements. Keep the original and record any failed workflow before requesting a new version. Do not publish or sell an unreviewed result.\n`;
  return {
    metadata,
    artifacts: [
      { filename: name + ".html", contentType: "text/html", kind: "app", bytes, metadata },
      { filename: name + "-source.zip", contentType: "application/zip", kind: "archive", bytes: createZip({ "index.html": content, "README.md": readme, "REVIEW.md": review }), metadata: { ...metadata, preview_ready: false, interactive: false, source_format: "standalone_html" } }
    ]
  };
}
