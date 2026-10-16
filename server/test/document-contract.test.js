import assert from "node:assert/strict";
import { test } from "node:test";
import { requestedDocumentWordRange, validateDocumentLength, priorDocumentExport } from "../src/creation/document-contract.js";
import { countDocumentWords } from "../src/creation/document-export.js";

test("numeric document ranges count readable words and reject incomplete or excessive prose", () => {
  assert.deepEqual(requestedDocumentWordRange("Write a useful guide of 600 to 800 words."), { min: 600, max: 800 });
  assert.deepEqual(requestedDocumentWordRange("Write 600–800 words."), { min: 600, max: 800 });
  for (const request of ["Do not write 600-800 words", "Write 800-600 words", "Write 0-800 words", "Write 600-800 words; another 20-30 words", "Write a guide"])
    assert.equal(requestedDocumentWordRange(request), null);
  assert.equal(countDocumentWords("# First-shift guide\n\n**Welcome** to [our garden](https://example.test/a/long/path)."), 6);
  const request = "Write 600 to 800 words.";
  assert.throws(() => validateDocumentLength({ request, markdown: "word ".repeat(496) }), error => error.code === "document_length_mismatch" && error.word_count === 496);
  assert.throws(() => validateDocumentLength({ request, markdown: "word ".repeat(801) }), { code: "document_length_mismatch" });
  for (const words of [600, 700, 800]) assert.equal(validateDocumentLength({ request, markdown: "word ".repeat(words) }).word_count, words);
});

test("export reuse requires successful identical content in this job and all original formats", () => {
  const args = { node_id: "a", title: "Guide", markdown: "The complete original guide." };
  const call = { name: "create_document", status: "succeeded", call_id: "first", arguments: JSON.stringify(args), result: { created: ["Guide.md", "Guide.docx", "Guide.pdf"] } };
  const state = { calls: [call], artifacts: call.result.created.map(filename => ({ filename })) };
  assert.equal(priorDocumentExport(state, { ...args, node_id: "b" }), call);
  assert.equal(priorDocumentExport(state, { ...args, markdown: "A changed guide." }), undefined);
  assert.equal(priorDocumentExport(state, { ...args, title: "Another guide" }), undefined);
  assert.equal(priorDocumentExport({ ...state, artifacts: [] }, args), undefined);
  assert.equal(priorDocumentExport({ ...state, calls: [{ ...call, status: "failed" }] }, args), undefined);
  assert.equal(priorDocumentExport(null, args), undefined);
});
