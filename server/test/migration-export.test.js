import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBase44Export } from "../src/migration/base44-export.js";

const hash = "a".repeat(64);

test("migration package validator produces stable reconciliation counts and digests", () => {
  const report = validateBase44Export({
    schema_version: 1,
    source_app_id: "6a849bcd3e04d068553b4af7",
    exported_at: "2026-09-04T12:00:00.000Z",
    users: [
      { source_user_id: "base44-user-1", email: "owner@example.com" }
    ],
    entities: {
      Project: [
        { id: "project-1", owner_id: "base44-user-1", name: "Piano" }
      ],
      CreationArtifact: [
        { id: "artifact-1", owner_id: "base44-user-1", name: "piano.zip" }
      ]
    },
    files: [
      {
        source_file_id: "file-1",
        owner_id: "base44-user-1",
        filename: "piano.zip",
        size_bytes: 1024,
        sha256: hash
      }
    ],
    counts: {
      users: 1,
      files: 1,
      entities: { Project: 1, CreationArtifact: 1 }
    }
  });
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
  assert.equal(report.reconciliation.user_count, 1);
  assert.equal(report.reconciliation.entity_record_count, 2);
  assert.equal(report.reconciliation.file_count, 1);
  assert.equal(report.reconciliation.total_file_bytes, 1024);
  assert.match(report.reconciliation.entity_identity_digest, /^[a-f0-9]{64}$/);
});

test("migration package validator rejects credentials, duplicates, and bad file evidence", () => {
  const report = validateBase44Export({
    schema_version: 1,
    source_app_id: "6a849bcd3e04d068553b4af7",
    exported_at: "2026-09-04T12:00:00.000Z",
    users: [
      { source_user_id: "duplicate-user", email: "owner@example.com" },
      { source_user_id: "duplicate-user", email: "owner@example.com" }
    ],
    entities: {
      IntegrationConnection: [
        {
          id: "connection-1",
          owner_id: "missing-user",
          api_key: "must-not-be-exported"
        }
      ]
    },
    files: [
      {
        source_file_id: "file-1",
        owner_id: "duplicate-user",
        size_bytes: -1,
        sha256: "not-a-hash"
      }
    ],
    counts: { users: 99, files: 2 }
  });
  assert.equal(report.valid, false);
  const codes = new Set(report.errors.map((item) => item.code));
  assert.equal(codes.has("user_id_duplicate"), true);
  assert.equal(codes.has("user_email_duplicate"), true);
  assert.equal(codes.has("credential_field_forbidden"), true);
  assert.equal(codes.has("file_sha256_invalid"), true);
  assert.equal(codes.has("file_size_invalid"), true);
  assert.equal(codes.has("user_count_mismatch"), true);
  assert.equal(codes.has("file_count_mismatch"), true);
  assert.equal(
    report.warnings.some((item) => item.code === "record_owner_unmapped"),
    true
  );
});
