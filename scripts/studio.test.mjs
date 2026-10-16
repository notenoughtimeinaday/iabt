import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSubmissionGate, mediaReadiness, normalizeCreationCapabilities, refreshAcceptedSubmission, studioErrorMessage, studioRequestAssets, studioRequestText } from "../src/lib/studio-state.js";
import { createAttachmentTracker } from "../src/lib/upload-batch.js";
import { appResultReview, exportComposerDraft, exportComposerRequest, groupArtifactResults } from "../src/lib/artifact-display.js";
import { createStudioDrafts, emptyStudioDraft, hasStudioDraft } from "../src/lib/studio-drafts.js";
import { appReviewSteps } from "../shared/app-review.js";

test("unfinished creation, exact export and source-bound revision drafts survive A to B to New", () => {
  const drafts = createStudioDrafts();
  const a = { prompt: "  # Draft\r\n\r\n    Keep spaces.  ", documentExport: true, revisionArtifact: null };
  const b = { prompt: "Improve navigation", documentExport: false, revisionArtifact: { id: "original-app" } };
  drafts.save("a", a);
  drafts.save("b", b);
  assert.deepEqual(drafts.read("new"), emptyStudioDraft());
  assert.deepEqual(drafts.read("a"), a);
  assert.deepEqual(drafts.read("b"), b);
  assert.equal(hasStudioDraft({ prompt: "", revisionArtifact: b.revisionArtifact }), true);
  drafts.save("a", emptyStudioDraft());
  assert.deepEqual(drafts.read("a"), emptyStudioDraft(), "accepted/discarded drafts do not reappear");
  assert.equal(drafts.hasAny(), true, "the other unfinished draft remains protected");
  drafts.save("b", emptyStudioDraft());
  assert.equal(drafts.hasAny(), false);
});

test("resource admission rejects A's late success and failure after B selection, including shared project scope", () => {
  const tracker = createAttachmentTracker();
  tracker.switchScope("shared-project", "a");
  const a = tracker.beginLoad("shared-project", "a");
  tracker.switchScope("shared-project", "b");
  const b = tracker.beginLoad("shared-project", "b");
  assert.equal(tracker.finishLoad(a, [{ id: "a-file" }]), false);
  assert.equal(tracker.finishLoad(a, [], "late failure"), false);
  assert.equal(tracker.finishLoad(b, [], "offline"), true);
  assert.deepEqual(tracker.snapshot().rows, []);
  const retry = tracker.beginLoad("shared-project", "b");
  assert.equal(tracker.finishLoad(retry, [{ id: "b-file" }]), true);
  assert.equal(tracker.snapshot().error, "");
  assert.deepEqual(tracker.snapshot().rows, [{ id: "b-file" }]);
});

test("result grouping joins known formats only within one job and preserves independent source history", () => {
  const markdown = { id: "md", job_id: "document-job", mime_type: "text/markdown", name: "Guide.md" };
  const pdf = { id: "pdf", job_id: "document-job", mime_type: "application/pdf" };
  const word = { id: "word", job_id: "document-job", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  const html = { id: "html", job_id: "app-job", mime_type: "text/html" };
  const zip = { id: "zip", job_id: "app-job", mime_type: "application/zip" };
  const unrelated = { id: "unknown", mime_type: "text/plain" };
  const rows = [pdf, word, markdown, unrelated, zip, html];
  const original = structuredClone(rows);
  const groups = groupArtifactResults(rows);
  assert.deepEqual(groups.map((group) => group.primary.id), ["md", "unknown", "html"]);
  assert.deepEqual(groups[0].files.map((file) => file.id), ["md", "pdf", "word"]);
  assert.deepEqual(rows, original);
  const other = { id: "other", job_id: "document-job", mime_type: "image/png" };
  assert.equal(groupArtifactResults([markdown, pdf, other]).length, 3, "unrecognized siblings cannot disappear");
});

test("app results distinguish source delivery from behavior and provide targeted manual review without acceptance", () => {
  const artifact = { metadata: { runtime_tested: false, objective_contract: { method: "bounded_lexical_evidence", checked: ["search", "filter", "overdue", "browser_storage", "json_import", "json_export", "responsive"] } } };
  const original = structuredClone(artifact);
  const review = appResultReview(artifact);
  assert.equal(review.status, "Files saved · behavior not tested");
  assert.match(review.evidence, /not been automatically tested/);
  assert.match(review.preview, /sandboxed.*browser storage may be unavailable/);
  assert.deepEqual(review.checklist, appReviewSteps(artifact.metadata.objective_contract.checked).map((step) => step.text));
  assert.ok(review.checklist.some((item) => /import|export/i.test(item)));
  assert.ok(review.checklist.some((item) => /reopen|reload/i.test(item)));
  assert.deepEqual(artifact, original, "viewing guidance must not accept or modify the saved result");
  assert.deepEqual(appResultReview({}).checklist, appReviewSteps().map((step) => step.text), "historical files have useful fallback guidance");
  assert.match(appResultReview({ metadata: { delivery_mode: "named_starter", objective_completed: false } }).status, /not fully completed/);
  assert.match(appResultReview({ metadata: { runtime_tested: "true" } }).evidence, /not been automatically tested/, "truthy provider claims do not establish testing");
  assert.match(appResultReview({ metadata: { runtime_tested: true } }).evidence, /not your acceptance/);
  assert.deepEqual(appResultReview({ metadata: { objective_contract: { method: "untrusted", checked: ["browser_storage"] } } }).checklist, appReviewSteps().map((step) => step.text));
});

test("plain document editing reconstructs the exact supplied-text export and excludes old attachment context", () => {
  const body = "# Community guide\r\n\r\n    Spaces stay.  \r\n";
  const draft = exportComposerDraft("Export this text as a document:\r\n" + body);
  assert.equal(draft.exporting, true);
  assert.equal(draft.text, body);
  assert.equal(exportComposerRequest(draft.text, true), "Export this text as a document:\n" + body);
  assert.equal(exportComposerRequest("Build a garden app", false), "Build a garden app");
  assert.deepEqual(studioRequestAssets([{ file_id: "earlier-source" }], "text-export"), []);
  assert.equal(exportComposerDraft("Explain text export").exporting, false);
});

test("Studio preserves supplied document whitespace and gives changed content a new submission identity", () => {
  const body = "# Volunteer guide\r\n\r\n    Keep this indentation.  \r\n";
  const prompt = "Export this text as a document:\r\n" + body;
  assert.equal(studioRequestText(prompt), prompt);
  assert.equal(studioRequestText("  Create a website.  "), "Create a website.");
  const gate = createStudioSubmissionGate((() => { let id = 0; return () => String(++id); })());
  gate.acquire();
  const first = gate.idFor(studioRequestText(prompt));
  gate.release();
  gate.acquire();
  assert.equal(gate.idFor(studioRequestText(prompt)), first);
  assert.notEqual(gate.idFor(studioRequestText(prompt + "\r\n")), first);
  gate.release();
});

test("Studio reads the standalone keyed capability response without claiming unconfigured media is available", () => {
  const rows = normalizeCreationCapabilities({
    document: { configured: true },
    image: { configured: false, provider: "iabt-managed-image" },
    video: { configured: false, provider: "luma", intent: "image" },
  });
  assert.equal(rows.length, 3);
  assert.equal(mediaReadiness(rows, "image"), "provider setup required");
  assert.equal(mediaReadiness(rows, "video"), "provider setup required");
  assert.match(mediaReadiness(rows, "document"), /configured.*checks still apply/);
  assert.equal(mediaReadiness(rows, "audio"), "availability not confirmed");
  assert.equal(mediaReadiness(normalizeCreationCapabilities({ image: { configured: "false" } }), "image"), "availability not confirmed");
});

test("Studio preserves legacy capability arrays and treats malformed readiness as unknown", () => {
  const valid = { id: "video", configured: true };
  assert.deepEqual(normalizeCreationCapabilities([null, false, [], valid]), [valid]);
  assert.match(mediaReadiness([valid], "video"), /checks still apply/);
  for (const input of [null, undefined, false, "offline", 1, { image: null, video: [] }]) {
    assert.deepEqual(normalizeCreationCapabilities(input), []);
  }
});

test("Studio shows the actionable API explanation rather than its machine error code", () => {
  const failure = Object.assign(new Error("Generic transport error"), {
    data: { error: "provider_configuration_required", message: "Video rendering needs provider setup before it can start." },
  });
  assert.equal(studioErrorMessage(failure), failure.data.message);
  assert.equal(studioErrorMessage({ response: { data: { error: "Legacy explanation" } } }), "Legacy explanation");
  assert.equal(studioErrorMessage({ data: { error: { code: "invalid" } } }, "Please retry."), "Please retry.");
});

test("Studio blocks reentrant sends and retains the id after an uncertain response until accepted", () => {
  let sequence = 0;
  const gate = createStudioSubmissionGate(() => `submission-${++sequence}`);
  const request = JSON.stringify(["conversation-a", "Animate this photo", ["file-a"], true]);
  assert.equal(gate.acquire(), true);
  const first = gate.idFor(request);
  assert.equal(gate.acquire(), false, "a second click before render cannot acquire a send");
  gate.release(); // Transport timed out; the server may have accepted it.
  assert.equal(gate.acquire(), true);
  assert.equal(gate.idFor(request), first, "retry keeps the server idempotency key");
  gate.accepted();
  gate.release();
  assert.equal(gate.acquire(), true);
  assert.notEqual(gate.idFor(request), first, "an intentional new request after acceptance gets its own id");
});

test("Studio changes submission identity when conversation, files, objective or quote policy changes", () => {
  let sequence = 0;
  const gate = createStudioSubmissionGate(() => `submission-${++sequence}`);
  const keys = [
    ["conversation-a", "Make a video", ["file-a"], true],
    ["conversation-b", "Make a video", ["file-a"], true],
    ["conversation-b", "Make a video", ["file-b"], true],
    ["conversation-b", "Make a document", ["file-b"], true],
    ["conversation-b", "Make a document", ["file-b"], false],
  ];
  const ids = keys.map((key) => {
    assert.equal(gate.acquire(), true);
    const id = gate.idFor(JSON.stringify(key));
    gate.release();
    return id;
  });
  assert.equal(new Set(ids).size, keys.length);
  assert.throws(() => gate.idFor("unlocked"), /Acquire/);
});

test("revising a source-built app preserves its attachments without resending them or changing retry identity", () => {
  const attachments = createAttachmentTracker();
  const source = { id: "asset-a", file_id: "source-a", project_id: "conversation:a", name: "requirements.md" };
  attachments.switchScope("conversation:a", "a", [source]);
  let sequence = 0;
  const gate = createStudioSubmissionGate(() => `submission-${++sequence}`);
  const prepare = (revisionFileId) => {
    const assets = studioRequestAssets(attachments.snapshot().rows, revisionFileId);
    const fileIds = assets.map((asset) => asset.file_id);
    gate.acquire();
    const submissionId = gate.idFor(JSON.stringify(["a", "Add a filter", fileIds, true, revisionFileId]));
    gate.release();
    return { fileIds, contextAssetIds: assets.map((asset) => asset.id), revisionFileId, submissionId };
  };
  const initial = prepare(null);
  assert.deepEqual(initial.fileIds, ["source-a"]);
  const revision = prepare("saved-html-a");
  assert.deepEqual(revision.fileIds, []);
  assert.deepEqual(revision.contextAssetIds, [], "legacy/custom context must not reintroduce excluded attachments");
  assert.equal(revision.revisionFileId, "saved-html-a");
  assert.notEqual(revision.submissionId, initial.submissionId);
  assert.deepEqual(prepare("saved-html-a"), revision, "an uncertain revision retry reuses its request identity");
  assert.notEqual(prepare("saved-html-b").submissionId, revision.submissionId, "selecting a different saved version is a different request");
  assert.deepEqual(attachments.snapshot().rows, [source], "revision requests never remove original attachments");
  assert.deepEqual(prepare(null).fileIds, ["source-a"], "leaving revision mode restores the normal attachment context");
});

test("Studio refreshes accepted-request resources even if the sidebar refresh fails", async () => {
  let resourcesRefreshed = 0;
  const results = await refreshAcceptedSubmission(
    () => { throw new Error("Sidebar connection interrupted"); },
    async () => { resourcesRefreshed += 1; return ["server-accepted-plan"]; },
  );
  assert.equal(resourcesRefreshed, 1);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "fulfilled"]);
  await assert.doesNotReject(refreshAcceptedSubmission(
    async () => { throw new Error("offline"); },
    async () => { throw new Error("offline"); },
  ));
});
