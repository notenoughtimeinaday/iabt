import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createDocx, createPdf } from "../src/creation/document-export.js";
import { buildSourceReviewArtifacts } from "../src/creation/source-review.js";

const decodeXml = (value) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const docxParagraphs = (bytes) => [...bytes.toString("utf8").matchAll(/<w:t xml:space="preserve">(.*?)<\/w:t>/g)].map((match) => decodeXml(match[1]));
// The small built-in PDF writer emits uncompressed literal text strings. Decode
// PDF transport escapes before checking the human-readable reading copy.
const pdfLines = (bytes) => [...bytes.toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => match[1].replace(/\\([\\()])/g, "$1"));

test("portable reading copies decode escaped prose and render all heading levels", () => {
  const markdown = [
    "# A report",
    String.raw`### Source 1: acceptance\-requirements\.md`,
    String.raw`A requirement\. Keep \*literal stars\* and \_literal names\_\.`,
    "#### A fourth heading",
    "##### A fifth heading",
    "###### A sixth heading",
    "**Strong prose** and [link text](https://example.test) remain readable."
  ].join("\n");
  const docx = createDocx({ title: "A report", markdown });
  const expected = [
    "A report", "Source 1: acceptance-requirements.md",
    "A requirement. Keep *literal stars* and _literal names_.",
    "A fourth heading", "A fifth heading", "A sixth heading",
    "Strong prose and link text remain readable."
  ];
  assert.deepEqual(docxParagraphs(docx), expected);
  assert.deepEqual(pdfLines(createPdf({ markdown })), expected);
  for (const level of [3, 4, 5, 6]) assert.ok(docx.toString("utf8").includes(`<w:pStyle w:val="Heading${level}"/>`));
});

test("indented, fenced and inline code retain literal backslashes and Markdown syntax", () => {
  const raw = String.raw`C:\work\one.md \\host\share \*raw* _name_`;
  const markdown = [
    "    " + raw,
    "    ### literal heading",
    "```text", raw, "~~~", "```",
    "~~~text", raw, "~~~~",
    "Inline `" + raw + "` ends.",
    "Inline double ticks: `` a ` and \\*literal* ``.",
    String.raw`Plain regex \w and an unmatched \q stay literal.`
  ];
  const expected = [raw, "### literal heading", raw, "~~~", raw, "Inline " + raw + " ends.", "Inline double ticks: a ` and \\*literal*.", String.raw`Plain regex \w and an unmatched \q stay literal.`];
  assert.deepEqual(docxParagraphs(createDocx({ title: "Literal evidence", markdown: markdown.join("\n") })), expected);
  assert.deepEqual(pdfLines(createPdf({ markdown: markdown.join("\n") })), expected);
});

test("source-review prose renders literally while raw evidence and the Markdown companion remain intact", () => {
  const source = String.raw`# Uploaded source
- Records must preserve C:\work\notes.md and \*literal* patterns.
const pattern = /\w+\.md$/;
### This source heading remains evidence`;
  const request = String.raw`Review requirements. Keep C:\work\notes.md and literal *stars*.`;
  const result = buildSourceReviewArtifacts({ requestText: request, sources: [{ text: source, reference: {
    file_id: randomUUID(), name: "acceptance-requirements.md", size_bytes: Buffer.byteLength(source),
    sha256: createHash("sha256").update(source).digest("hex"), content_type: "text/markdown"
  } }] });
  const markdown = result.artifacts.find((item) => item.metadata.format === "markdown").bytes.toString("utf8");
  assert.ok(markdown.includes(source.split("\n").map((line) => "    " + line).join("\n")), "The Markdown companion preserves every decoded source line");
  for (const format of ["docx", "pdf"]) {
    const bytes = result.artifacts.find((item) => item.metadata.format === format).bytes;
    const text = (format === "docx" ? docxParagraphs(bytes) : pdfLines(bytes)).join("\n");
    assert.ok(text.includes(request));
    assert.ok(text.includes("Source 1: acceptance-requirements.md"));
    assert.equal(text.includes(String.raw`acceptance\-requirements\.md`), false);
    for (const line of source.split("\n")) assert.ok(text.includes(line), format + " retains raw source: " + line);
  }
});

test("large unmatched link delimiters do not stall document creation", () => {
  const moduleUrl = new URL("../src/creation/document-export.js", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { createDocx, createPdf } from ${JSON.stringify(moduleUrl)};
    for (const markdown of ["[".repeat(100000), "[a](".repeat(25000)]) {
      if (!createDocx({ title: "Malformed input", markdown }).length || !createPdf({ markdown }).length) process.exit(1);
    }
  `], { timeout: 4000, encoding: "utf8" });
  assert.equal(result.error, undefined, "A bounded subprocess must finish without an event-loop stall");
  assert.equal(result.status, 0, result.stderr);
});
