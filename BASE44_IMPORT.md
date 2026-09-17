# Offline Base44 migration preflight

`node scripts/import-base44.mjs /private/export/package.json` performs a read-only
preflight. It does not connect to Base44, PostgreSQL, an email provider, or object
storage. Exit code 0 means this package passes the supported import checks; it
does not mean data has been imported or that deployment is ready. Exit code 1
means errors or missing converters; exit code 2 means invalid command usage.

Supply the existing version-1 export format with explicit `users`, `entities`,
and `files` sections. Each file must additionally name a relative `local_path`
inside the export directory. Export the actual private file bytes, not just a
download URL. `source_uri` and `source_url` identify old file references to rewrite
to the standalone `iabt-file:<UUID>` form. Keep this directory private and stable
while reviewing; it contains personal data and project content. Do not commit it.

Preflight checks:

- User/entity IDs map deterministically; email addresses are normalized.
- `owner_id` and `user_id` must agree when both are provided. Otherwise an exact
  exported creator ID/email must resolve the owner. Missing owners stop import.
- Known user, project, artifact, plan and job references must resolve inside the
  package. Private file references require bytes owned by that same user.
- Every file's size and SHA-256 must match its bytes. Relative traversal and
  symlink escapes are rejected. The default file limit is 256 MiB.
- Passwords and credential-bearing fields anywhere in the package are rejected.
  Imported accounts receive the existing `migration:reset-required` sentinel,
  unverified email status, and user privileges. Legacy passwords, sessions,
  verification assertions and administrator roles are never trusted or copied.
- The printed report includes counts, error locations and a review digest, without
  emails, project content, filenames or secret values. The in-memory full plan is
  private and must not be included in application logs.

## Explicit limits

The CLI is **dry-run only**; it has no `--apply` option. The runner in
`server/src/migration/import-runner.js` defines a transactional adapter contract,
but this change does not supply a production PostgreSQL import adapter or a
private immutable storage staging adapter. No live import has been performed.

Only Project, Asset, CreationArtifact and PolicyAcceptance generic records are
eligible for this first importer. Other nonempty entity collections produce
`runtime_conversion_required` blockers. In particular, credit balances, credit
ledger history, provider commitments, pending generation jobs, billing state,
Exchange sharing rules, integration credentials and conversation histories need
their own reviewed conversions and reconciliation. Copying those into generic
entity storage would not make their operational behavior work. Nonempty legacy
conversation links are therefore also blockers. Do not remove a blocked section
from an export to claim a complete migration; complete the relevant converter.

The reference rewrite recognizes the fields in `import-plan.js`; additional
application-specific relationship fields require explicit mapping and fixtures.
Source export completeness must be compared with Base44's source inventory; the
runner cannot prove that an omitted source collection never existed.

## Persistence adapter contract

`executeBase44Import` requires a reviewed digest, a file-byte reader, a repository
adapter and a storage adapter. A changed plan or file cannot reuse a prior review.

`repository.withTransaction(callback)` must serialize competing imports, execute
all database operations on one transaction, and roll back on any thrown exception.
The transaction exposes:

| Method | Required behavior |
| --- | --- |
| `inspectPlan(plan)` | Check identity/email/ID collisions and durable import receipt; return `{conflicts, alreadyImported, files}`. Never silently attach an imported identity to an existing account. |
| `insertUser(user)` | Insert deterministic identity with the reset-required sentinel; no upsert, grants or emailed links. |
| `insertEntity(record)` | Insert owner-scoped payload with original timestamps; never overwrite existing records. |
| `insertFile(file)` | Insert verified stored-object metadata and its owner. |
| `reconcilePlan(plan)` | Compare persisted identifiers, owners, payloads and file hashes; return `{matched, digest, users, entities, files}`. A count-only comparison is insufficient. |
| `recordImport({digest, source})` | Insert a durable receipt in the same transaction only after reconciliation. |

`storage.stagePrivate({ownerId, objectId, bytes, contentType, sha256})` must enforce
private storage and immutable create-if-absent semantics. If an object already
exists, verify its bytes instead of overwriting it. It returns
`{private: true, owner_id, object_id, storage_provider, storage_key}` with an
exact `<ownerId>/<objectId>` key. `readPrivate(record)` must read the stored bytes
for independent SHA-256 verification. Existing application `put` methods alone
do not satisfy this contract: S3 needs immutable conditional writes and readback.

The runner stages and reads back files before inserting database records, then
reconciles and commits atomically. Reruns require the same receipt, verify existing
records and read back private bytes again, and do not create duplicate users or
records. A failed database transaction can leave private unreferenced staged
objects; retain them for verified retry and use a separately reviewed orphan
cleanup process. Never delete shared storage objects as rollback compensation.

After these adapters and converters are implemented, prove the import first on
an isolated staging database with a real export, reconcile counts and relationships,
test email recovery for imported accounts, verify two-account file isolation, and
validate backups/restore before changing production DNS.
