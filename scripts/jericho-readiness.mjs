import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const READINESS_REQUIREMENTS = Object.freeze([
  { id: "staging_account_access", label: "Existing-account sign-in and inbox verification", evidence_required: "Receive and redeem verification/reset codes on the tested staging commit without duplicating the account." },
  { id: "staging_file_journey", label: "Staging file-to-artifact acceptance", evidence_required: "Upload, reopen, create, verify credit use, download and deny another account against deployed private storage." },
  { id: "staging_worker_recovery", label: "Deployed worker restart and recovery", evidence_required: "Restart or interrupt work and prove resumed state, lease ownership and no duplicate charges or provider requests." },
  { id: "stripe_test_lifecycle", label: "Stripe test payment and entitlement lifecycle", evidence_required: "Verify checkout, signed webhook replay, entitlement, delivery, cancellation, failed payment and refund scenarios in test mode." },
  { id: "migration_reconciliation", label: "Migration reconciliation", evidence_required: "Reconcile source and destination account identities, records, stored files and credit balances." },
  { id: "backup_restore", label: "Backup restoration and file retrieval", evidence_required: "Restore a disposable database backup and retrieve its associated private object bytes with matching hashes." },
  { id: "live_provider_acceptance", label: "Authorized live Responses acceptance", evidence_required: "Use an explicitly approved budget to verify actual provider output, usage and bounded resume behavior." },
  { id: "generated_code_acceptance", label: "Generated software execution and repair", evidence_required: "Verify isolated build, meaningful tests, repair, functional behavior and security for the claimed generated-software workflows." },
  { id: "file_format_acceptance", label: "Supported-file understanding", evidence_required: "Validate extracted meaning and limitations for every advertised source-file format; upload success alone does not establish parsing." },
  { id: "two_account_privacy", label: "Deployed two-account privacy acceptance", evidence_required: "Verify ownership, collaboration consent, signed-link scope, blocking and administrative boundaries on staging." },
  { id: "continuous_hosting", label: "Continuous worker hosting", evidence_required: "Observe the deployed process working while this editor is closed and across its documented idle/restart conditions." },
  { id: "release_acceptance", label: "Staging release and rollback acceptance", evidence_required: "Record exact deployed commit, accepted feature scope, unresolved limitations, rollout approval and successful rollback evidence." }
]);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const codeError = (code) => Object.assign(new Error(code), { code });
const MAX_OUTPUT = 16 * 1024 * 1024;
const validSha = (value) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

export function verificationScripts(packageJson) {
  const commands = String(packageJson?.scripts?.verify || "").split(/\s*&&\s*/);
  if (!commands.length || commands.some((command) => !/^npm run [a-zA-Z0-9:_-]+$/.test(command))) throw codeError("unsupported_verification_contract");
  const scripts = commands.map((command) => command.slice("npm run ".length));
  if (new Set(scripts).size !== scripts.length || scripts.some((name) => typeof packageJson.scripts[name] !== "string")) throw codeError("invalid_verification_contract");
  return scripts;
}

export function disposableDatabaseConfigured(value) {
  if (!value) return false;
  let url;
  try { url = new URL(value); } catch { throw codeError("disposable_test_database_required"); }
  // libpq-style URL query parameters can override host/database fields. No
  // overrides are needed for the disposable local service used by this suite.
  if (url.search || url.hash || !["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname) ||
      !/(?:^|_)test(?:$|_)/.test(decodeURIComponent(url.pathname.slice(1)))) throw codeError("disposable_test_database_required");
  return true;
}

// Only build/test settings enter the subprocess. OpenAI, Stripe, Resend, Neon,
// Render, GitHub tokens and the production application's environment are not
// forwarded to repository verification. No environment values enter reports.
export function verificationEnvironment(input = process.env) {
  disposableDatabaseConfigured(input.IABT_AUTH_TEST_DATABASE_URL);
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "LANG", "LC_ALL", "TZ"];
  const env = Object.fromEntries(allowed.filter((name) => typeof input[name] === "string").map((name) => [name, input[name]]));
  return { ...env, CI: "true", NO_COLOR: "1", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false", VITE_IABT_BACKEND: "standalone", VITE_IABT_API_URL: "https://independent-api.example.test",
    ...(input.IABT_AUTH_TEST_DATABASE_URL ? { IABT_AUTH_TEST_DATABASE_URL: input.IABT_AUTH_TEST_DATABASE_URL } : {}) };
}

export function parseVerification({ scripts, stdout = "", stderr = "", exitCode = null, failureCode = null, postgresConfigured = false }) {
  const lines = stdout.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
  const started = [];
  const blocks = new Map();
  let active = null;
  for (const line of lines) {
    const banner = /^>\s+\S+@\S+\s+([a-zA-Z0-9:_-]+)\s*$/.exec(line);
    if (banner && scripts.includes(banner[1])) {
      active = banner[1];
      started.push(active);
      blocks.set(active, []);
    } else if (active) blocks.get(active).push(line);
  }
  const expectedOrder = started.every((name, index) => scripts[index] === name);
  const complete = exitCode === 0 && !failureCode && expectedOrder && started.length === scripts.length;
  const last = started.at(-1);
  const checks = scripts.map((name) => {
    const index = started.indexOf(name);
    const status = !expectedOrder || index < 0 ? "unknown" : complete || name !== last ? "passed" : exitCode !== null || failureCode ? "failed" : "unknown";
    const output = (blocks.get(name) || []).join("\n");
    const counts = {};
    for (const key of ["tests", "pass", "fail", "skipped", "cancelled"]) {
      const matches = [...output.matchAll(new RegExp("^(?:#|ℹ)\\s+" + key + "\\s+(\\d+)\\s*$", "gm"))];
      if (matches.length) counts[key] = matches.reduce((sum, match) => sum + Number(match[1]), 0);
    }
    return { id: name, scope: "repository", status, evidence: { command: "npm run " + name, started: index >= 0, output_sha256: index >= 0 ? hash(output) : null, ...counts } };
  });
  const standalone = checks.find((check) => check.id === "verify:standalone");
  const serverOutput = (blocks.get("verify:standalone") || []).join("\n");
  const postgresLines = serverOutput.split("\n").filter((line) => /^(?:✔\s+|ok\s+\d+\s+-\s+)postgres(?::|\s+HTTP:)/.test(line));
  const postgresSkipped = postgresLines.filter((line) => /\s+#\s*(?:SKIP|TODO)\b/i.test(line)).length;
  const postgresPassed = postgresLines.length - postgresSkipped;
  const postgresFailed = (serverOutput.match(/^(?:✖\s+|not ok\s+\d+\s+-\s+)postgres(?::|\s+HTTP:)/gm) || []).length;
  const postgres = { id: "postgres_integration", scope: "disposable_local_database", status: postgresFailed ? "failed" : postgresConfigured && standalone?.status === "passed" && postgresPassed > 0 && postgresSkipped === 0 ? "passed" : "unknown", evidence: { configured_for_disposable_local_database: postgresConfigured, observed_passed_tests: postgresPassed, observed_failed_tests: postgresFailed, observed_skipped_tests: postgresSkipped } };
  return {
    status: complete ? "passed" : exitCode !== null && exitCode !== 0 || failureCode ? "failed" : "unknown",
    command: "npm run verify", exit_code: Number.isInteger(exitCode) ? exitCode : null,
    failure_code: failureCode || (!expectedOrder || exitCode === 0 && !complete ? "verification_evidence_incomplete" : null),
    output_sha256: hash(stdout + "\n" + stderr), checks: [...checks, postgres]
  };
}

export function buildReadinessReport({ verification, git = {}, observedAt = new Date().toISOString() }) {
  const commit = validSha(git.commit) ? git.commit : null;
  const exactCommit = Boolean(commit && git.clean === true && git.snapshot_stable === true);
  const source = { commit, worktree: git.clean === true ? "clean" : git.clean === false ? "dirty" : "unknown", snapshot_stable: git.snapshot_stable === true, evidence_scope: exactCommit ? "checked_out_commit" : "working_copy", exact_commit_verified: exactCommit && verification.status === "passed" };
  const external = READINESS_REQUIREMENTS.map((requirement) => ({ ...requirement, scope: "separate_acceptance_required", status: "unknown", reason: "not_established_by_repository_verification" }));
  const checks = [...verification.checks, { id: "source_commit_binding", scope: "repository", status: exactCommit ? "passed" : "unknown", evidence: source }, ...external];
  return {
    schema_version: 1, report_kind: "jericho_repository_readiness", observed_at: observedAt, source,
    verification: { status: verification.status, command: verification.command, exit_code: verification.exit_code, failure_code: verification.failure_code, output_sha256: verification.output_sha256 },
    checks, blockers: checks.filter((check) => check.status !== "passed").map((check) => ({ id: check.id, status: check.status })),
    launch_ready: false, release_decision: "requires_separate_staging_acceptance", authorizes_deployment: false,
    boundaries: ["Local regression evidence is not live service, provider billing, inbox, feature-completeness or production acceptance evidence.", "Unknown checks must remain unknown until the required test actually runs.", "This report does not repair code, purchase services, send external messages, merge branches or deploy."]
  };
}

export function readinessMarkdown(report) {
  const lines = ["# JERICHO repository readiness", "", `Observed: ${report.observed_at}`, `Commit: ${report.source.commit || "unknown"} (${report.source.worktree} working tree)`, "", `Repository verification: **${report.verification.status}**`, "Release readiness: **separate staging acceptance required**. No deployment is authorized.", "", "| Check | Scope | Status |", "| --- | --- | --- |", ...report.checks.map((check) => `| ${check.label || check.id} | ${check.scope} | ${check.status} |`), "", "## Acceptance evidence still required", "", ...READINESS_REQUIREMENTS.map((item) => `- **${item.label}:** ${item.evidence_required}`), "", ...report.boundaries.map((item) => `- ${item}`), ""];
  return lines.join("\n");
}

async function findNpmCli(explicit) {
  const candidates = [explicit, process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")].filter(Boolean);
  for (const candidate of candidates) {
    if (path.basename(candidate) !== "npm-cli.js") continue;
    try { await access(candidate); return path.resolve(candidate); } catch { /* Try the next installed npm runtime. */ }
  }
  throw codeError("npm_cli_unavailable");
}

export function runBoundedCommand(command, args, { cwd, env, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    let bytes = 0, failureCode = null;
    const stop = (code) => {
      if (failureCode) return;
      failureCode = code;
      if (!child.pid) return;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(() => stop("verification_timeout"), timeoutMs);
    const collect = (chunks) => (chunk) => { bytes += chunk.length; if (bytes > MAX_OUTPUT) stop("verification_output_limit"); else chunks.push(chunk); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.on("error", () => { failureCode = "verification_start_failed"; });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode, failureCode });
    });
  });
}

async function gitEvidence(cwd, gitExecutable, env) {
  const config = ["-c", `safe.directory=${cwd.replaceAll("\\", "/")}`];
  const revision = await runBoundedCommand(gitExecutable, [...config, "rev-parse", "HEAD"], { cwd, env, timeoutMs: 10000 });
  const status = await runBoundedCommand(gitExecutable, [...config, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).jericho/reports"], { cwd, env, timeoutMs: 10000 });
  return { commit: validSha(revision.stdout.trim()) && revision.exitCode === 0 ? revision.stdout.trim() : null, clean: status.exitCode === 0 ? status.stdout.trim().length === 0 : null };
}

export async function runReadiness({ cwd = process.cwd(), outputDirectory = ".jericho/reports", npmCli, gitExecutable = "git", env = process.env, commandRunner = runBoundedCommand } = {}) {
  const root = path.resolve(cwd);
  const target = path.resolve(root, outputDirectory);
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const scripts = verificationScripts(packageJson);
  const gitEnv = verificationEnvironment({ ...env, IABT_AUTH_TEST_DATABASE_URL: undefined });
  const before = await gitEvidence(root, gitExecutable, gitEnv);
  let result = { stdout: "", stderr: "", exitCode: null, failureCode: null }, testEnv, postgresConfigured = false;
  try {
    testEnv = verificationEnvironment(env);
    postgresConfigured = disposableDatabaseConfigured(env.IABT_AUTH_TEST_DATABASE_URL);
    const cli = await findNpmCli(npmCli);
    result = await commandRunner(process.execPath, [cli, "run", "verify"], { cwd: root, env: testEnv });
  } catch (error) {
    result.failureCode = ["disposable_test_database_required", "npm_cli_unavailable"].includes(error?.code) ? error.code : "verification_start_failed";
  }
  const verification = parseVerification({ scripts, ...result, postgresConfigured });
  const after = await gitEvidence(root, gitExecutable, gitEnv);
  const git = { commit: before.commit, clean: before.clean === false || after.clean === false ? false : before.clean === true && after.clean === true ? true : null, snapshot_stable: Boolean(before.commit && before.commit === after.commit && before.clean === true && after.clean === true) };
  const report = buildReadinessReport({ verification, git });
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "readiness.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(target, "readiness.md"), readinessMarkdown(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = { "--output-dir": "outputDirectory", "--npm-cli": "npmCli", "--git": "gitExecutable" }[process.argv[index]];
    if (!name || !process.argv[index + 1]) throw codeError("invalid_readiness_argument");
    options[name] = process.argv[index + 1];
  }
  try {
    const report = await runReadiness(options);
    // Only fixed identifiers and statuses enter stdout; raw test errors and
    // environment contents are deliberately not printed or written to artifacts.
    process.stdout.write(`JERICHO repository verification: ${report.verification.status}. Staging acceptance remains unverified.\n`);
    process.exitCode = report.verification.status === "passed" ? 0 : 1;
  } catch {
    process.stderr.write("JERICHO readiness reporting could not complete. No release readiness was established.\n");
    process.exitCode = 1;
  }
}
