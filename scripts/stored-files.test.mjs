import test from "node:test";
import assert from "node:assert/strict";
import { resolveFileDownload, storedFileId } from "../src/lib/stored-files.js";

test("standalone downloads renew a signed link every time, even with an expired stored URL", async () => {
  let calls = 0;
  const client = { files: { access: async (id) => {
    assert.equal(id, "owned-file");
    return { file_url: "https://private.example/file?signature=" + ++calls };
  } } };
  const asset = { file_id: "owned-file", file_url: "https://private.example/expired" };
  assert.equal(await resolveFileDownload(client, asset, true), "https://private.example/file?signature=1");
  assert.equal(await resolveFileDownload(client, asset, true), "https://private.example/file?signature=2");
});

test("old standalone assets require reupload rather than silently using an expired URL", async () => {
  await assert.rejects(resolveFileDownload({}, { file_url: "https://example.com/old" }, true), /upload it again/);
});

test("download authorization failure never falls back to the stored URL", async () => {
  const client = { files: { access: async () => { throw new Error("File was not found"); } } };
  await assert.rejects(resolveFileDownload(client, { file_uri: "iabt-file:owned-file", file_url: "https://example.com/old" }, true), /not found/);
  assert.equal(storedFileId({ file_uri: "iabt-file:owned-file" }), "owned-file");
});

test("explicit legacy builds keep their existing file download contract", async () => {
  assert.equal(await resolveFileDownload({}, { file_url: "https://example.com/legacy" }, false), "https://example.com/legacy");
});
