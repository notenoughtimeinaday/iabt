import { Script } from "node:vm";
import { SOURCE_LIMITS } from "../files/text-sources.js";

const fail = (code, message) => Object.assign(new Error(message), { code, status: 422 });
const markupFailure = () => fail("web_app_script_markup_unsupported", "Use ordinary, unambiguous HTML script tags. Close comments and text elements, and avoid legacy script escaping or foreign-content scripts.");
const SPACE = /[\t\n\f\r ]/;
const CLASSIC_TYPES = new Set([
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
  "text/javascript1.3", "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript",
  "text/x-ecmascript", "text/x-javascript"
]);
const DATA_TYPES = new Set(["application/json", "application/ld+json", "text/plain", "text/template", "text/x-template"]);
const RAW_TEXT_ELEMENTS = new Set(["style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const MAX_SCRIPT_BLOCKS = 64;

// This intentionally supports a conservative HTML subset instead of guessing
// through malformed browser tokenization. It is not an HTML conformance parser.
function readTag(html, start) {
  const match = /^<(\/)?([a-z][a-z0-9:-]*)(?=[\t\n\f\r />])/i.exec(html.slice(start));
  if (!match) return null;
  let quote = "", end = start + match[0].length;
  for (; end < html.length; end++) {
    const char = html[end];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "<") throw markupFailure();
    else if (char === ">") break;
  }
  if (end === html.length) throw markupFailure();
  return { name: match[2].toLowerCase(), closing: Boolean(match[1]), attributes: html.slice(start + match[0].length, end), end: end + 1 };
}

function scriptAttributes(text) {
  const attributes = new Map();
  let index = 0;
  while (index < text.length) {
    while (SPACE.test(text[index] || "")) index++;
    if (index === text.length) break;
    // Self-closing script syntax does not close a script in HTML and is easy
    // to misread. Require an explicit opening and closing tag instead.
    const match = /^[a-z_:][a-z0-9_.:-]*/i.exec(text.slice(index));
    if (!match) throw markupFailure();
    const name = match[0].toLowerCase();
    if (attributes.has(name)) throw markupFailure();
    index += match[0].length;
    while (SPACE.test(text[index] || "")) index++;
    let value = "";
    if (text[index] === "=") {
      index++;
      while (SPACE.test(text[index] || "")) index++;
      const quote = text[index] === "\"" || text[index] === "'" ? text[index++] : "";
      const start = index;
      if (quote) {
        while (index < text.length && text[index] !== quote) index++;
        if (index === text.length) throw markupFailure();
        value = text.slice(start, index++);
      } else {
        while (index < text.length && !SPACE.test(text[index])) index++;
        value = text.slice(start, index);
        if (!value || /["'`=<>]/.test(value)) throw markupFailure();
      }
      if (index < text.length && !SPACE.test(text[index])) throw markupFailure();
    }
    attributes.set(name, value);
  }
  return attributes;
}

function closingRawTag(html, name, start) {
  const pattern = new RegExp("</" + name + "(?=[\\t\\n\\f\\r />])", "ig");
  pattern.lastIndex = start;
  const match = pattern.exec(html);
  if (!match) throw markupFailure();
  const tag = readTag(html, match.index);
  if (!tag || tag.attributes.trim()) throw markupFailure();
  return { start: match.index, end: tag.end };
}

function classifyScript(attributes) {
  if (attributes.has("src")) {
    throw fail("web_app_external_dependency", "Use inline scripts without external sources.");
  }
  const type = (attributes.get("type") || "").trim().toLowerCase();
  const language = (attributes.get("language") || "").trim().toLowerCase();
  const essence = type.split(";", 1)[0].trim();
  if (!type && (!language || /^(?:javascript(?:1\.[0-5])?|ecmascript|jscript|livescript)$/.test(language))) return "classic";
  if (CLASSIC_TYPES.has(essence)) return "classic";
  if (DATA_TYPES.has(essence)) return "data";
  throw fail("web_app_script_type_unsupported", "Use inline classic JavaScript, not modules, import maps, or unsupported script types. JSON data blocks may use application/json or application/ld+json.");
}

function unambiguousForeignSelfClose(attributes) {
  const text = attributes.trimEnd();
  // A slash adjacent to an unquoted value is part of that value in HTML,
  // not a self-closing marker. Only recognize clearly delimited forms.
  return text.trim() === "/" || /(?:[\t\n\f\r ]|["'])\/$/.test(text);
}

// new Script compiles only. Never call a run method, evaluate dynamic imports,
// or retain the compiled object. This is not a sandbox for executing code.
// It checks neither event-handler attributes nor code in strings, DOM APIs,
// inter-script global conflicts, browser compatibility or actual interactions.
export function validateWebAppScripts(html, { authoringContract = false } = {}) {
  if (typeof html !== "string") throw markupFailure();
  if (Buffer.byteLength(html) > SOURCE_LIMITS.fileBytes || html.split(/\r?\n/).length > SOURCE_LIMITS.fileLines) {
    throw fail("web_app_too_large", "Keep this app within 128 KiB and 2,000 lines of readable HTML.");
  }
  let index = 0, classicCount = 0, dataCount = 0, selectDepth = 0;
  const foreignRoots = [];
  while (index < html.length) {
    const start = html.indexOf("<", index);
    if (start === -1) break;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      const content = html.slice(start + 4, end === -1 ? html.length : end);
      if (end === -1 || /^(?:>|->)/.test(content) || content.includes("--!>") || content.includes("<!--")) throw markupFailure();
      index = end + 3;
      continue;
    }
    if (/^<!doctype\s+html\s*>/i.test(html.slice(start))) {
      index = html.indexOf(">", start) + 1;
      continue;
    }
    if (html[start + 1] === "!" || html[start + 1] === "?") throw markupFailure();
    const tag = readTag(html, start);
    if (!tag) { index = start + 1; continue; }
    index = tag.end;
    if (tag.name === "select") selectDepth = tag.closing ? Math.max(0, selectDepth - 1) : selectDepth + 1;
    if (tag.name === "svg" || tag.name === "math") {
      if (tag.closing) {
        if (foreignRoots.pop() !== tag.name) throw markupFailure();
      } else if (!unambiguousForeignSelfClose(tag.attributes)) foreignRoots.push(tag.name);
    }
    if (tag.closing) continue;
    if (tag.name === "plaintext") throw markupFailure();
    if (tag.name === "script") {
      if (foreignRoots.length) throw markupFailure();
      const kind = classifyScript(scriptAttributes(tag.attributes));
      const closing = closingRawTag(html, tag.name, tag.end);
      const source = html.slice(tag.end, closing.start);
      // HTML's legacy escaped/double-escaped script states differ from JS
      // comments/strings. Reject these forms rather than misidentify a close.
      if (/<!--|-->|<script(?=[\t\n\f\r />])/i.test(source)) throw markupFailure();
      if (classicCount + dataCount >= MAX_SCRIPT_BLOCKS) {
        throw fail("web_app_too_large", "Use at most 64 inline script or data blocks in this app.");
      }
      if (kind === "classic") {
        try {
          new Script(source, { filename: "generated-app-inline.js", displayErrors: false });
        } catch {
          // No parser message, source snippet, stack, or engine internals are
          // returned through the public repair loop.
          throw fail("web_app_script_syntax_invalid", "An inline classic JavaScript block has invalid syntax. Correct its JavaScript syntax and submit the complete HTML again.");
        }
        // A conservative authoring contract, not a security parser or runtime
        // certification. These common APIs either fail in the opaque preview
        // or invite interpolation of user/imported text as active markup.
        if (authoringContract && /\b(?:alert|confirm|prompt)\s*\(|\.\s*(?:innerHTML|outerHTML)\s*=|\.\s*insertAdjacentHTML\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(/.test(source)) {
          throw fail("web_app_preview_api_unsupported", "Use inline feedback and safe DOM text rendering in the private app preview.");
        }
        classicCount++;
      } else dataCount++;
      index = closing.end;
    } else if (RAW_TEXT_ELEMENTS.has(tag.name)) {
      // The select insertion mode can ignore raw-text start tags that would
      // otherwise hide a later real script from a lexical scan. Fail closed.
      if (selectDepth) throw markupFailure();
      index = closingRawTag(html, tag.name, tag.end).end;
    }
  }
  if (foreignRoots.length) throw markupFailure();
  return {
    version: 1,
    method: "bounded_inline_classic_syntax_compilation",
    inline_classic_scripts_checked: classicCount,
    inert_data_blocks_skipped: dataCount,
    runtime_tested: false
  };
}
