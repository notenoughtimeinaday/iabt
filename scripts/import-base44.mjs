import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prepareBase44Import, summarizeImportPlan } from "../server/src/migration/import-plan.js";
import { createImportFileReader } from "../server/src/migration/import-files.js";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith("--")) {
  console.error("Usage: node scripts/import-base44.mjs <export-package.json>\nDry-run only: validates records and private file bytes without connecting to a database.");
  process.exitCode = 2;
} else {
  try {
    const path = resolve(args[0]);
    if ((await stat(path)).size > 64 * 1024 * 1024) throw Object.assign(new Error(), { code: "export_package_too_large" });
    const bundle = JSON.parse(await readFile(path, "utf8"));
    const readFileBytes = await createImportFileReader(dirname(path));
    const plan = await prepareBase44Import(bundle, { readFileBytes });
    console.log(JSON.stringify(summarizeImportPlan(plan), null, 2));
    if (!plan.importable) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, importable: false, mutation_performed: false, errors: [{ code: error.code || "export_package_unreadable" }] }, null, 2));
    process.exitCode = 1;
  }
}
