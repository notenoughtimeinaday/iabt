import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSubmissionGate, mediaReadiness, normalizeCreationCapabilities, refreshAcceptedSubmission, studioErrorMessage } from "../src/lib/studio-state.js";

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
