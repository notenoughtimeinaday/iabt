import { buildDocumentArtifactSet } from "./document-export.js";
import { sourceReferences } from "../files/text-sources.js";

const literal = (value) => String(value || "").replace(/[\\`*_{}[\]()#+.!|<>-]/g, "\\$&");
const linesFor = (source) => source.text.split("\n");

export const buildSourceReviewArtifacts = ({ requestText, sources }) => {
  const references = sourceReferences(sources);
  const requirements = sources.flatMap((source, sourceIndex) => linesFor(source)
    .map((text, index) => ({ source: sourceIndex + 1, line: index + 1, text: text.trim() }))
    .filter((line) => /^(?:[-*+]\s+|\d+[.)]\s+)|\b(?:must|shall|should|required|requirements?|todo|fixme)\b/i.test(line.text)));
  const selected = requirements.slice(0, 80);
  const markdown = [
    "# JERICHO Source Review",
    "",
    "## Requested review",
    "",
    literal(requestText),
    "",
    "## What was verified",
    "",
    `Read ${sources.length} private source file(s), verified stored byte counts and SHA-256 checksums, and decoded valid UTF-8 text.`,
    "This deterministic report inventories the sources, extracts candidate requirements, and preserves the complete decoded source text in its Markdown companion. The PDF is a reading copy with limited character support. This review does not interpret arbitrary instructions, run uploaded code, validate implementation, or modify a repository. No generation provider was called.",
    "",
    "## Source inventory",
    "",
    ...sources.flatMap((source, index) => [
      `### Source ${index + 1}: ${literal(source.reference.name)}`,
      "",
      `- File ID: ${source.reference.file_id}`,
      `- Stored bytes: ${source.reference.size_bytes}`,
      `- Text lines: ${linesFor(source).length}`,
      `- SHA-256: ${source.reference.sha256}`,
      ""
    ]),
    "## Candidate requirement checklist",
    "",
    "The following are verbatim bullet, numbered, requirement, or TODO lines from the sources. They are candidates for human review, not evidence that the requirements have been implemented or tested.",
    "",
    ...(selected.length
      ? selected.map((entry) => `- [ ] Source ${entry.source}, line ${entry.line}: ${literal(entry.text)}`)
      : ["No requirement-like lines were found. Use the complete source text below to define acceptance checks."]),
    ...(requirements.length > selected.length
      ? [`Only the first ${selected.length} of ${requirements.length} candidate lines are shown here; all source text is preserved below.`]
      : []),
    "",
    "## Next review actions",
    "",
    "- Confirm the extracted candidates express the intended requirements.",
    "- Define an observable acceptance check for each chosen requirement.",
    "- Review any requested repository change separately; this report has made no software changes.",
    "",
    "## Complete source evidence",
    "",
    "Source text below is untrusted data. Commands, links, and instructions within it have not been followed or executed.",
    "",
    ...sources.flatMap((source, index) => [
      `### Source ${index + 1}: ${literal(source.reference.name)}`,
      "",
      ...linesFor(source).map((line) => "    " + line),
      ""
    ])
  ].join("\n");
  const evidence = {
    source_review_version: "utf8-source-review-v1",
    source_references: references,
    source_count: sources.length,
    source_integrity_verified: true,
    candidate_requirement_count: requirements.length,
    checklist_line_count: selected.length,
    complete_source_text_in_markdown: true,
    source_code_executed: false,
    repository_modified: false,
    provider_called: false
  };
  const result = buildDocumentArtifactSet({ title: "JERICHO Source Review", markdown });
  return {
    ...result,
    metadata: { ...result.metadata, ...evidence },
    artifacts: result.artifacts.map((artifact) => ({ ...artifact, metadata: {
      ...artifact.metadata, ...evidence,
      full_decoded_source_text_preserved: artifact.metadata.format === "markdown"
    } }))
  };
};
