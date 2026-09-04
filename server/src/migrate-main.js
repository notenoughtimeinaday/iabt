import pg from "pg";
import { loadConfig } from "./config.js";
import { applyMigrations } from "./migrations.js";

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error("IABT_DATABASE_URL is required to run PostgreSQL migrations");
}

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10000,
  ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl)
    ? undefined
    : { rejectUnauthorized: true }
});

try {
  const result = await applyMigrations(pool);
  console.log(
    JSON.stringify({
      event: "iabt_migrations_complete",
      applied: result.applied,
      skipped: result.skipped,
      total: result.total
    })
  );
} finally {
  await pool.end();
}
