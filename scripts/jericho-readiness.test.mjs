import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { READINESS_REQUIREMENTS, verificationScripts, disposableDatabaseConfigured, verificationEnvironment, parseVerification, buildReadinessReport, readinessMarkdown, runBoundedCommand, runReadiness } from "./jericho-readiness.mjs";

const scripts = ["lint", "verify:standalone", "build"];
const output = [
  "> iabt@1.0.0 lint", "> eslint .", "lint success",
  "> iabt@1.0.0 verify:standalone", "> node --test test/*.test.js",
  "✔ postgres: durable recovery passes (1ms)", "✔ postgres HTTP: persisted lifecycle (2ms)", "ℹ tests 2", "ℹ pass 2", "ℹ fail 0", "ℹ skipped 0",
  "> iabt@1.0.0 build", "> vite build", "built"
].join("\n");
const passed = () => parseVerification({ scripts, stdout: output, exitCode: 0, postgresConfigured: true });

test("readiness follows the actual existing verification script contract and rejects ambiguous command lists", () => {
  const packageJson = { scripts: { verify: "npm run lint && npm run build", lint: "eslint .", build: "vite build" } };
  assert.deepEqual(verificationScripts(packageJson), ["lint", "build"]);
  assert.throws(() => verificationScripts({ scripts: { ...packageJson.scripts, verify: "echo verified" } }), { code: "unsupported_verification_contract" });
  assert.throws(() => verificationScripts({ scripts: { ...packageJson.scripts, verify: "npm run lint && npm run lint" } }), { code: "invalid_verification_contract" });
  assert.throws(() => verificationScripts({ scripts: { verify: "npm run missing" } }), { code: "invalid_verification_contract" });
});

test("readiness accepts only disposable local PostgreSQL and strips production credentials from verification", () => {
  assert.equal(disposableDatabaseConfigured(undefined), false);
  assert.equal(disposableDatabaseConfigured("postgresql://test:test@127.0.0.1:5432/iabt_test"), true);
  for (const value of ["postgresql://private-secret@neon.example/iabt_test", "postgresql://test@localhost/production", "not a URL", "https://localhost/iabt_test", "postgresql://localhost/iabt_test?host=production.example", "postgresql://localhost/iabt_test?dbname=production"]) {
    assert.throws(() => disposableDatabaseConfigured(value), { code: "disposable_test_database_required" });
  }
  const env = verificationEnvironment({ PATH: "test-path", NODE_ENV: "production", OPENAI_API_KEY: "sensitive-openai", STRIPE_SECRET_KEY: "sensitive-stripe", RESEND_API_KEY: "sensitive-resend", IABT_DATABASE_URL: "sensitive-production", GITHUB_TOKEN: "sensitive-github", NODE_OPTIONS: "unsafe-preload", IABT_AUTH_TEST_DATABASE_URL: "postgresql://test@localhost/iabt_test" });
  assert.equal(env.PATH, "test-path");
  assert.equal(env.VITE_IABT_BACKEND, "standalone");
  assert.equal(env.IABT_AUTH_TEST_DATABASE_URL, "postgresql://test@localhost/iabt_test");
  for (const key of ["OPENAI_API_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "IABT_DATABASE_URL", "GITHUB_TOKEN", "NODE_OPTIONS", "NODE_ENV"]) assert.equal(Object.hasOwn(env, key), false, key);
});

test("passed repository commands and observed PostgreSQL tests form bounded structured evidence", () => {
  const verification = passed();
  assert.equal(verification.status, "passed");
  assert.ok(verification.checks.every((check) => check.status === "passed"));
  assert.equal(verification.checks[1].evidence.tests, 2);
  assert.equal(verification.checks[1].evidence.pass, 2);
  assert.equal(verification.checks[3].evidence.observed_passed_tests, 2);
  assert.match(verification.output_sha256, /^[a-f0-9]{64}$/);
});

test("readiness cannot claim checks skipped after a failure or omitted without a test database", () => {
  const failed = parseVerification({ scripts, stdout: "> iabt@1.0.0 lint\n> eslint .\nlint failed", stderr: "PRIVATE ERROR CONTENT", exitCode: 1 });
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.checks.map((check) => check.status), ["failed", "unknown", "unknown", "unknown"]);
  assert.equal(JSON.stringify(failed).includes("PRIVATE ERROR CONTENT"), false);
  const noDatabase = parseVerification({ scripts, stdout: output, exitCode: 0, postgresConfigured: false });
  assert.equal(noDatabase.status, "passed");
  assert.equal(noDatabase.checks.at(-1).status, "unknown");
  const skippedDatabase = parseVerification({ scripts, stdout: output.replaceAll(/^✔ postgres.*$/gm, "ok 1 - postgres: unused # SKIP"), exitCode: 0, postgresConfigured: true });
  // A TAP skipped test is not a passed database execution.
  assert.equal(skippedDatabase.checks.at(-1).status, "unknown");
});

test("missing, reordered or interrupted verification output never establishes success", () => {
  assert.equal(parseVerification({ scripts, stdout: "all checks passed", exitCode: 0 }).status, "unknown");
  const reordered = parseVerification({ scripts, stdout: output.replace("> iabt@1.0.0 lint", "> iabt@1.0.0 build"), exitCode: 0 });
  assert.equal(reordered.status, "unknown");
  assert.ok(reordered.checks.every((check) => check.status === "unknown"));
  const interrupted = parseVerification({ scripts, stdout: "> iabt@1.0.0 lint", exitCode: null, failureCode: "verification_timeout" });
  assert.equal(interrupted.status, "failed");
  assert.equal(interrupted.failure_code, "verification_timeout");
});

test("green local tests never promote staging or release gates and dirty trees do not verify a commit", () => {
  const clean = buildReadinessReport({ verification: passed(), git: { commit: "a".repeat(40), clean: true, snapshot_stable: true }, observedAt: "2026-09-20T12:00:00.000Z" });
  assert.equal(clean.source.exact_commit_verified, true);
  assert.equal(clean.launch_ready, false);
  assert.equal(clean.authorizes_deployment, false);
  assert.equal(clean.checks.filter((check) => check.scope === "separate_acceptance_required").length, READINESS_REQUIREMENTS.length);
  assert.ok(clean.checks.filter((check) => check.scope === "separate_acceptance_required").every((check) => check.status === "unknown"));
  const failed = buildReadinessReport({ verification: { ...passed(), status: "failed" }, git: { commit: "a".repeat(40), clean: true, snapshot_stable: true } });
  assert.equal(failed.source.exact_commit_verified, false);
  assert.equal(failed.checks.find((check) => check.id === "source_commit_binding").status, "passed");
  for (const git of [{ commit: "a".repeat(40), clean: false, snapshot_stable: false }, { commit: "a".repeat(40), clean: true, snapshot_stable: false }, { commit: "not-a-sha", clean: true, snapshot_stable: true }]) {
    const report = buildReadinessReport({ verification: passed(), git });
    assert.equal(report.source.exact_commit_verified, false);
    assert.equal(report.checks.find((check) => check.id === "source_commit_binding").status, "unknown");
  }
  const markdown = readinessMarkdown(clean);
  assert.match(markdown, /separate staging acceptance required/);
  assert.match(markdown, /Existing-account sign-in and inbox verification/);
});

test("bounded command failures report only fixed status codes and timeouts terminate their child", async () => {
  const result = await runBoundedCommand(process.execPath, ["-e", "process.stdout.write('test-output');process.exitCode=3"], { timeoutMs: 5000 });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "test-output");
  const timeout = await runBoundedCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 });
  assert.equal(timeout.failureCode, "verification_timeout");
});

test("readiness runner writes safe JSON and Markdown while running the complete command exactly once", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "jericho-readiness-fixture-"));
  t.after(async () => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ scripts: { verify: scripts.map((name) => "npm run " + name).join(" && "), lint: "unused", "verify:standalone": "unused", build: "unused" } }));
  const npmCli = path.join(directory, "npm-cli.js");
  await writeFile(npmCli, "// The injected command runner prevents execution of this fixture.\n");
  let calls = 0;
  const report = await runReadiness({ cwd: directory, npmCli, gitExecutable: "git-binary-that-does-not-exist", env: { ...process.env, OPENAI_API_KEY: "SECRET-MUST-NOT-LEAK", IABT_AUTH_TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1/iabt_test" }, commandRunner: async (_command, args, options) => {
    calls++;
    assert.deepEqual(args.slice(-2), ["run", "verify"]);
    assert.equal(Object.hasOwn(options.env, "OPENAI_API_KEY"), false);
    return { stdout: output, stderr: "SECRET-MUST-NOT-LEAK", exitCode: 0 };
  } });
  assert.equal(calls, 1);
  assert.equal(report.verification.status, "passed");
  assert.equal(report.source.exact_commit_verified, false);
  const json = await readFile(path.join(directory, ".jericho/reports/readiness.json"), "utf8");
  const markdown = await readFile(path.join(directory, ".jericho/reports/readiness.md"), "utf8");
  assert.deepEqual(JSON.parse(json), report);
  for (const text of [json, markdown]) {
    assert.equal(text.includes("SECRET-MUST-NOT-LEAK"), false);
    assert.equal(text.includes("postgresql://"), false);
  }
});
