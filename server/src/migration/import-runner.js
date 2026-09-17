import { assertReviewedImportPlan, bytesDigest } from "./import-plan.js";

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const verifyBytes = (bytes, file) => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.size_bytes || bytesDigest(bytes) !== file.sha256) {
    fail("import_file_verification_failed", "Private file bytes failed verification");
  }
};

// Adapter contract: withTransaction must rollback on any thrown exception and
// serialize concurrent imports; inspectPlan must detect email/ID collisions and
// compare receipt + persisted records. Writes are insert-only, never upserts.
// Storage stages private, immutable, owner-scoped objects. A failed transaction
// may leave unreferenced objects; never expose or blindly delete those objects.
export const executeBase44Import = async ({ plan, expectedDigest, repository, storage, readFileBytes }) => {
  // Keep the reviewed snapshot stable across awaited adapter calls.
  plan = structuredClone(plan);
  const digest = assertReviewedImportPlan(plan, expectedDigest);
  if (!repository?.withTransaction || !storage?.stagePrivate || !storage?.readPrivate) {
    fail("import_adapter_missing", "Transactional repository and verified private storage adapters are required");
  }
  if (plan.files.length && typeof readFileBytes !== "function") fail("file_reader_required", "Local file bytes are required");
  return repository.withTransaction(async (transaction) => {
    for (const method of ["inspectPlan", "insertUser", "insertEntity", "insertFile", "reconcilePlan", "recordImport"]) {
      if (typeof transaction[method] !== "function") fail("import_adapter_invalid", `Missing transaction method: ${method}`);
    }
    const existing = await transaction.inspectPlan(plan);
    if (!Array.isArray(existing?.conflicts) || typeof existing.alreadyImported !== "boolean") {
      fail("import_inspection_invalid", "Target inspection did not return a complete reconciliation result");
    }
    if (existing?.conflicts?.length) fail("import_target_conflict", "Target records conflict with this migration; no data was overwritten");
    const reconcile = async () => {
      const result = await transaction.reconcilePlan(plan);
      if (!result?.matched || result.digest !== digest || result.users !== plan.users.length ||
          result.entities !== plan.entities.length || result.files !== plan.files.length) {
        fail("import_reconciliation_failed", "Persisted records do not match the reviewed import plan");
      }
    };
    if (existing?.alreadyImported) {
      await reconcile();
      if (!Array.isArray(existing.files) || existing.files.length !== plan.files.length) {
        fail("import_reconciliation_failed", "Previously imported file metadata is missing");
      }
      for (const file of plan.files) {
        const stored = existing.files.find((item) => item.id === file.id);
        if (!stored || stored.owner_id !== file.owner_id || stored.storage_key !== `${file.owner_id}/${file.id}`) {
          fail("import_storage_ownership_invalid", "Previously imported files do not match the expected owner");
        }
        verifyBytes(await storage.readPrivate(stored), file);
      }
      return { status: "already_imported", digest, users: plan.users.length, entities: plan.entities.length, files: plan.files.length };
    }
    const staged = [];
    for (const file of plan.files) {
      const bytes = await readFileBytes(file);
      verifyBytes(bytes, file);
      const stored = await storage.stagePrivate({
        ownerId: file.owner_id, objectId: file.id, bytes,
        contentType: file.content_type, sha256: file.sha256
      });
      if (!stored?.private || stored.owner_id !== file.owner_id || stored.object_id !== file.id ||
          stored.storage_key !== `${file.owner_id}/${file.id}` || !stored.storage_provider) {
        fail("import_storage_ownership_invalid", "Staged file is not private and scoped to the expected owner");
      }
      verifyBytes(await storage.readPrivate(stored), file);
      staged.push({ ...file, storage_key: stored.storage_key, storage_provider: stored.storage_provider });
    }
    for (const user of plan.users) await transaction.insertUser(user);
    for (const entity of plan.entities) await transaction.insertEntity(entity);
    for (const file of staged) await transaction.insertFile(file);
    await reconcile();
    await transaction.recordImport({ digest, source: plan.source });
    return { status: "imported", digest, users: plan.users.length, entities: plan.entities.length, files: plan.files.length };
  });
};
