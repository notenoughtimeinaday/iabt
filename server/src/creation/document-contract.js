import { countDocumentWords } from "./document-export.js";

// Deliberately limited to an unambiguous, positive numeric word range. This
// does not interpret arbitrary editorial instructions or judge writing quality.
export function requestedDocumentWordRange(request) {
  const ranges = String(request || "").slice(0, 20000).split(/[.!?;\n]+/)
    .map(clause => clause.split(/\b(?:not|no|without|avoid|never|don't|do not)\b/i, 1)[0])
    .flatMap(clause => [...clause.matchAll(/\b(\d{1,5})\s*(?:to|[-–—])\s*(\d{1,5})\s+words\b/gi)])
    .map(match => ({ min: Number(match[1]), max: Number(match[2]) }))
    .filter(range => range.min > 0 && range.max >= range.min);
  return ranges.length && ranges.every(range => range.min === ranges[0].min && range.max === ranges[0].max) ? ranges[0] : null;
}

export function validateDocumentLength({ request, markdown }) {
  const range = requestedDocumentWordRange(request);
  const words = countDocumentWords(markdown);
  if (range && (words < range.min || words > range.max)) {
    throw Object.assign(new Error("The finished document does not meet its requested word range."), {
      code: "document_length_mismatch", word_count: words, word_range: range
    });
  }
  return { word_count: words, word_range: range, method: "readable_markdown_words", editorial_reviewed: false };
}

export function priorDocumentExport(state, { title, markdown }) {
  return (state?.calls || []).find(call => {
    if (call.name !== "create_document" || call.status !== "succeeded" || !Array.isArray(call.result?.created)) return false;
    let args;
    try { args = JSON.parse(call.arguments); } catch { return false; }
    return args.title === title && args.markdown === markdown && call.result.created.length === 3 &&
      call.result.created.every(filename => state.artifacts?.some(artifact => artifact.filename === filename));
  });
}
