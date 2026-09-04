import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateBase44Export } from "../server/src/migration/base44-export.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/verify-base44-export.mjs <export-package.json>");
  process.exitCode = 2;
} else {
  try {
    const parsed = JSON.parse(await readFile(resolve(path), "utf8"));
    const report = validateBase44Export(parsed);
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      valid: false,
      errors: [{
        code: "export_package_unreadable",
        message: String(error.message || error)
      }]
    }, null, 2));
    process.exitCode = 1;
  }
}
