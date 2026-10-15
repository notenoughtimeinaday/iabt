import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createFrontendConfig } from "./frontend-config.mjs";
import { createZip } from "../server/src/creation/zip.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { maxBuffer: 64 * 1024 * 1024 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--output-dir" || args[2] !== "--api-origin") {
  throw new Error("Usage: node scripts/package-release.mjs --output-dir <new folder> --api-origin <preview API origin>");
}
const destination = path.resolve(args[1]);
process.chdir(root);
if (destination === root || destination.startsWith(root + path.sep)) throw new Error("Package outside the source checkout.");
if (git("status", "--porcelain", "--untracked-files=all").toString().trim()) throw new Error("Commit and verify the source before packaging; the checkout must be clean.");
const commit = git("rev-parse", "HEAD").toString().trim();
const paths = git("ls-files", "-z").toString().split("\0").filter(Boolean);
// Only the committed snapshot enters source.zip. Refuse accidental credentials,
// account exports, dependency folders or build/diagnostic output even if tracked.
for (const name of paths) {
  if (/(^|\/)(node_modules|\.git|outputs|logs)(\/|$)|(^|\/)\.env($|\.)|\.(?:pem|p12|pfx|jks|key|dump|backup)$/i.test(name)) {
    throw new Error(`Review excluded release path before packaging: ${name}`);
  }
}
const product = JSON.parse(await readFile(path.join(root, "release/product.json"), "utf8"));
const config = await createFrontendConfig({ root, env: { VITE_IABT_BACKEND: "standalone", VITE_IABT_ROUTING: "hash", VITE_IABT_API_URL: args[3] } });
const built = await build({ ...config, configFile: false, envFile: false, logLevel: "warn", build: { write: false } });
const files = {};
for (const item of built.output) files[`frontend/${item.fileName}`] = Buffer.from(item.type === "chunk" ? item.code : item.source);
for (const name of paths.filter(name => name.startsWith("public/"))) {
  files[`frontend/${name.slice(7)}`] = git("show", `${commit}:${name}`);
}
for (const name of ["START-HERE.html", "OWNER-RELEASE.md", "product.json"]) files[name] = await readFile(path.join(root, "release", name));
files["source.zip"] = git("archive", "--format=zip", commit);

const licenses = new Map();
async function collectLicenses(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const packagePath = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) { await collectLicenses(packagePath); continue; }
    const metadata = JSON.parse(await readFile(path.join(packagePath, "package.json"), "utf8"));
    const key = `${metadata.name}@${metadata.version}`;
    if (!licenses.has(key)) {
      const names = (await readdir(packagePath)).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name)).sort();
      const texts = [];
      for (const name of names) {
        try { texts.push(`--- ${name} ---\n${await readFile(path.join(packagePath, name), "utf8")}`); }
        catch (error) { if (error.code !== "EISDIR") throw error; }
      }
      licenses.set(key, `${key}\nLicense metadata: ${JSON.stringify(metadata.license || metadata.licenses || "not declared")}\n${texts.join("\n") || "No top-level license text found; inspect the upstream package before redistributing."}`);
    }
    await collectLicenses(path.join(packagePath, "node_modules"));
  }
}
await collectLicenses(path.join(root, "node_modules"));
await collectLicenses(path.join(root, "server/node_modules"));
files["THIRD-PARTY-NOTICES.txt"] = Buffer.from("Installed frontend/server dependency notices, including build and historical compatibility dependencies. Presence does not mean a package is in the standalone browser bundle.\n\n" + [...licenses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join("\n\n====================\n\n"));
if (git("rev-parse", "HEAD").toString().trim() !== commit || git("status", "--porcelain", "--untracked-files=all").toString().trim()) throw new Error("Source changed during packaging.");
const manifest = { schema_version: 1, product: product.name, version: product.version, source_commit: commit,
  created_at: new Date().toISOString(), channel: product.channel, public_sale_approved: false,
  frontend_api_origin: new URL(args[3]).origin, frontend_routing: "hash", dependency_notice_count: licenses.size,
  files: Object.keys(files).sort().map(name => ({ path: name, bytes: files[name].length, sha256: hash(files[name]) })) };
files["manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
await mkdir(destination); // Refuse overwriting a prior release.
for (const [name, bytes] of Object.entries(files)) {
  await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
  await writeFile(path.join(destination, name), bytes, { flag: "wx" });
}
const archive = createZip(files);
const archivePath = destination + ".zip";
await writeFile(archivePath, archive, { flag: "wx" });
console.log(JSON.stringify({ archive: archivePath, sha256: hash(archive), bytes: archive.length, files: Object.keys(files).length, source_commit: commit, public_sale_approved: false }, null, 2));
