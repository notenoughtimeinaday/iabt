import test from "node:test";
import assert from "node:assert/strict";
import { uploadBatch, createAttachmentTracker } from "../src/lib/upload-batch.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("partial batch retries only unfinished files and retains an uploaded object after an Asset write failure", async () => {
  const uploads = [];
  const saves = [];
  const published = [];
  let fail = true;
  const dependencies = {
    upload: async (file) => { uploads.push(file); return { file_id: file }; },
    createAsset: async (file, stored) => {
      saves.push(file);
      if (file === "second" && fail) throw new Error("network failure");
      return { id: file, file_id: stored.file_id };
    },
    onUploaded: async (rows) => { published.push(rows.map((row) => row.id)); },
  };
  const first = await uploadBatch(["first", "second", "third"].map((file) => ({ file })), dependencies);
  assert.deepEqual(published, [["first"]]);
  assert.deepEqual(first.pending.map((entry) => entry.file), ["second", "third"]);
  assert.equal(first.pending[0].uploaded.file_id, "second");
  fail = false;
  const retry = await uploadBatch(first.pending, dependencies);
  assert.equal(retry.error, null);
  assert.deepEqual(retry.pending, []);
  assert.deepEqual(uploads, ["first", "second", "third"]);
  assert.deepEqual(saves, ["first", "second", "second", "third"]);
  assert.deepEqual(published, [["first"], ["second", "third"]]);
});

test("upload completion waits until asynchronous parent synchronization acknowledges saved assets", async () => {
  const sync = deferred();
  let finished = false;
  const tracker = createAttachmentTracker();
  tracker.switchScope("scope", "conversation", []);
  tracker.setUploadStatus("scope", "conversation", { busy: true, pending: 1 });
  const operation = uploadBatch([{ file: "first" }], {
    upload: async () => ({ file_id: "first" }),
    createAsset: async () => ({ id: "asset", file_id: "first" }),
    onUploaded: async (rows) => {
      await sync.promise;
      tracker.mergeUploaded("scope", "conversation", rows);
    },
  }).then((result) => {
    tracker.setUploadStatus("scope", "conversation", { busy: false, pending: result.pending.length });
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.match(tracker.planningError(), /finish uploading/);
  sync.resolve();
  await operation;
  assert.equal(tracker.planningError(), "");
  assert.equal(tracker.snapshot().rows[0].file_id, "first");
});

test("failed parent synchronization retries acknowledgement without duplicate server writes", async () => {
  let writes = 0;
  let rejectSync = true;
  const dependencies = {
    upload: async () => { writes += 1; return { file_id: "file" }; },
    createAsset: async () => { writes += 1; return { id: "asset" }; },
    onUploaded: async () => { if (rejectSync) throw new Error("refresh failed"); },
  };
  const initial = await uploadBatch([{ file: "file" }], dependencies);
  assert.equal(initial.pending.length, 1);
  rejectSync = false;
  const retry = await uploadBatch(initial.pending, dependencies);
  assert.equal(retry.pending.length, 0);
  assert.equal(writes, 2);
});

test("poll responses cannot erase files saved while the poll was running", () => {
  const tracker = createAttachmentTracker();
  tracker.switchScope("scope", "conversation", [{ id: "old" }]);
  const poll = tracker.beginLoad("scope", "conversation");
  tracker.mergeUploaded("scope", "conversation", [{ id: "new", file_id: "new-file" }]);
  assert.equal(tracker.finishLoad(poll, [{ id: "old" }]), false);
  assert.deepEqual(tracker.snapshot().rows.map((row) => row.id), ["new", "old"]);
  assert.equal(tracker.planningError(), "");
});

test("failed attachment reads preserve existing references and block planning until a successful refresh", () => {
  const tracker = createAttachmentTracker();
  tracker.switchScope("scope", "conversation", [{ id: "saved" }]);
  tracker.finishLoad(tracker.beginLoad("scope", "conversation"), [], "request failed");
  assert.equal(tracker.snapshot().rows[0].id, "saved");
  assert.match(tracker.planningError(), /could not be checked/);
  tracker.finishLoad(tracker.beginLoad("scope", "conversation"), [{ id: "saved" }]);
  assert.equal(tracker.planningError(), "");
  tracker.setUploadStatus("scope", "conversation", { busy: false, pending: 1 });
  assert.match(tracker.planningError(), /Retry them or discard/);
});

test("late uploads and polls from a prior conversation cannot cross the conversation boundary", () => {
  const tracker = createAttachmentTracker();
  tracker.switchScope("shared-project", "old", []);
  const stale = tracker.beginLoad("shared-project", "old");
  tracker.switchScope("shared-project", "new", []);
  assert.equal(tracker.mergeUploaded("shared-project", "old", [{ id: "wrong" }]), false);
  assert.equal(tracker.setUploadStatus("shared-project", "old", { busy: true, pending: 1 }), false);
  assert.equal(tracker.finishLoad(stale, [{ id: "wrong" }]), false);
  assert.deepEqual(tracker.snapshot().rows, []);
  assert.equal(tracker.planningError(), "");
});
