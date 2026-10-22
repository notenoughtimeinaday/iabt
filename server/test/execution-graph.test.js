import assert from "node:assert/strict";
import { test } from "node:test";
import { GRAPH_LIMITS, validateExecutionGraph, readyGraphNodes, startGraphNode, finishGraphNode, executionGraphComplete } from "../src/autonomy/execution-graph.js";

const toolNames = ["inspect_file", "create_document", "create_source", "plan_execution"];
const plan = () => ({ objective: "Create a report from two private sources", nodes: [
  { id: "read_a", tool: "inspect_file", objective: "Read the first attached source", depends_on: [] },
  { id: "read_b", tool: "inspect_file", objective: "Read the second attached source", depends_on: [] },
  { id: "write_report", tool: "create_document", objective: "Write the report after reading both sources", depends_on: ["read_a", "read_b"] }
] });
const graph = () => validateExecutionGraph(plan(), { toolNames });
const perform = (state, id, callId, extra = {}) => finishGraphNode(startGraphNode(state, { nodeId: id, toolName: state.nodes.find((node) => node.id === id).tool, callId }), { nodeId: id, callId, result: { ok: true }, ...extra });

test("execution graph supports independent branches and joins only after all dependencies succeed", () => {
  const initial = graph();
  assert.deepEqual(readyGraphNodes(initial).map((node) => node.id), ["read_a", "read_b"]);
  assert.throws(() => startGraphNode(initial, { nodeId: "write_report", toolName: "create_document", callId: "early" }), { code: "graph_dependency_not_ready" });
  const one = perform(initial, "read_a", "call_a");
  assert.deepEqual(readyGraphNodes(one).map((node) => node.id), ["read_b"]);
  const both = perform(one, "read_b", "call_b");
  assert.deepEqual(readyGraphNodes(both).map((node) => node.id), ["write_report"]);
  const done = perform(both, "write_report", "call_report");
  assert.equal(executionGraphComplete(done), true);
  assert.equal(executionGraphComplete(initial), false);
  assert.deepEqual(initial.nodes.map((node) => node.status), ["pending", "pending", "pending"], "Transitions never mutate their input checkpoint");
});

test("execution graph rejects cycles, missing dependencies, duplicates and unknown tools", () => {
  const cases = [
    ["graph_cycle", (value) => { value.nodes[0].depends_on = ["write_report"]; }],
    ["graph_cycle", (value) => { value.nodes[0].depends_on = ["read_a"]; }],
    ["graph_missing_dependency", (value) => { value.nodes[0].depends_on = ["unlisted"]; }],
    ["graph_duplicate_node", (value) => { value.nodes[1].id = "read_a"; }],
    ["graph_invalid_node", (value) => { value.nodes[2].depends_on = ["read_a", "read_a"]; }],
    ["graph_unknown_tool", (value) => { value.nodes[0].tool = "send_email"; }],
    ["graph_unknown_tool", (value) => { value.nodes[0].tool = "plan_execution"; }]
  ];
  for (const [code, change] of cases) {
    const value = plan(); change(value);
    assert.throws(() => validateExecutionGraph(value, { toolNames }), { code });
  }
});

test("model-authored graph cannot inject statuses, result evidence, costs or approval", () => {
  for (const field of ["status", "attempts", "result", "approval", "max_cost_cents", "arguments", "risk_class"]) {
    const value = plan();
    value.nodes[0][field] = field === "status" ? "succeeded" : true;
    assert.throws(() => validateExecutionGraph(value, { toolNames }), { code: "graph_invalid_node" }, field);
  }
  assert.throws(() => validateExecutionGraph({ ...plan(), approved: true }, { toolNames }), { code: "graph_invalid_shape" });
  assert.throws(() => validateExecutionGraph({ ...plan(), objective: " " }, { toolNames }), { code: "graph_invalid_objective" });
  assert.throws(() => validateExecutionGraph({ ...plan(), nodes: [] }, { toolNames }), { code: "graph_invalid_shape" });
});

test("execution graph bounds node count and dependency depth", () => {
  const nodes = Array.from({ length: GRAPH_LIMITS.nodes + 1 }, (_, index) => ({ id: "node_" + index, tool: "inspect_file", objective: "Bounded step", depends_on: [] }));
  assert.throws(() => validateExecutionGraph({ objective: "Too many nodes", nodes }, { toolNames }), { code: "graph_invalid_shape" });
  const chain = nodes.slice(0, GRAPH_LIMITS.depth + 1).map((node, index) => ({ ...node, depends_on: index ? ["node_" + (index - 1)] : [] }));
  assert.throws(() => validateExecutionGraph({ objective: "Too deep", nodes: chain }, { toolNames }), { code: "graph_too_deep" });
  assert.equal(validateExecutionGraph({ objective: "At limit", nodes: chain.slice(0, GRAPH_LIMITS.depth) }, { toolNames }).nodes.length, GRAPH_LIMITS.depth);
});

test("failed dependencies block downstream execution while bounded correction attempts preserve evidence", () => {
  let state = perform(graph(), "read_a", "failed_a", { error: { code: "source_not_found" }, result: { error: "source_not_found" } });
  assert.equal(state.nodes[0].status, "failed");
  assert.equal(state.nodes[0].attempts[0].error_code, "source_not_found");
  assert.throws(() => startGraphNode(state, { nodeId: "write_report", toolName: "create_document", callId: "early" }), { code: "graph_dependency_not_ready" });
  const failedEvidence = structuredClone(state.nodes[0].attempts[0]);
  state = perform(state, "read_a", "corrected_a");
  assert.equal(state.nodes[0].status, "succeeded");
  assert.deepEqual(state.nodes[0].attempts[0], failedEvidence);
  assert.equal(state.nodes[0].attempts.length, 2);
  let exhausted = graph();
  for (let index = 0; index < GRAPH_LIMITS.attempts; index++) exhausted = perform(exhausted, "read_a", "failed_" + index, { error: "invalid_tool_input" });
  assert.throws(() => startGraphNode(exhausted, { nodeId: "read_a", toolName: "inspect_file", callId: "too_many" }), { code: "graph_attempt_limit" });
});

test("graph replan can extend pending work but cannot rewrite or remove attempted evidence", () => {
  const initial = graph();
  const completed = perform(initial, "read_a", "call_a");
  const revised = plan();
  revised.nodes[1].objective = "Read the clarified second source";
  revised.nodes.push({ id: "package", tool: "create_source", objective: "Package report source after verification", depends_on: ["write_report"] });
  const changed = validateExecutionGraph(revised, { toolNames, previousGraph: completed });
  assert.equal(changed.revision, 2);
  assert.deepEqual(changed.nodes[0], completed.nodes[0]);
  assert.equal(changed.nodes[1].objective, revised.nodes[1].objective);
  for (const change of [
    (value) => { value.objective = "Different purpose"; },
    (value) => { value.nodes[0].objective = "Different step"; },
    (value) => { value.nodes[0].tool = "create_source"; },
    (value) => { value.nodes[0].depends_on = ["read_b"]; },
    (value) => { value.nodes = value.nodes.slice(1).map((node) => ({ ...node, depends_on: node.depends_on.filter((id) => id !== "read_a") })); }
  ]) {
    const value = plan(); change(value);
    assert.throws(() => validateExecutionGraph(value, { toolNames, previousGraph: completed }), { code: "graph_evidence_immutable" });
  }
  const failed = perform(initial, "read_a", "failed", { error: "source_changed" });
  const rewriteFailure = plan(); rewriteFailure.nodes[0].objective = "Hide the failed source read";
  assert.throws(() => validateExecutionGraph(rewriteFailure, { toolNames, previousGraph: failed }), { code: "graph_evidence_immutable" });
});

test("graph enforces call identity and permits only an identical in-flight restart", () => {
  const initial = graph();
  assert.throws(() => startGraphNode(initial, { nodeId: "read_a", toolName: "create_document", callId: "mismatch" }), { code: "graph_tool_mismatch" });
  const running = startGraphNode(initial, { nodeId: "read_a", toolName: "inspect_file", callId: "call_a" });
  assert.deepEqual(startGraphNode(running, { nodeId: "read_a", toolName: "inspect_file", callId: "call_a" }), running);
  assert.throws(() => startGraphNode(running, { nodeId: "read_b", toolName: "inspect_file", callId: "call_a" }), { code: "graph_call_identity_conflict" });
  assert.throws(() => finishGraphNode(running, { nodeId: "read_a", callId: "different_call", result: {} }), { code: "graph_call_identity_conflict" });
  const done = finishGraphNode(running, { nodeId: "read_a", callId: "call_a", result: { ok: true } });
  assert.throws(() => startGraphNode(done, { nodeId: "read_a", toolName: "inspect_file", callId: "call_a" }), { code: "graph_call_identity_conflict" });
  assert.throws(() => startGraphNode(done, { nodeId: "read_a", toolName: "inspect_file", callId: "new_call" }), { code: "graph_dependency_not_ready" });
});

test("graph links bounded result digests without duplicating private source or artifact contents", () => {
  const a = startGraphNode(graph(), { nodeId: "read_a", toolName: "inspect_file", callId: "a" });
  const one = finishGraphNode(a, { nodeId: "read_a", callId: "a", result: { content: "PRIVATE-SOURCE-TEXT", name: "source.md" } });
  const two = finishGraphNode(a, { nodeId: "read_a", callId: "a", result: { name: "source.md", content: "PRIVATE-SOURCE-TEXT" } });
  assert.deepEqual(one, two, "Equivalent JSON output has stable evidence regardless of key order");
  assert.equal(JSON.stringify(one).includes("PRIVATE-SOURCE-TEXT"), false);
  assert.match(one.nodes[0].attempts[0].result_sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => finishGraphNode(a, { nodeId: "read_a", callId: "a", result: { content: "x".repeat(1_000_001) } }), { code: "graph_evidence_too_large" });
});
