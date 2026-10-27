import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryRepository } from "../src/memory-repository.js";
import { handleWorkspaceSources, validateWorkspaceSource } from "../src/functions/workspace-sources.js";
import { repositoryUrl, isPersonalWorkspaceOwner, sourceReviewPrompt } from "../../shared/workspace-sources.js";

const source = { kind: "repository", title: "Example", repository_url: "https://github.com/owner/repo.git" };
async function fixture() {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "derik@insuredspending.org", passwordHash: "unused", emailVerified: true });
  const other = await repository.createUser({ email: "other@example.test", passwordHash: "unused", emailVerified: true, role: "admin" });
  const call = (name, sources, account = user) => handleWorkspaceSources({ name, body: { sources }, user: account, repository });
  return { repository, user, other, call };
}

test("repository references accept only plain canonical HTTPS GitHub URLs", () => {
  assert.equal(repositoryUrl(source.repository_url), "https://github.com/owner/repo");
  for (const url of ["javascript:alert(1)", "https://token@github.com/a/b", "https://github.com/a/b?token=secret", "https://github.com/a/b#secret", "https://github.com:8080/a/b", "https://github.com/a/b/tree/main", "https://github.com.evil.test/a/b"]) assert.equal(repositoryUrl(url), "");
  assert.match(sourceReviewPrompt(source), /not source access/);
  assert.equal(isPersonalWorkspaceOwner({ email: "derik@insuredspending.org", email_verified: false }), false);
});

test("catalog imports are private even from admins and cannot forge account or connection authority", async () => {
  const { call, other, user, repository } = await fixture();
  const saved = (await call("save-workspace-sources", [source])).payload.data;
  assert.equal(saved.repository_sync, false);
  assert.equal(saved.sources[0].owner_id, user.id);
  assert.equal(saved.sources[0].evidence, "reference_only");
  assert.equal((await call("get-workspace-sources", undefined, other)).payload.data.sources.length, 0);
  await repository.createRecord("WorkspaceSource", other, { user_id: user.id, title: "forged match" });
  assert.equal((await call("get-workspace-sources")).payload.data.sources.length, 1);
  for (const field of ["owner_id", "user_id", "repository_sync", "token", "evidence", "id"]) {
    await assert.rejects(call("save-workspace-sources", [{ ...source, [field]: "forged" }]), { code: "invalid_workspace_source" });
  }
});

test("concurrent replay keeps one original reference and validates the entire batch before writing", async () => {
  const { call } = await fixture();
  await Promise.all(Array.from({ length: 8 }, () => call("save-workspace-sources", [source])));
  await call("save-workspace-sources", [{ ...source, title: "Replacement title" }]);
  let rows = (await call("get-workspace-sources")).payload.data.sources;
  assert.equal(rows.length, 1); assert.equal(rows[0].title, "Example");
  await assert.rejects(call("save-workspace-sources", [{ ...source, repository_url: "https://github.com/a/other" }, { kind: "archive", title: "Invalid", filename: "a.zip", sha256: "bad" }]), { code: "invalid_workspace_source" });
  rows = (await call("get-workspace-sources")).payload.data.sources;
  assert.equal(rows.length, 1);
});

test("archive evidence stays inert, requires checksums and deduplicates identical bytes", async () => {
  const { call } = await fixture();
  const archive = { kind: "archive", title: "Original", filename: "original.zip", sha256: "a".repeat(64), location: "preserved/original.zip", notes: "Reference only" };
  await call("save-workspace-sources", [archive, { ...archive, title: "Duplicate", filename: "copy.zip" }]);
  assert.equal((await call("get-workspace-sources")).payload.data.sources.length, 1);
  assert.throws(() => validateWorkspaceSource({ ...archive, filename: "../original.zip" }), { code: "invalid_workspace_source" });
  assert.throws(() => validateWorkspaceSource({ ...archive, repository_url: source.repository_url }), { code: "invalid_workspace_source" });
});

test("verified sessions and transactional storage are required without paid work or external calls", async () => {
  const { call, user, repository } = await fixture();
  assert.equal(await call("unrelated", undefined, null), null);
  await assert.rejects(call("get-workspace-sources", undefined, { ...user, email_verified: false }), { status: 403 });
  await assert.rejects(call("save-workspace-sources", []), { code: "invalid_workspace_catalog" });
  repository.withRecordTransaction = undefined;
  await assert.rejects(call("save-workspace-sources", [source]), { status: 503 });
  assert.equal((await repository.listRecords("GenerationJob", user)).length, 0);
});
