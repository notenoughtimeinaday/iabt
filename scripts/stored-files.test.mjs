import test from "node:test";
import assert from "node:assert/strict";
import { openFileDownload, resolveFileDownload, storedFileId } from "../src/lib/stored-files.js";

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

test("standalone access rejects active-content and credential-bearing download URLs", async () => {
  for (const file_url of ["javascript:alert(1)", "data:text/html,unsafe", "//example.com/file", "https://user:password@example.com/file", "file:///private.txt"]) {
    const client = { files: { access: async () => ({ file_url }) } };
    await assert.rejects(resolveFileDownload(client, { file_id: "owned-file" }, true), /link is invalid/);
  }
});

test("standalone downloads use the existing context and legacy links preserve their target", () => {
  const previous = globalThis.document;
  const clicks = [];
  const removed = [];
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, "a");
      return { click() { clicks.push({ ...this }); }, remove() { removed.push(this); } };
    },
    body: { appendChild: () => {} },
  };
  try {
    openFileDownload("https://private.example/file?signature=one", "report.pdf", true);
    openFileDownload("https://legacy.example/file", "old.txt");
    assert.equal(clicks[0].target, "_self");
    assert.equal(clicks[0].href, "https://private.example/file?signature=one");
    assert.equal(clicks[0].download, "report.pdf");
    assert.equal(clicks[0].referrerPolicy, "no-referrer");
    assert.equal(clicks[0].rel, "noopener noreferrer");
    assert.equal(clicks[1].target, "_blank");
    assert.equal(removed.length, 2);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
