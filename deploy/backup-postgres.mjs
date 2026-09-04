import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const databaseUrl = String(process.env.IABT_DATABASE_URL || "");
const requestedDirectory = String(process.env.IABT_BACKUP_DIR || "");

if (!databaseUrl) throw new Error("IABT_DATABASE_URL is required");
if (!requestedDirectory) throw new Error("IABT_BACKUP_DIR is required");

const backupDirectory = path.resolve(requestedDirectory);
if (backupDirectory === path.parse(backupDirectory).root) {
  throw new Error("IABT_BACKUP_DIR cannot be a filesystem root");
}
if (process.env.HOME && backupDirectory === path.resolve(process.env.HOME)) {
  throw new Error("IABT_BACKUP_DIR cannot be the home directory");
}

await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const finalPath = path.join(backupDirectory, `iabt-postgres-${stamp}.dump`);
const temporaryPath = finalPath + ".partial";

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(
    "pg_dump",
    [
      "--dbname",
      databaseUrl,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      temporaryPath
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  child.once("error", reject);
  child.once("exit", resolve);
});

if (exitCode !== 0) {
  throw new Error(`pg_dump failed with exit code ${exitCode}`);
}

await rename(temporaryPath, finalPath);
const bytes = await readFile(finalPath);
const metadata = await stat(finalPath);
const manifest = {
  version: 1,
  created_at: new Date().toISOString(),
  filename: path.basename(finalPath),
  size_bytes: metadata.size,
  sha256: createHash("sha256").update(bytes).digest("hex")
};
const manifestPath = finalPath + ".manifest.json";
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx"
});

console.log(JSON.stringify({ event: "iabt_backup_complete", ...manifest }));
