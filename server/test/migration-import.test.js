import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { base44SourceIdToUuid } from "../src/migration/identity.js";
import { createImportFileReader } from "../src/migration/import-files.js";
import { executeBase44Import } from "../src/migration/import-runner.js";
import { bytesDigest, IMPORT_PASSWORD_SENTINEL, prepareBase44Import, summarizeImportPlan } from "../src/migration/import-plan.js";

const bytes = Buffer.from("private document bytes");
const exportBundle = () => ({
  schema_version: 1, source_app_id: "6a849bcd3e04d068553b4af7", exported_at: "2026-09-17T12:00:00.000Z",
  users: [{ source_user_id: "user-1", email: "Owner@Example.com", name: "Owner", role: "admin", email_verified: true }],
  entities: {
    Project: [{ id: "project-1", created_by: "owner@example.com", name: "Private project" }],
    Asset: [{ id: "asset-1", user_id: "user-1", project_id: "project-1", file_url: "private/source/document", name: "Document" }]
  },
  files: [{ source_file_id: "file-1", owner_id: "user-1", filename: "document.txt", source_url: "private/source/document", local_path: "files/document.txt", size_bytes: bytes.length, sha256: bytesDigest(bytes) }]
});
const makePlan = (bundle = exportBundle()) => prepareBase44Import(bundle, { readFileBytes: async () => bytes });
const codes = (plan) => plan.errors.map(({ code }) => code);

// This adapter implements atomic rollback and insert-only ownership checks. It
// verifies the runner contract; it is never used as a production repository.
const adapters = () => {
  let database = { users: [], entities: [], files: [], receipts: [] };
  const objects = new Map();
  let writeCount = 0;
  const repository = {
    async withTransaction(callback) {
      const pending = structuredClone(database);
      const result = await callback({
        async inspectPlan(plan) {
          const imported = pending.receipts.includes(plan.digest);
          return { alreadyImported: imported, conflicts: imported ? [] : pending.users.filter((user) => plan.users.some((planned) => user.email === planned.email)), files: pending.files };
        },
        async insertUser(user) { writeCount++; pending.users.push(structuredClone(user)); },
        async insertEntity(record) { writeCount++; pending.entities.push(structuredClone(record)); },
        async insertFile(file) { writeCount++; pending.files.push(structuredClone(file)); },
        async reconcilePlan(plan) {
          return {
            matched: JSON.stringify(pending.users) === JSON.stringify(plan.users) && JSON.stringify(pending.entities) === JSON.stringify(plan.entities),
            digest: plan.digest, users: pending.users.length, entities: pending.entities.length, files: pending.files.length
          };
        },
        async recordImport({ digest }) { pending.receipts.push(digest); }
      });
      database = pending;
      return result;
    }
  };
  const storage = {
    async stagePrivate({ ownerId, objectId, bytes: contents }) {
      const key = `${ownerId}/${objectId}`;
      const previous = objects.get(key);
      if (previous) assert.deepEqual(previous, contents);
      else objects.set(key, Buffer.from(contents));
      return { private: true, owner_id: ownerId, object_id: objectId, storage_provider: "test", storage_key: key };
    },
    async readPrivate(stored) { return objects.get(stored.storage_key); }
  };
  return { repository, storage, objects, snapshot: () => database, writes: () => writeCount };
};

test("dry-run maps ownership, entity references and private files without importing credentials or privileges", async () => {
  const plan = await makePlan();
  assert.equal(plan.importable, true);
  const user = plan.users[0];
  assert.equal(user.id, base44SourceIdToUuid("user-1"));
  assert.equal(user.password_hash, IMPORT_PASSWORD_SENTINEL);
  assert.equal(user.role, "user");
  assert.equal(user.email_verified, false);
  const asset = plan.entities.find((row) => row.entity_name === "Asset");
  assert.equal(asset.owner_id, user.id);
  assert.equal(asset.payload.user_id, user.id);
  assert.equal(asset.payload.project_id, base44SourceIdToUuid("project-1"));
  assert.equal(asset.payload.file_url, `iabt-file:${base44SourceIdToUuid("file-1")}`);
  const second = await makePlan();
  assert.equal(plan.digest, second.digest);
  const summary = JSON.stringify(summarizeImportPlan(plan));
  assert.equal(summary.includes("owner@example.com"), false);
  assert.equal(summary.includes("Private project"), false);
  assert.equal(summary.includes("document.txt"), false);
});

test("unowned, ambiguous and cross-owner files block import", async () => {
  const bundle = exportBundle();
  bundle.users.push({ source_user_id: "user-2", email: "second@example.com" });
  delete bundle.entities.Project[0].created_by;
  bundle.entities.Asset[0].owner_id = "user-2";
  let plan = await makePlan(bundle);
  assert.equal(plan.importable, false);
  assert.ok(codes(plan).includes("owner_unmapped"));
  assert.ok(codes(plan).includes("owner_ambiguous"));
  bundle.entities.Asset[0].user_id = "user-2";
  plan = await makePlan(bundle);
  assert.ok(codes(plan).includes("file_owner_mismatch"));
});

test("credentials in user and file metadata are rejected, with secret values omitted from summaries", async () => {
  const bundle = exportBundle();
  bundle.users[0].password_hash = "DO_NOT_DISCLOSE";
  bundle.files[0].metadata = { access_token: "DO_NOT_DISCLOSE" };
  const plan = await makePlan(bundle);
  assert.equal(plan.importable, false);
  assert.ok(codes(plan).includes("credential_field_forbidden"));
  assert.equal(JSON.stringify(summarizeImportPlan(plan)).includes("DO_NOT_DISCLOSE"), false);
});

test("an asset cannot silently acquire a project owned by another imported user", async () => {
  const bundle = exportBundle();
  bundle.users.push({ source_user_id: "user-2", email: "second@example.com" });
  bundle.entities.Project[0].created_by = "second@example.com";
  const plan = await makePlan(bundle);
  assert.equal(plan.importable, false);
  assert.ok(codes(plan).includes("entity_reference_owner_mismatch"));
});

test("missing bytes, corrupted bytes and missing referenced entities cannot pass dry-run", async () => {
  const bundle = exportBundle();
  bundle.entities.Asset[0].project_id = "nonexistent";
  delete bundle.files[0].local_path;
  let plan = await makePlan(bundle);
  assert.ok(codes(plan).includes("file_bytes_missing"));
  assert.ok(codes(plan).includes("entity_reference_unmapped"));
  plan = await prepareBase44Import(exportBundle(), { readFileBytes: async () => Buffer.alloc(bytes.length) });
  assert.ok(codes(plan).includes("file_hash_mismatch"));
  assert.equal(plan.importable, false);
});

test("runtime billing/jobs and legacy conversations explicitly require converters", async () => {
  const bundle = exportBundle();
  bundle.entities.AccountEntitlement = [{ id: "entitlement-1", owner_id: "user-1", available_credits: 100 }];
  bundle.entities.Project[0].conversation_id = "legacy-conversation";
  const plan = await makePlan(bundle);
  assert.equal(plan.valid, true);
  assert.equal(plan.importable, false);
  assert.ok(plan.blockers.some((item) => item.code === "runtime_conversion_required"));
  assert.ok(plan.blockers.some((item) => item.code === "conversation_migration_required"));
});

test("malformed identities and missing export sections fail instead of silently skipping data", async () => {
  const bundle = exportBundle();
  bundle.users[0].source_user_id = " user-1 ";
  assert.ok(codes(await makePlan(bundle)).includes("source_id_invalid"));
  delete bundle.users;
  assert.equal((await makePlan(bundle)).importable, false);
});

test("import requires the reviewed digest; mutation after review is rejected before adapters run", async () => {
  const plan = await makePlan();
  const tools = adapters();
  await assert.rejects(executeBase44Import({ plan, expectedDigest: "bad", ...tools }), { code: "import_plan_digest_mismatch" });
  const expectedDigest = plan.digest;
  plan.users[0].role = "admin";
  await assert.rejects(executeBase44Import({ plan, expectedDigest, ...tools }), { code: "import_plan_digest_mismatch" });
  assert.equal(tools.writes(), 0);
});

test("transactional import and rerun reconcile once without duplicate identities or records", async () => {
  const plan = await makePlan();
  const tools = adapters();
  const options = { plan, expectedDigest: plan.digest, ...tools, readFileBytes: async () => bytes };
  assert.equal((await executeBase44Import(options)).status, "imported");
  const writes = tools.writes();
  assert.equal((await executeBase44Import(options)).status, "already_imported");
  assert.equal(tools.writes(), writes);
  assert.equal(tools.snapshot().users.length, 1);
  assert.equal(tools.snapshot().entities.length, 2);
  assert.equal(tools.snapshot().files.length, 1);
  assert.equal(tools.snapshot().receipts.length, 1);
  tools.objects.set(tools.snapshot().files[0].storage_key, Buffer.alloc(bytes.length));
  await assert.rejects(executeBase44Import(options), { code: "import_file_verification_failed" });
});

test("corrupted staging and storage ownership mismatch fail before database inserts", async () => {
  const plan = await makePlan();
  let tools = adapters();
  tools.storage.readPrivate = async () => Buffer.alloc(bytes.length);
  await assert.rejects(executeBase44Import({ plan, expectedDigest: plan.digest, ...tools, readFileBytes: async () => bytes }), { code: "import_file_verification_failed" });
  assert.equal(tools.snapshot().users.length, 0);
  tools = adapters();
  const original = tools.storage.stagePrivate;
  tools.storage.stagePrivate = async (input) => ({ ...await original(input), owner_id: "wrong-owner" });
  await assert.rejects(executeBase44Import({ plan, expectedDigest: plan.digest, ...tools, readFileBytes: async () => bytes }), { code: "import_storage_ownership_invalid" });
  assert.equal(tools.writes(), 0);
});

test("failed reconciliation rolls back users and entities and never records success", async () => {
  const plan = await makePlan();
  const tools = adapters();
  const original = tools.repository.withTransaction;
  tools.repository.withTransaction = (fn) => original((transaction) => fn({ ...transaction, reconcilePlan: async () => ({ matched: false }) }));
  await assert.rejects(executeBase44Import({ plan, expectedDigest: plan.digest, ...tools, readFileBytes: async () => bytes }), { code: "import_reconciliation_failed" });
  assert.deepEqual(tools.snapshot(), { users: [], entities: [], files: [], receipts: [] });
});

test("existing account email conflicts prevent new import without overwriting the account", async () => {
  const plan = await makePlan();
  const tools = adapters();
  const options = { plan, expectedDigest: plan.digest, ...tools, readFileBytes: async () => bytes };
  await executeBase44Import(options);
  const bundle = exportBundle();
  bundle.entities.Project[0].name = "Changed after migration";
  const changedPlan = await makePlan(bundle);
  await assert.rejects(executeBase44Import({ ...options, plan: changedPlan, expectedDigest: changedPlan.digest }), { code: "import_target_conflict" });
  assert.equal(tools.snapshot().entities.find((row) => row.entity_name === "Project").payload.name, "Private project");
});

test("file reader rejects traversal, symlink escape and wrong sizes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "iabt-import-"));
  try {
    const root = join(temporary, "bundle");
    await mkdir(join(root, "files"), { recursive: true });
    await writeFile(join(root, "files", "document.txt"), bytes);
    await writeFile(join(temporary, "outside.txt"), bytes);
    // Directory junctions exercise the same realpath containment boundary on
    // Windows without requiring administrator symlink privileges.
    await mkdir(join(temporary, "outside"));
    await writeFile(join(temporary, "outside", "document.txt"), bytes);
    await symlink(join(temporary, "outside"), join(root, "files", "link"), process.platform === "win32" ? "junction" : "dir");
    const read = await createImportFileReader(root);
    assert.deepEqual(await read({ local_path: "files/document.txt", size_bytes: bytes.length }), bytes);
    await assert.rejects(read({ local_path: "../outside.txt", size_bytes: bytes.length }), { code: "file_path_unsafe" });
    await assert.rejects(read({ local_path: "files/link/document.txt", size_bytes: bytes.length }), { code: "file_path_unsafe" });
    await assert.rejects(read({ local_path: "files/document.txt", size_bytes: 1 }), { code: "file_size_mismatch" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
