import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createCreationPlan, executeCreationPlan } from "../src/creation/planner.js";
import { buildWebAppArtifacts, prepareWebAppHtml } from "../src/creation/web-app.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { createJobWorker } from "../src/worker.js";
import { createIabtHandler } from "../src/app.js";
import { createOpaqueToken, hashToken } from "../src/security.js";

const html = (label = "Keep this behavior") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Counter</title><style>body{font:20px system-ui}</style></head><body><h1>${label}</h1><button id="add">Add one</button><output id="count">0</output><script>document.getElementById('add').onclick=function(){document.getElementById('count').value=Number(document.getElementById('count').value)+1};</script></body></html>`;
const toolCall = (name, args, id) => ({ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) });
const response = (id, output = []) => ({ id, status: "completed", output });

async function fixture({ ai = true, profile = "core", role = "user" } = {}) {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "builder@example.test", passwordHash: "unused", emailVerified: true, role });
  await repository.grantCredits({ ownerId: user.id, amount: 20, idempotencyKey: "opening" });
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "web-app-test-only", IABT_CREATION_PROFILE: profile,
    ...(ai ? { OPENAI_API_KEY: "not-a-live-key", IABT_ENABLE_PAID_AI: "true", IABT_ENABLE_ORCHESTRATION: "true", IABT_ORCHESTRATION_BUDGET_ACCEPTED: "true", IABT_OPENAI_RESPONSE_COST_CENTS: "2", IABT_ORCHESTRATION_BUDGET_CENTS: "12" } : {}) });
  const objects = new Map();
  const storage = { kind: "test", health: async () => ({ ok: true }), async put({ ownerId, objectId, bytes }) { const key = ownerId + "/" + objectId; objects.set(key, Buffer.from(bytes)); return { storage_provider: "test", storage_key: key }; }, async read(key) { return objects.get(key); }, async createReadUrl(record) { return "https://example.invalid/private/" + record.id; } };
  const replies = [], calls = [];
  const providers = createProviderRegistry(config, { fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body || "{}") }); const next = replies.shift(); if (next instanceof Error) throw next; assert.ok(next, "Unexpected provider call"); return Response.json(next); } });
  const context = { repository, user, config, storage, providers };
  const worker = createJobWorker({ ...context, workerId: "web-app-worker" });
  const plan = (extra = {}) => createCreationPlan({ ...context, requestText: "Build a counter app", ...extra });
  const execute = (plan, extra = {}) => executeCreationPlan({ ...context, ...extra, body: { plan_id: plan.id, approved: true, pricing_version: plan.pricing_version, accepted_total_cents: plan.total_estimated_cost_cents } });
  const upload = async (text = html(), owner = user) => { const id = randomUUID(), bytes = Buffer.from(text); const stored = await storage.put({ ownerId: owner.id, objectId: id, bytes }); return repository.createStoredObject({ id, ownerId: owner.id, storageProvider: stored.storage_provider, storageKey: stored.storage_key, originalName: "Counter.html", contentType: "text/html", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }); };
  const drain = async () => { for (let i = 0; i < 30; i++) { for (const job of repository.jobs.values()) job.available_at = "2000-01-01T00:00:00.000Z"; const result = await worker.runOnce(); if (!result || ["succeeded", "failed", "needs_setup"].includes(result.job.status)) return result; } throw new Error("Worker did not finish"); };
  return { ...context, calls, replies, objects, worker, plan, execute, upload, drain };
}

test("the core profile rejects new extended plans without charges; advanced requires an administrator", async () => {
  for (const role of ["user", "admin"]) {
    const f = await fixture({ ai: false, role });
    for (const requestText of ["Create a video", "Create a music track", "Create an image", "Make a CNC toolpath", "Automate a webhook workflow"]) await assert.rejects(f.plan({ requestText, automatic: true }), { code: "creation_feature_paused" });
    assert.equal((await f.repository.listJobs(f.user)).length, 0);
    assert.equal((await f.repository.listRecords("CreationPlan", f.user)).length, 0);
    assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
  }
  const customer = await fixture({ ai: false, profile: "advanced" });
  await assert.rejects(customer.plan({ requestText: "Create a video" }), { code: "creation_feature_paused" });
  const admin = await fixture({ ai: false, profile: "advanced", role: "admin" });
  assert.equal((await admin.plan({ requestText: "Create a video" })).plan.intent, "video");
});

test("unavailable custom creation offers named starters instead of billing a generic app", async () => {
  const f = await fixture({ ai: false });
  await assert.rejects(f.plan({ automatic: true }), (error) => error.code === "app_creation_unavailable" && /piano.*storefront.*task-list/.test(error.message));
  const { job, plan } = await f.plan({ requestText: "Create a task-list starter", automatic: true });
  assert.equal(plan.normalized_spec.starter_id, "task_list");
  assert.equal(plan.title, "My task list");
  const completed = await f.drain();
  assert.equal(completed.job.id, job.id);
  const preview = completed.artifacts.find((item) => /\.html$/.test(item.original_name));
  assert.match(f.objects.get(preview.storage_key).toString(), /Clear completed/);
  assert.equal(completed.job.output.provider_metadata.delivery_mode, "named_starter");
  assert.equal(completed.job.output.provider_metadata.objective_completed, false);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 19);
  await assert.rejects(f.plan({ requestText: "Build a task tracker with shared accounts and team permissions", automatic: true }), { code: "app_creation_unavailable" });
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal((await f.plan({ requestText: 'Create a task-list starter named "Garden jobs"' })).plan.title, "Garden jobs");
});

test("explicit starters remain provider-free with AI configured and old extended jobs still finish after switching to core", async () => {
  const f = await fixture();
  const starter = await f.plan({ requestText: "Create a task-list starter", automatic: true });
  assert.equal(starter.plan.provider_cost_cents, 0);
  assert.equal(starter.plan.job_type, "creation.interactive");
  assert.equal((await f.drain()).job.status, "succeeded");
  assert.equal(f.calls.length, 0);
  const advanced = await fixture({ profile: "advanced", role: "admin", ai: false });
  const quoted = await advanced.plan({ requestText: "Create an automation runbook" });
  await advanced.execute(quoted.plan);
  const coreWorker = createJobWorker({ ...advanced, config: loadConfig({ NODE_ENV: "test" }), workerId: "core-worker" });
  assert.equal((await coreWorker.runOnce()).job.status, "succeeded");
  assert.equal(advanced.calls.length, 0);
});

test("HTML preview and exported index are byte-identical, bounded and have restrictive network defaults", () => {
  const result = buildWebAppArtifacts({ title: "Counter", html: html() });
  const preview = result.artifacts[0], zip = result.artifacts[1].bytes;
  const nameLength = zip.readUInt16LE(26), extraLength = zip.readUInt16LE(28), size = zip.readUInt32LE(18);
  assert.equal(zip.subarray(30, 30 + nameLength).toString(), "index.html");
  assert.deepEqual(zip.subarray(30 + nameLength + extraLength, 30 + nameLength + extraLength + size), preview.bytes);
  assert.match(preview.bytes.toString(), /connect-src 'none'/);
  assert.equal(prepareWebAppHtml(preview.bytes.toString()), preview.bytes.toString());
  const boundary = preview.bytes.toString().replace("</body>", "x".repeat(128 * 1024 - preview.bytes.length) + "</body>");
  assert.equal(Buffer.byteLength(prepareWebAppHtml(boundary)), 128 * 1024);
  assert.equal(preview.metadata.runtime_tested, false);
  for (const unsafe of [html().replace("<script>", '<script src="https://example.com/code.js">'), html().replace("</head>", '<base href="https://example.com"></head>'), html().replace("</body>", '<iframe src="other.html"></iframe></body>'), html().replace("</body>", '<img src="https://example.com/pixel"></body>'), html().replace("</body>", "<script>fetch('/api');</script></body>")]) assert.throws(() => prepareWebAppHtml(unsafe), { code: "web_app_external_dependency" });
  assert.throws(() => prepareWebAppHtml(html().replace("</body>", "x".repeat(140000) + "</body>")), { code: "web_app_too_large" });
  assert.throws(() => prepareWebAppHtml('<!doctype html><script>location="https:"+"//example.invalid"</script><html><head></head><body>x</body></html>'), { code: "web_app_incomplete" });
  assert.throws(() => prepareWebAppHtml(html().replace("<head>", '<head title=">">')), { code: "web_app_incomplete" });
  assert.throws(() => prepareWebAppHtml(html().replace("</body>", "")), { code: "web_app_incomplete" });
  assert.throws(() => prepareWebAppHtml(html().replace("</body>", '<script>location="https:"+"//example.invalid"</script></body>')), { code: "web_app_external_dependency" });
});

test("revision quotes bind the owner's actual HTML and reject changes before reserving credits", async () => {
  const f = await fixture();
  const previous = await f.upload();
  const { plan } = await f.plan({ requestText: "Make the button green", revisionFileId: previous.id });
  assert.equal(plan.intent, "app");
  assert.equal(plan.normalized_spec.revision_source.sha256, previous.sha256);
  assert.equal(plan.file_references[0].file_id, previous.id);
  assert.equal(plan.fallback_available, false);
  const foreign = await f.repository.createUser({ email: "other@example.test", passwordHash: "unused", emailVerified: true });
  await assert.rejects(createCreationPlan({ ...f, user: { ...foreign, role: "admin" }, requestText: "Change app", revisionFileId: previous.id }), { code: "source_not_found" });
  f.objects.set(previous.storage_key, Buffer.from(html("Different source")));
  await assert.rejects(f.execute(plan), { code: "source_integrity_failed" });
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal(f.calls.length, 0);
});

test("approved revisions inspect original source, produce a new HTML version and retain original bytes", async () => {
  const f = await fixture();
  const previous = await f.upload(), before = Buffer.from(f.objects.get(previous.storage_key));
  const { plan } = await f.plan({ requestText: "Change heading to Updated counter", revisionFileId: previous.id });
  f.replies.push(response("resp_plan", [toolCall("plan_execution", { objective: "Change counter heading", nodes: [{ id: "inspect", tool: "inspect_file", objective: "Read current app", depends_on: [] }, { id: "edit", tool: "create_web_app", objective: "Update heading", depends_on: ["inspect"] }] }, "plan"), toolCall("inspect_file", { node_id: "inspect", file_id: previous.id }, "inspect")]), response("resp_write", [toolCall("create_web_app", { node_id: "edit", title: "Updated counter", html: html("Updated counter") }, "edit")]), response("resp_done"));
  const started = await f.execute(plan);
  const result = await f.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 2);
  const preview = result.job.output.artifact_manifest.find((item) => item.kind === "app");
  assert.equal(preview.metadata.revision_of_file_id, previous.id);
  assert.equal(preview.metadata.revision_of_sha256, previous.sha256);
  assert.notEqual(preview.id, previous.id);
  assert.deepEqual(f.objects.get(previous.storage_key), before);
  assert.match(f.calls[1].body.input.find((item) => item.call_id === "inspect").output, /Keep this behavior/);
  assert.deepEqual(f.calls[0].body.tools.map((item) => item.name).sort(), ["create_web_app", "inspect_file", "plan_execution"]);
  const replay = await f.execute(plan);
  assert.equal(replay.job.id, started.job.id);
  assert.equal(f.repository.creditEntries.filter((entry) => entry.entry_type === "capture").length, 1);
});

test("revision source changes after approval fail before a model call and restore the original reservation", async () => {
  const f = await fixture(), previous = await f.upload();
  const { plan } = await f.plan({ revisionFileId: previous.id });
  await f.execute(plan);
  f.objects.set(previous.storage_key, Buffer.from("changed after approval"));
  const result = await f.drain();
  assert.equal(result.job.status, "failed");
  assert.equal(f.calls.length, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
});

test("failed custom app generation restores credits without generating a placeholder or repeating paid submission", async () => {
  const f = await fixture();
  const { plan } = await f.plan();
  await f.execute(plan);
  f.replies.push(new Error("connection lost"));
  const result = await f.drain();
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.last_error_code, "app_creation_incomplete");
  assert.equal((await f.repository.listStoredObjects(f.user)).length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(await f.worker.runOnce(), null);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
});

test("partial app output with an unfinished graph remains failed and cannot capture credits", async () => {
  const f = await fixture();
  const { plan } = await f.plan();
  await f.execute(plan);
  f.replies.push(response("resp_partial", [toolCall("plan_execution", { objective: "Create two apps", nodes: [{ id: "first", tool: "create_web_app", objective: "First app", depends_on: [] }, { id: "second", tool: "create_web_app", objective: "Second app", depends_on: ["first"] }] }, "plan"), toolCall("create_web_app", { node_id: "first", title: "First app", html: html() }, "first")]), new Error("provider stopped"));
  const result = await f.drain();
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.last_error_code, "app_creation_incomplete");
  assert.equal(result.job.output.orchestration.artifacts.length, 2);
  assert.equal(f.repository.creditEntries.some((entry) => entry.entry_type === "capture"), false);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
});

test("HTTP preview is private and revision messages preserve replay identity and explicit approval", async (t) => {
  const f = await fixture(), previous = await f.upload();
  const server = createServer(createIabtHandler(f));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = createOpaqueToken();
  await f.repository.createSession({ userId: f.user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000).toISOString() });
  const post = async (path, body, authenticated = true) => { const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); return { status: result.status, body: await result.json() }; };
  assert.equal((await post("/v1/functions/get-app-preview", { file_id: previous.id }, false)).status, 401);
  const preview = await post("/v1/functions/get-app-preview", { file_id: previous.id });
  assert.equal(preview.status, 200);
  assert.match(preview.body.data.content, /Keep this behavior/);
  assert.match(preview.body.data.content, /Content-Security-Policy/);
  const conversation = (await post("/v1/agents/conversations", { agent_name: "iabt_creator" })).body;
  const path = `/v1/agents/conversations/${conversation.id}/messages`;
  const message = { content: "Blue background", revision_file_id: previous.id, submission_id: "revision-once" };
  assert.equal((await post(path, message)).status, 200);
  assert.equal((await post(path, message)).status, 200);
  const other = await f.upload(html("Another version"));
  assert.equal((await post(path, { ...message, revision_file_id: other.id })).status, 409);
  const plans = await f.repository.listRecords("CreationPlan", f.user);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].normalized_spec.revision_source.file_id, previous.id);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal(f.calls.length, 0);
});
