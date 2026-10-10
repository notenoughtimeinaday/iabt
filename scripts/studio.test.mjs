import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSubmissionGate, mediaReadiness, normalizeCreationCapabilities, refreshAcceptedSubmission, studioErrorMessage, studioRequestAssets, studioRequestText } from "../src/lib/studio-state.js";
import { createAttachmentTracker } from "../src/lib/upload-batch.js";

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
