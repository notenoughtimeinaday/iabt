import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createCreationPlan, executeCreationPlan } from "../src/creation/planner.js";
import { buildWebAppArtifacts, prepareWebAppHtml, validateWebAppObjective } from "../src/creation/web-app.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { createJobWorker } from "../src/worker.js";
import { createIabtHandler } from "../src/app.js";
import { createOpaqueToken, hashToken } from "../src/security.js";

const html = (label = "Keep this behavior") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Counter</title><style>body{font:20px system-ui}</style></head><body><h1>${label}</h1><button id="add">Add one</button><output id="count">0</output><script>document.getElementById('add').onclick=function(){document.getElementById('count').value=Number(document.getElementById('count').value)+1};</script></body></html>`;
const maintenanceRequest = "Build a polished, self-contained equipment maintenance tracker for a small shop. Users can add, edit, complete, and delete maintenance tasks; set equipment name, priority, due date, and notes; search and filter by status and priority; see overdue and upcoming summaries; persist data in browser storage; import and export JSON; and use it comfortably on phone or desktop. Include realistic sample data, clear empty states, accessible high-contrast styling, and no external services.";
const partialMaintenanceHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Equipment Maintenance Tracker</title><style>body{font:16px system-ui}</style></head><body><h1>Equipment Maintenance Tracker</h1><label>Equipment Name<input></label><label>Priority<select></select></label><label>Due Date<input type="date"></label><label>Notes<textarea></textarea></label><table><tr><th>Status</th></tr></table><button>Add Task</button><button>Complete</button><button>Delete</button><script>const tasks=JSON.parse(localStorage.getItem('tasks')||'[]');localStorage.setItem('tasks',JSON.stringify(tasks));</script></body></html>`;
const completeMaintenanceHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Equipment Maintenance Tracker</title><style>body{font:16px system-ui}@media(max-width:600px){body{font-size:14px}}</style></head><body><h1>Equipment Maintenance Tracker</h1><p>Realistic sample data</p><p class="empty">No tasks</p><label>Equipment Name<input></label><label>Priority<select></select></label><label>Due Date<input type="date"></label><label>Notes<textarea></textarea></label><label>Search<input></label><label>Status filter<select></select></label><section>Overdue summary</section><section>Upcoming summary</section><button>Add Task</button><button>Edit</button><button>Complete</button><button>Delete</button><button>Import JSON</button><button>Export JSON</button><script>const tasks=JSON.parse(localStorage.getItem('tasks')||'[]');localStorage.setItem('tasks',JSON.stringify(tasks));function importJson(text){return JSON.parse(text)}function exportJson(){return JSON.stringify(tasks)}</script></body></html>`;
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
  const upload = async (text = html(), owner = user, name = "Counter.html") => { const id = randomUUID(), bytes = Buffer.from(text); const stored = await storage.put({ ownerId: owner.id, objectId: id, bytes }); return repository.createStoredObject({ id, ownerId: owner.id, storageProvider: stored.storage_provider, storageKey: stored.storage_key, originalName: name, contentType: /\.html$/i.test(name) ? "text/html" : "text/plain", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }); };
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

test("new app objective checks reject the observed maintenance-tracker omissions without claiming runtime proof", () => {
  assert.throws(() => validateWebAppObjective({ request: maintenanceRequest, html: partialMaintenanceHtml }), (error) => {
    assert.equal(error.code, "web_app_requirements_missing");
    assert.deepEqual(error.missing_requirements, ["edit existing items", "search", "filters", "overdue summary", "upcoming summary", "JSON import", "JSON export", "realistic sample data", "clear empty states", "phone and desktop layout"]);
    return true;
  });
  const result = buildWebAppArtifacts({ title: "Equipment Maintenance Tracker", request: maintenanceRequest, html: completeMaintenanceHtml });
  assert.equal(result.metadata.runtime_tested, false);
  assert.equal(result.metadata.objective_contract.method, "bounded_lexical_evidence");
  assert.deepEqual(result.metadata.objective_contract.checked, result.metadata.objective_contract.passed);
  assert.ok(result.metadata.objective_contract.checked.includes("json_import"));
  assert.ok(result.metadata.objective_contract.checked.includes("responsive"));
  assert.equal(result.metadata.script_checks.runtime_tested, false);
  const zipText = result.artifacts[1].bytes.toString("utf8");
  assert.match(zipText, /REVIEW\.md/);
  assert.match(zipText, /manual checklist, not a completed test report/);
  assert.match(zipText, /Edit an existing item/);
  assert.match(zipText, /Invalid input must leave existing data unchanged/);
});

test("orchestration repairs a rejected app omission and captures credits only after an accepted artifact", async () => {
  const f = await fixture();
  const { plan } = await f.plan({ requestText: maintenanceRequest });
  f.replies.push(
    response("resp_plan", [toolCall("plan_execution", { objective: "Build the requested maintenance tracker", nodes: [{ id: "build_app", tool: "create_web_app", objective: "Build the complete maintenance tracker", depends_on: [] }] }, "plan")]),
    response("resp_incomplete", [toolCall("create_web_app", { node_id: "build_app", title: "Equipment Maintenance Tracker", html: partialMaintenanceHtml }, "create_incomplete")]),
    response("resp_repaired", [toolCall("create_web_app", { node_id: "build_app", title: "Equipment Maintenance Tracker", html: completeMaintenanceHtml }, "create_repaired")]),
    response("resp_complete")
  );
  await f.execute(plan);
  const result = await f.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.job.output.orchestration.failures.filter((item) => item.code === "web_app_requirements_missing").length, 1);
  const rejected = f.calls[2].body.input.find((item) => item.call_id === "create_incomplete");
  assert.match(rejected.output, /web_app_requirements_missing/);
  assert.match(rejected.output, /edit existing items, search, filters/);
  assert.equal(f.repository.creditEntries.filter((entry) => entry.entry_type === "capture").length, 1);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20 - plan.credit_cost);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  const firstInput = JSON.parse(f.calls[0].body.input[0].content);
  assert.ok(firstInput.app_requirement_candidates.some((item) => item.id === "edit"));
  assert.match(firstInput.acceptance_instructions, /not the complete specification/);
  assert.match(f.calls[0].body.instructions, /placeholder buttons and TODOs are not implementations/);
  assert.match(f.calls[0].body.instructions, /preserve existing data on invalid input/);
});

test("invalid JavaScript is repaired within the same app job before any artifact is accepted", async () => {
  const f = await fixture();
  const { plan } = await f.plan();
  f.replies.push(
    response("resp_plan", [toolCall("plan_execution", { objective: "Build a counter", nodes: [{ id: "build_app", tool: "create_web_app", objective: "Build a counter", depends_on: [] }] }, "plan")]),
    response("resp_broken", [toolCall("create_web_app", { node_id: "build_app", title: "Counter", html: html().replace("<script>", "<script>const missing = ;") }, "broken")]),
    response("resp_fixed", [toolCall("create_web_app", { node_id: "build_app", title: "Counter", html: html() }, "fixed")]),
    response("resp_complete")
  );
  await f.execute(plan);
  const result = await f.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.job.output.orchestration.execution_graph.nodes[0].attempts.length, 2);
  const rejected = JSON.parse(f.calls[2].body.input.find((item) => item.call_id === "broken").output);
  assert.equal(rejected.error, "web_app_script_syntax_invalid");
  assert.match(rejected.message, /did not execute/);
  assert.doesNotMatch(rejected.message, /missing =|SyntaxError|\/workspace/);
  assert.equal(f.repository.creditEntries.filter((entry) => entry.entry_type === "capture").length, 1);
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

test("source-grounded apps require AI and an accepted quote without substituting a starter or source report", async () => {
  const unavailable = await fixture({ ai: false });
  const source = await unavailable.upload("Tasks need due dates and filters", unavailable.user, "requirements.md");
  await assert.rejects(unavailable.plan({ requestText: "Create a task-list starter from these requirements", fileIds: [source.id], automatic: true }), { code: "app_creation_unavailable" });
  assert.equal((await unavailable.repository.getCreditAccount(unavailable.user.id)).available_credits, 20);
  assert.equal((await unavailable.repository.listRecords("CreationPlan", unavailable.user)).length, 0);
  assert.equal((await unavailable.repository.listJobs(unavailable.user)).length, 0);
  assert.equal(unavailable.calls.length, 0);

  const f = await fixture(), owned = await f.upload("Use a green theme", f.user, "requirements.md");
  for (const requestText of ["Build an inventory app from my files", "Create a nursery website using my files"]) {
    const { plan, job } = await f.plan({ requestText, fileIds: [owned.id], automatic: true });
    assert.equal(plan.job_type, "creation.orchestrated");
    assert.equal(plan.capability_id, "openai-responses-orchestration-v1");
    assert.equal(plan.normalized_spec.app_output_contract, "self_contained_html_v1");
    assert.equal(plan.fallback_available, false);
    assert.equal(plan.file_references[0].sha256, owned.sha256);
    assert.equal(job, undefined);
  }
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal(f.calls.length, 0);
});

test("source-grounded app quotes reject foreign files, altered source bytes and altered signed references", async () => {
  const f = await fixture(), source = await f.upload("Original requirements", f.user, "requirements.md");
  const other = await f.repository.createUser({ email: "foreign@example.test", passwordHash: "unused", emailVerified: true });
  for (const role of ["user", "admin"]) await assert.rejects(createCreationPlan({ ...f, user: { ...other, role }, requestText: "Build an app from my files", fileIds: [source.id] }), { code: "source_not_found" });
  const { plan } = await f.plan({ fileIds: [source.id] });
  f.objects.set(source.storage_key, Buffer.from("Altered requirements"));
  await assert.rejects(f.execute(plan), { code: "source_integrity_failed" });
  f.objects.set(source.storage_key, Buffer.from("Original requirements"));
  f.repository.entityMap("CreationPlan").get(plan.id).file_references[0].sha256 = "f".repeat(64);
  await assert.rejects(f.execute(plan), { code: "quote_mismatch" });
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal((await f.repository.listJobs(f.user)).length, 0);
  assert.equal(f.calls.length, 0);
});

test("source-grounded apps recheck every source after approval before any paid request", async () => {
  for (const change of ["bytes", "owner", "missing"]) {
    const f = await fixture(), source = await f.upload("Preserve the invoice total", f.user, "requirements.md");
    const other = await f.repository.createUser({ email: "changed-owner@example.test", passwordHash: "unused", emailVerified: true });
    const { plan } = await f.plan({ fileIds: [source.id] });
    await f.execute(plan);
    if (change === "bytes") f.objects.set(source.storage_key, Buffer.from("Replacement source"));
    if (change === "owner") f.repository.storedObjects.get(source.id).owner_id = other.id;
    if (change === "missing") f.objects.delete(source.storage_key);
    const result = await f.drain();
    assert.equal(result.job.status, "failed");
    assert.equal(f.calls.length, 0);
    assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
  }
});

test("approved app creation inspects all supplied data and requirements and saves new identical HTML and ZIP source", async () => {
  const f = await fixture();
  const sources = [await f.upload("- Show nursery stock\n- Allow changing stock quantities", f.user, "requirements.md"), await f.upload("plant,stock\nOrchid,7", f.user, "stock.csv")];
  const before = sources.map((source) => Buffer.from(f.objects.get(source.storage_key)));
  const { plan } = await f.plan({ requestText: "Build a nursery stock app from these requirements and data", fileIds: sources.map((source) => source.id) });
  const nodes = sources.map((source, index) => ({ id: "read" + index, tool: "inspect_file", objective: "Read " + source.original_name, depends_on: [] }));
  nodes.push({ id: "build", tool: "create_web_app", objective: "Build nursery stock app", depends_on: ["read0", "read1"] });
  f.replies.push(response("resp_sources", [toolCall("plan_execution", { objective: "Nursery stock app", nodes }, "plan"), ...sources.map((source, index) => toolCall("inspect_file", { node_id: "read" + index, file_id: source.id }, "read" + index))]), response("resp_app", [toolCall("create_web_app", { node_id: "build", title: "Nursery stock", html: html("Orchid stock: 7") }, "build")]), response("resp_complete"));
  await f.execute(plan);
  const result = await f.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 2);
  const outputs = f.calls[1].body.input.filter((item) => item.type === "function_call_output");
  assert.match(outputs.find((item) => item.call_id === "read0").output, /changing stock quantities/);
  assert.match(outputs.find((item) => item.call_id === "read1").output, /Orchid,7/);
  assert.deepEqual(f.calls[0].body.tools.map((item) => item.name).sort(), ["create_web_app", "inspect_file", "plan_execution"]);
  assert.match(f.calls[0].body.input[0].content, /Inspect every approved file/);
  for (const [index, source] of sources.entries()) assert.deepEqual(f.objects.get(source.storage_key), before[index]);
  const app = result.artifacts.find((item) => /\.html$/.test(item.original_name));
  const archive = result.artifacts.find((item) => /\.zip$/.test(item.original_name));
  const previewBytes = f.objects.get(app.storage_key), zip = f.objects.get(archive.storage_key);
  assert.match(previewBytes.toString(), /Orchid stock: 7/);
  assert.match(previewBytes.toString(), /connect-src 'none'/);
  const offset = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
  assert.deepEqual(zip.subarray(offset, offset + zip.readUInt32LE(18)), previewBytes);
  assert.equal(result.job.output.provider_metadata.runtime_tested, false);
  assert.equal(f.repository.creditEntries.filter((entry) => entry.entry_type === "capture").length, 1);
});

test("the model cannot create an app after inspecting only some approved sources", async () => {
  const f = await fixture(), first = await f.upload("First requirement", f.user, "first.md"), second = await f.upload("Second requirement", f.user, "second.md");
  const { plan } = await f.plan({ fileIds: [first.id, second.id] });
  f.replies.push(response("resp_skip", [toolCall("plan_execution", { objective: "Skip second source", nodes: [{ id: "read", tool: "inspect_file", objective: "Read one file", depends_on: [] }, { id: "build", tool: "create_web_app", objective: "Build", depends_on: ["read"] }] }, "plan"), toolCall("inspect_file", { node_id: "read", file_id: first.id }, "read"), toolCall("create_web_app", { node_id: "build", title: "Incomplete", html: html() }, "build")]), new Error("provider stopped"));
  await f.execute(plan);
  const result = await f.drain();
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.output.orchestration.artifacts.length, 0);
  assert.match(f.calls[1].body.input.find((item) => item.call_id === "build").output, /source_inspection_required/);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).available_credits, 20);
  assert.equal(f.repository.creditEntries.some((entry) => entry.entry_type === "capture"), false);
});

test("an explicit source review remains deterministic when AI is configured", async () => {
  const f = await fixture(), source = await f.upload("- Preserve existing behavior", f.user, "requirements.md");
  const { plan } = await f.plan({ requestText: "Review the uploaded app requirements", fileIds: [source.id], automatic: true });
  assert.equal(plan.intent, "document");
  assert.equal(plan.capability_id, "iabt-source-review-v1");
  assert.equal(plan.provider_cost_cents, 0);
  const result = await f.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 3);
  assert.equal(f.calls.length, 0);
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

test("HTTP app requests preserve attached-source identity across replay and require explicit cost approval", async (t) => {
  const f = await fixture(), source = await f.upload("- Add an editable inventory total", f.user, "requirements.md");
  const server = createServer(createIabtHandler(f));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = createOpaqueToken();
  await f.repository.createSession({ userId: f.user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000).toISOString() });
  const post = async (path, body) => { const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) }); return { status: result.status, body: await result.json() }; };
  const conversation = (await post("/v1/agents/conversations", { agent_name: "iabt_creator" })).body;
  const path = `/v1/agents/conversations/${conversation.id}/messages`;
  const message = { content: "Build an inventory app from these requirements", file_ids: [source.id], submission_id: "source-app-once" };
  const first = await post(path, message);
  assert.equal(first.status, 200);
  assert.equal((await post(path, message)).status, 200);
  assert.equal((await post(path, { ...message, file_ids: [] })).status, 409);
  const plans = await f.repository.listRecords("CreationPlan", f.user);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].job_type, "creation.orchestrated");
  assert.equal(plans[0].conversation_id, conversation.id);
  assert.equal(plans[0].file_references[0].sha256, source.sha256);
  assert.equal(first.body.messages.find((item) => item.role === "user").file_references[0].file_id, source.id);
  assert.equal((await f.repository.listJobs(f.user)).length, 0);
  assert.equal((await f.repository.getCreditAccount(f.user.id)).reserved_credits, 0);
  assert.equal(f.calls.length, 0);
});
