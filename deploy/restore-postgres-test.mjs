import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

if (process.env.IABT_RESTORE_CONFIRM !== "RESTORE_DISPOSABLE_DATABASE") {
  throw new Error(
    "Set IABT_RESTORE_CONFIRM=RESTORE_DISPOSABLE_DATABASE to validate a restore"
  );
}

const databaseUrl = String(process.env.IABT_RESTORE_DATABASE_URL || "");
const manifestPath = path.resolve(String(process.env.IABT_BACKUP_MANIFEST || ""));
if (!databaseUrl) throw new Error("IABT_RESTORE_DATABASE_URL is required");
if (!process.env.IABT_BACKUP_MANIFEST) {
  throw new Error("IABT_BACKUP_MANIFEST is required");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const backupPath = path.join(path.dirname(manifestPath), manifest.filename);
const bytes = await readFile(backupPath);
const checksum = createHash("sha256").update(bytes).digest("hex");
if (checksum !== manifest.sha256 || bytes.length !== manifest.size_bytes) {
  throw new Error("Backup checksum or size does not match its manifest");
}

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(
    "pg_restore",
    [
      "--dbname",
      databaseUrl,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      backupPath
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  child.once("error", reject);
  child.once("exit", resolve);
});

if (exitCode !== 0) {
  throw new Error(`pg_restore failed with exit code ${exitCode}`);
}

console.log(
  JSON.stringify({
    event: "iabt_restore_validation_complete",
    filename: manifest.filename,
    sha256: manifest.sha256
  })
);
