import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MIGRATION_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

const MIGRATION_FILENAME = /^\d{3}_[a-z0-9_-]+\.sql$/;

export const stripTransactionWrapper = (sql) => {
  const source = String(sql || "");
  if (
    /^\s*BEGIN\s*;/i.test(source) &&
    /COMMIT\s*;\s*$/i.test(source)
  ) {
    return source
      .replace(/^\s*BEGIN\s*;\s*/i, "")
      .replace(/\s*COMMIT\s*;\s*$/i, "")
      .trim();
  }
  return source.trim();
};

export const checksumMigration = (sql) =>
  createHash("sha256").update(String(sql || ""), "utf8").digest("hex");

export const assertMigrationChecksum = (applied, migration) => {
  if (!applied) return;
  if (applied.checksum !== migration.checksum) {
    throw Object.assign(
      new Error(
        `Applied migration ${migration.name} no longer matches its recorded checksum`
      ),
      {
        code: "migration_checksum_mismatch",
        migration: migration.name
      }
    );
  }
};

export const loadMigrations = async ({
  directory = DEFAULT_MIGRATION_DIRECTORY
} = {}) => {
  const names = (await readdir(directory))
    .filter((name) => MIGRATION_FILENAME.test(name))
    .sort((left, right) => left.localeCompare(right));

  if (!names.length) {
    throw Object.assign(new Error("No standalone database migrations were found"), {
      code: "migrations_missing"
    });
  }

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), "utf8");
      return {
        name,
        checksum: checksumMigration(sql),
        sql: stripTransactionWrapper(sql)
      };
    })
  );
};

const getAppliedMigration = async (client, name) => {
  const result = await client.query(
    "SELECT name, checksum FROM iabt_schema_migrations WHERE name = $1 LIMIT 1",
    [name]
  );
  return result.rows[0] || null;
};

export const applyMigrations = async (
  pool,
  { directory = DEFAULT_MIGRATION_DIRECTORY } = {}
) => {
  if (!pool?.query || !pool?.connect) {
    throw new TypeError("A PostgreSQL pool is required to apply migrations");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS iabt_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrations = await loadMigrations({ directory });
  const result = { applied: [], skipped: [], total: migrations.length };

  for (const migration of migrations) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [7400442026]);
      const existing = await getAppliedMigration(client, migration.name);
      assertMigrationChecksum(existing, migration);

      if (existing) {
        result.skipped.push(migration.name);
      } else {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO iabt_schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum]
        );
        result.applied.push(migration.name);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return result;
};
