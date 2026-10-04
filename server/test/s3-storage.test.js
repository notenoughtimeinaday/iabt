import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { classifyFailure } from "../src/autonomy/recovery.js";
import { S3ObjectStorage } from "../src/storage/s3-storage.js";

const fixture = (send) => {
  const storage = new S3ObjectStorage({ bucket: "private-timeout-fixture" });
  storage.modules = { GetObjectCommand: class { constructor(input) { this.input = input; } } };
  storage.client = { send };
  return storage;
};

test("buffered S3 read destroys a stalled response body at its deadline and permits a clean retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const body = new PassThrough();
  body.write("partial");
  t.after(() => body.destroy());
  let signal;
  const storage = fixture(async (_command, options) => {
    signal = options.abortSignal;
    // Model an SDK that stops observing abortSignal after response headers.
    return { Body: body, ContentLength: 12 };
  });
  let settled = false;
  const result = storage.read("owner/stalled", { maxBytes: 20 }).then(
    (value) => { settled = true; return { value }; },
    (error) => { settled = true; return { error }; }
  );
  await setImmediate();
  t.mock.timers.tick(29_999);
  assert.equal(signal.aborted, false);
  assert.equal(body.destroyed, false);
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  assert.equal(body.destroyed, true);
  const outcome = await result;
  assert.equal(outcome.value, undefined, "a partial body must never be accepted");
  assert.equal(outcome.error.code, "ETIMEDOUT");
  assert.equal(classifyFailure(outcome.error).retryable, true);

  storage.client.send = async () => ({ Body: Readable.from([Buffer.from("complete")]), ContentLength: 8 });
  assert.equal((await storage.read("owner/stalled", { maxBytes: 20 })).toString(), "complete");
});

test("buffered S3 read rejects and destroys a response returned after its request timed out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveRequest;
  const storage = fixture(() => new Promise((resolve) => { resolveRequest = resolve; }));
  const result = storage.read("owner/late").then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  t.mock.timers.tick(30_000);
  const body = Readable.from([Buffer.from("late bytes")]);
  t.after(() => body.destroy());
  resolveRequest({ Body: body, ContentLength: 10 });
  const outcome = await result;
  assert.equal(body.destroyed, true);
  assert.equal(outcome.value, undefined);
  assert.equal(outcome.error.code, "ETIMEDOUT");
});
