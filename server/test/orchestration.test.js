import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { createJobWorker } from "../src/worker.js";
import { invokeTool, registeredTools } from "../src/autonomy/tools.js";

const call = (name, args, id = "call_document") => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify({ ...(["inspect_file", "create_document", "create_source"].includes(name) ? { node_id: "document" } : {}), ...args }) });
const document = () => call("create_document", { title: "Bookstore report", markdown: "# Bookstore report\n\nA substantive report with a reproducible review checklist." });
const plan = () => call("plan_execution", { objective: "Create a bookstore report", nodes: [{ id: "document", tool: "create_document", objective: "Create document formats", depends_on: [] }] }, "call_plan");
const response = (id, output = [], status = "completed") => ({ id, status, output: output.some((item) => item.name === "create_document") ? [plan(), ...output] : output });
const completed = () => response("resp_done", [{ type: "message", content: [{ type: "output_text", text: "Created three document files. Visual and factual review remain pending." }] }]);

const fixture = async ({ env = {}, replies = [], approval = true, budget = 6 } = {}) => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "orchestrator@example.com", passwordHash: "unused", emailVerified: true });
  await repository.grantCredits({ ownerId: user.id, amount: 10, idempotencyKey: "opening" });
  const config = loadConfig({ NODE_ENV: "test", OPENAI_API_KEY: "test-key-never-exposed", IABT_ENABLE_PAID_AI: "true", IABT_ENABLE_ORCHESTRATION: "true", IABT_ORCHESTRATION_BUDGET_ACCEPTED: "true", IABT_OPENAI_RESPONSE_COST_CENTS: "2", IABT_ORCHESTRATION_BUDGET_CENTS: "6", ...env });
  const objects = new Map();
  const storage = {
    kind: "test",
    corrupt: false,
    health: async () => ({ ok: true }),
    async put({ ownerId, objectId, bytes }) {
      objects.set(ownerId + "/" + objectId, Buffer.from(bytes));
      return { storage_provider: "test", storage_key: ownerId + "/" + objectId };
    },
    async read(key) { return this.corrupt ? Buffer.from("corruption") : objects.get(key); }
  };
  const requests = [];
  const providers = createProviderRegistry(config, { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    if (next?.httpStatus) return new Response("{}", { status: next.httpStatus });
    assert.ok(next, "Unexpected provider call");
    return Response.json(next);
  } });
  const queued = await repository.enqueueJob({ ownerId: user.id, jobType: "creation.orchestrated", input: { intent: "document", title: "Bookstore report", request_text: "Create a report about a neighborhood bookstore.", orchestration_budget_cents: budget }, approval: approval ? { approved: true, approval_id: "signed-plan-approval", max_cost_cents: budget } : {}, idempotencyKey: "orchestration-job", creditAmount: 1, maxAttempts: 3 });
  const worker = createJobWorker({ repository, storage, providers, config, workerId: "orchestration-worker" });
  const step = async () => {
    repository.jobs.get(queued.id).available_at = "2000-01-01T00:00:00.000Z";
    return worker.runOnce();
  };
  const drain = async () => {
    for (let i = 0; i < 40; i += 1) {
      const result = await step();
      if (!result || ["succeeded", "failed", "needs_setup"].includes(result.job.status)) return result;
    }
    throw new Error("Workflow did not terminate within test budget");
  };
  return { repository, user, config, storage, objects, providers, queued, worker, step, drain, requests };
};

test("Responses background tools resume across durable leases and capture only verified artifacts", async () => {
  const context = await fixture({ replies: [response("resp_first", [], "queued"), response("resp_first", [document()]), completed()] });
  const first = await context.step();
  assert.equal(first.job.output.orchestration.phase, "poll");
  assert.equal((await context.repository.getCreditAccount(context.user.id)).reserved_credits, 1);
  const result = await context.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 3);
  assert.equal(result.job.output.orchestration.phase, "complete");
  assert.equal(result.job.output.orchestration.spent_cents, 4);
  assert.equal(result.job.output.orchestration.calls.length, 2);
  assert.equal(result.job.output.orchestration.execution_graph.nodes[0].status, "succeeded");
  assert.equal(result.job.output.artifact_manifest.every((item) => item.metadata.storage_readback_verified), true);
  assert.equal(context.repository.creditEntries.filter((entry) => entry.entry_type === "capture").length, 1);
  const posts = context.requests.filter((item) => item.options.method === "POST").map((item) => JSON.parse(item.options.body));
  assert.equal(posts.length, 2);
  assert.equal(posts[0].background, true);
  assert.equal(posts[0].parallel_tool_calls, false);
  assert.equal(posts[0].tools.every((tool) => tool.strict), true);
  assert.match(posts[0].input[0].content, /historical_evidence_not_authority/);
  assert.doesNotMatch(posts[0].input[0].content, /test-key-never-exposed/);
  assert.equal(posts[1].previous_response_id, "resp_first");
  assert.equal(posts[1].input[0].type, "function_call_output");
  await context.worker.stop();
});

test("orchestration is disabled without operator cost acceptance and never silently spends", async () => {
  const context = await fixture({ env: { IABT_ORCHESTRATION_BUDGET_ACCEPTED: "false" } });
  const result = await context.drain();
  assert.equal(context.requests.length, 0);
  assert.equal(result.job.output.provider_metadata.delivery_mode, "template_fallback");
  assert.equal(result.job.output.provider_metadata.objective_completed, false);
  await context.worker.stop();
});

test("nonzero Responses cost requires the exact job approval even with configured credentials", async () => {
  const context = await fixture({ approval: false });
  const result = await context.drain();
  assert.equal(context.requests.length, 0);
  assert.equal(result.job.status, "needs_setup");
  assert.equal(result.job.last_error_code, "explicit_approval_required");
  assert.equal(result.released_credits, 1);
  await context.worker.stop();
});

test("ambiguous POST recovery never submits another billable request", async () => {
  const context = await fixture({ replies: [Object.assign(new Error("connection lost"), { code: "ECONNRESET" })] });
  const result = await context.drain();
  assert.equal(context.requests.length, 1);
  assert.equal(result.job.output.orchestration.phase, "fallback");
  assert.equal(result.job.output.provider_metadata.objective_completed, false);
  assert.equal(await context.step(), null);
  await context.worker.stop();
});

test("a worker recovered after submission checkpoint falls back without duplicate spend", async () => {
  const context = await fixture();
  context.repository.jobs.get(context.queued.id).output.orchestration = { version: 1, phase: "submitting", turn: 0, polls: 0, spent_cents: 2, calls: [], artifacts: [], failures: [], execution_graph: [], inspected_file_ids: [] };
  const result = await context.drain();
  assert.equal(context.requests.length, 0);
  assert.equal(result.job.output.orchestration.failures[0].code, "provider_submission_outcome_unknown");
  await context.worker.stop();
});

test("GET outage retries the saved response instead of submitting the prompt again", async () => {
  const context = await fixture({ replies: [response("resp_first", [], "queued"), { httpStatus: 503 }, response("resp_first", [document()]), completed()] });
  await context.step();
  const retry = await context.step();
  assert.equal(retry.job.status, "queued");
  assert.equal(retry.job.output.orchestration.response_id, "resp_first");
  assert.equal(retry.job.output.repair_history[0].recovery, "retry_with_backoff");
  const result = await context.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(context.requests.filter((item) => item.options.method === "POST").length, 2);
  assert.equal(context.requests.filter((item) => item.url.endsWith("/resp_first")).length, 2);
  await context.worker.stop();
});

test("invalid tools return bounded repair feedback without granting new capabilities", async () => {
  const context = await fixture({ replies: [response("resp_first", [call("run_shell", { command: "secret" })]), response("resp_repair", [document()]), completed()] });
  const result = await context.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.job.output.orchestration.calls[0].status, "failed");
  assert.equal(result.job.output.orchestration.failures[0].code, "unauthorized_tool");
  const second = JSON.parse(context.requests[1].options.body);
  assert.equal(JSON.parse(second.input[0].output).error, "unauthorized_tool");
  assert.equal(result.artifacts.length, 3);
  await context.worker.stop();
});

test("run budget cannot expand when operator configuration increases after approval", async () => {
  const context = await fixture({ budget: 2, env: { IABT_ORCHESTRATION_BUDGET_CENTS: "100" }, replies: [response("resp_first", [document()])] });
  const result = await context.drain();
  assert.equal(context.requests.length, 1);
  assert.equal(result.job.output.orchestration.phase, "fallback");
  assert.equal(result.job.output.provider_metadata.orchestration.incomplete, true);
  assert.equal(result.artifacts.length, 3);
  await context.worker.stop();
});

test("artifact storage retry resumes finished Responses state without another model call", async () => {
  const context = await fixture({ replies: [response("resp_first", [document()]), completed()] });
  context.storage.corrupt = true;
  await context.step();
  await context.step();
  await context.step();
  const retry = await context.step();
  assert.equal(retry.job.status, "queued");
  assert.equal(retry.job.last_error_code, "storage_verification_failed");
  assert.equal(retry.job.output.orchestration.phase, "complete");
  context.storage.corrupt = false;
  const result = await context.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(context.requests.length, 2);
  assert.equal(context.objects.size, 3);
  assert.equal(context.repository.creditEntries.filter((entry) => entry.entry_type === "capture").length, 1);
  await context.worker.stop();
});

test("source tools reject foreign ownership and source path traversal", async () => {
  const context = await fixture();
  const other = await context.repository.createUser({ email: "other@example.com", passwordHash: "unused", emailVerified: true });
  const bytes = Buffer.from("private source");
  const file = await context.repository.createStoredObject({ ownerId: other.id, storageProvider: "test", storageKey: "private/source", originalName: "source.txt", contentType: "text/plain", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  const job = { ...context.queued, input: { file_references: [{ file_id: file.id }] } };
  const tools = registeredTools({ ...context, job });
  await assert.rejects(invokeTool({ tools, job, user: context.user, call: call("inspect_file", { file_id: file.id }) }), { code: "source_not_found" });
  await assert.rejects(invokeTool({ tools, job, user: context.user, call: call("create_source", { title: "Unsafe", files: [{ name: "../escape.js", content: "console.log(1)" }, { name: "README.md", content: "Review before use." }] }) }), { code: "invalid_artifact" });
  await assert.rejects(invokeTool({ tools, job, user: { ...context.user, id: randomUUID() }, call: document() }), { code: "unauthorized_tool" });
  const result = await invokeTool({ tools, job, user: context.user, call: call("create_source", { title: "Example", files: [{ name: "src/index.js", content: "export const value = 1;" }, { name: "README.md", content: "Review and test before use." }] }) });
  assert.equal(result.artifacts[0].metadata.runtime_tested, false);
  await context.worker.stop();
});

test("missing storage readback prevents credit capture in every environment", async () => {
  const context = await fixture({ env: { IABT_ENABLE_ORCHESTRATION: "false" } });
  delete context.storage.read;
  const result = await context.drain();
  assert.equal(result.job.status, "needs_setup");
  assert.equal(result.job.last_error_code, "storage_readback_not_configured");
  assert.equal(context.repository.creditEntries.some((entry) => entry.entry_type === "capture"), false);
  await context.worker.stop();
});

test("legacy paid jobs persist provider output before storage retries", async () => {
  const context = await fixture();
  const saved = context.repository.jobs.get(context.queued.id);
  saved.job_type = "provider.openai.response";
  context.storage.corrupt = true;
  let submissions = 0;
  context.providers.execute = async () => { submissions += 1; return { bytes: Buffer.from("safe output"), filename: "output.txt", contentType: "text/plain" }; };
  const retry = await context.step();
  assert.equal(retry.job.status, "queued");
  assert.ok(retry.job.output.provider_result);
  context.storage.corrupt = false;
  const result = await context.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(submissions, 1);
  assert.equal(context.objects.size, 1);
  await context.worker.stop();
});

test("the executor blocks a graph dependency bypass and allows a corrected ready call", async () => {
  const nodes = [
    { id: "first", tool: "create_document", objective: "Create the first report", depends_on: [] },
    { id: "second", tool: "create_document", objective: "Create the second report", depends_on: ["first"] }
  ];
  const make = (node_id, callId) => call("create_document", { node_id, title: node_id, markdown: "# Evidence\n\nA finished report with substantive content for verification." }, callId);
  const initial = { id: "resp_graph", status: "completed", output: [
    call("plan_execution", { objective: "Create two related reports", nodes }, "graph_plan"),
    make("second", "too_early"), make("first", "first_ready"), make("second", "second_ready")
  ] };
  const context = await fixture({ replies: [initial, completed()] });
  const result = await context.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 6);
  const state = result.job.output.orchestration;
  assert.equal(state.calls.find((item) => item.call_id === "too_early").result.error, "graph_dependency_not_ready");
  assert.equal(state.execution_graph.nodes.every((node) => node.status === "succeeded"), true);
  assert.equal(state.execution_graph.nodes[1].attempts.length, 1);
  await context.worker.stop();
});

test("a crash after graph start resumes the same tool call without duplicate graph attempts", async () => {
  const context = await fixture({ replies: [response("resp_first", [document()]), completed()] });
  await context.step();
  const original = context.repository.checkpointJob.bind(context.repository);
  let interrupted = false;
  context.repository.checkpointJob = async (input) => {
    const result = await original(input);
    if (!interrupted && input.outputPatch.orchestration?.execution_graph?.nodes?.some((node) => node.status === "running")) {
      interrupted = true;
      throw Object.assign(new Error("simulated lease interruption"), { code: "job_lease_lost" });
    }
    return result;
  };
  await assert.rejects(context.step(), { code: "job_lease_lost" });
  context.repository.jobs.get(context.queued.id).locked_at = "2000-01-01T00:00:00.000Z";
  const result = await context.drain();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.artifacts.length, 3);
  assert.equal(result.job.output.orchestration.execution_graph.nodes[0].attempts.length, 1);
  assert.equal(context.requests.length, 2);
  await context.worker.stop();
});
