import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertMigrationChecksum,
  checksumMigration,
  loadMigrations,
  stripTransactionWrapper
} from "../src/migrations.js";

test("migration loader orders files and strips only the outer transaction", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "iabt-migrations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeFile(
    path.join(directory, "002_second.sql"),
    "BEGIN;\nCREATE TABLE second_table (id text);\nCOMMIT;\n"
  );
  await writeFile(
    path.join(directory, "001_first.sql"),
    "BEGIN;\nCREATE TABLE first_table (id text);\nCOMMIT;\n"
  );
  await writeFile(path.join(directory, "notes.txt"), "ignored");

  const migrations = await loadMigrations({ directory });
  assert.deepEqual(
    migrations.map((migration) => migration.name),
    ["001_first.sql", "002_second.sql"]
  );
  assert.equal(migrations[0].sql, "CREATE TABLE first_table (id text);");
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
});

test("migration checksums are stable and altered history fails closed", () => {
  const original = checksumMigration("CREATE TABLE example (id text);");
  const changed = checksumMigration("CREATE TABLE example (id bigint);");
  assert.equal(original, checksumMigration("CREATE TABLE example (id text);"));
  assert.notEqual(original, changed);

  assert.throws(
    () =>
      assertMigrationChecksum(
        { checksum: original },
        { name: "001_core.sql", checksum: changed }
      ),
    (error) =>
      error.code === "migration_checksum_mismatch" &&
      error.migration === "001_core.sql"
  );
});

test("unwrapped SQL remains executable SQL", () => {
  const sql = "CREATE INDEX example_idx ON example (id);";
  assert.equal(stripTransactionWrapper(sql), sql);
});
