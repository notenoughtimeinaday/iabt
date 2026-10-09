import { createHash } from "node:crypto";

export const GRAPH_LIMITS = Object.freeze({ nodes: 16, depth: 8, attempts: 3, objectiveCharacters: 1200 });
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clone = (value) => structuredClone(value);
const safeId = (value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
const safeCallId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const objective = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > GRAPH_LIMITS.objectiveCharacters) fail("graph_invalid_objective", "Supply a bounded, nonempty execution objective.");
  return value.trim();
};
const spec = (node) => [node.id, node.tool, node.objective, [...node.depends_on].sort()];
const hasEvidence = (node) => node.status !== "pending" || node.attempts.length > 0;
const assertGraph = (graph) => {
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || graph.nodes.length < 1 || graph.nodes.length > GRAPH_LIMITS.nodes) fail("graph_required", "Plan a valid execution graph before running this tool.");
};

// Proposed graphs contain planning data only. Status, approvals, costs, tool
// arguments and evidence are never accepted from model-authored graph objects.
export function validateExecutionGraph(proposed, { toolNames = [], previousGraph = null } = {}) {
  if (!exactKeys(proposed, ["objective", "nodes"]) || !Array.isArray(proposed.nodes) || proposed.nodes.length < 1 || proposed.nodes.length > GRAPH_LIMITS.nodes) {
    fail("graph_invalid_shape", "A graph needs an objective and between 1 and 16 nodes.");
  }
  const graphObjective = objective(proposed.objective);
  const knownTools = new Set(toolNames);
  const nodes = proposed.nodes.map((node) => {
    if (!exactKeys(node, ["id", "tool", "objective", "depends_on"]) || !safeId(node.id) ||
        !Array.isArray(node.depends_on) || node.depends_on.length > GRAPH_LIMITS.nodes ||
        node.depends_on.some((id) => !safeId(id)) || new Set(node.depends_on).size !== node.depends_on.length) {
      fail("graph_invalid_node", "Graph nodes need a unique ID, registered tool, objective and unique dependency IDs.");
    }
    if (typeof node.tool !== "string" || !knownTools.has(node.tool) || node.tool === "plan_execution") fail("graph_unknown_tool", "A graph may use only registered execution tools.");
    return { id: node.id, tool: node.tool, objective: objective(node.objective), depends_on: [...node.depends_on], status: "pending", attempts: [] };
  });
  const index = new Map(nodes.map((node) => [node.id, node]));
  if (index.size !== nodes.length) fail("graph_duplicate_node", "Graph node IDs must be unique.");
  for (const node of nodes) {
    if (node.depends_on.some((id) => !index.has(id))) fail("graph_missing_dependency", "Every dependency must identify a node in this graph.");
  }
  const visiting = new Set();
  const depths = new Map();
  const depth = (id) => {
    if (visiting.has(id)) fail("graph_cycle", "Execution graphs cannot contain cycles.");
    if (depths.has(id)) return depths.get(id);
    visiting.add(id);
    const value = 1 + Math.max(0, ...index.get(id).depends_on.map(depth));
    visiting.delete(id);
    if (value > GRAPH_LIMITS.depth) fail("graph_too_deep", "The execution graph exceeds its bounded dependency depth.");
    depths.set(id, value);
    return value;
  };
  nodes.forEach((node) => depth(node.id));
  if (previousGraph) {
    assertGraph(previousGraph);
    if (previousGraph.nodes.some(hasEvidence) && previousGraph.objective !== graphObjective) fail("graph_evidence_immutable", "An executed graph must retain its original objective.");
    for (const old of previousGraph.nodes) {
      const next = index.get(old.id);
      if (hasEvidence(old) && (!next || JSON.stringify(spec(old)) !== JSON.stringify(spec(next)))) {
        fail("graph_evidence_immutable", "Executed nodes and their dependencies cannot be rewritten or removed.");
      }
      if (next && JSON.stringify(spec(old)) === JSON.stringify(spec(next))) {
        next.status = old.status;
        next.attempts = clone(old.attempts);
      }
    }
  }
  return { version: 1, revision: (previousGraph?.revision || 0) + 1, objective: graphObjective, nodes };
}

export function readyGraphNodes(graph) {
  assertGraph(graph);
  const index = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.nodes.filter((node) => ["pending", "failed"].includes(node.status) && node.attempts.length < GRAPH_LIMITS.attempts &&
    node.depends_on.every((id) => index.get(id)?.status === "succeeded")).map((node) => clone(node));
}

export function startGraphNode(graph, { nodeId, toolName, callId }) {
  assertGraph(graph);
  if (!safeCallId(callId)) fail("graph_invalid_call", "Tool calls need a stable call ID.");
  const next = clone(graph);
  const node = next.nodes.find((item) => item.id === nodeId);
  if (!node || node.tool !== toolName) fail("graph_tool_mismatch", "This tool does not match the selected graph node.");
  const prior = next.nodes.flatMap((item) => item.attempts.map((attempt) => ({ node: item, attempt }))).find((item) => item.attempt.call_id === callId);
  if (prior) {
    if (prior.node.id === nodeId && node.status === "running" && prior.attempt.status === "running") return next;
    fail("graph_call_identity_conflict", "A recorded tool call cannot execute again or bind to another node.");
  }
  if (!readyGraphNodes(next).some((item) => item.id === nodeId)) {
    if (node.attempts.length >= GRAPH_LIMITS.attempts) fail("graph_attempt_limit", "This graph node exhausted its bounded attempts.");
    fail("graph_dependency_not_ready", "Only an uncompleted node whose dependencies succeeded can run.");
  }
  node.status = "running";
  node.attempts.push({ call_id: callId, status: "running" });
  return next;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function finishGraphNode(graph, { nodeId, callId, result = null, error = null }) {
  assertGraph(graph);
  const next = clone(graph);
  const node = next.nodes.find((item) => item.id === nodeId);
  const attempt = node?.attempts.at(-1);
  if (!node || node.status !== "running" || attempt?.status !== "running" || attempt.call_id !== callId) {
    fail("graph_call_identity_conflict", "Only the active call can record this node's outcome.");
  }
  const evidence = JSON.stringify(canonical(result));
  if (evidence.length > 1_000_000) fail("graph_evidence_too_large", "Graph outcome evidence exceeds its size limit.");
  node.status = error ? "failed" : "succeeded";
  attempt.status = node.status;
  // Full output remains in the durable tool-call journal. A digest links graph
  // history to that evidence without copying files or source content again.
  attempt.result_sha256 = createHash("sha256").update(evidence).digest("hex");
  if (error) attempt.error_code = /^[a-zA-Z0-9_-]{1,100}$/.test(error.code || error) ? String(error.code || error) : "tool_failed";
  return next;
}

export function executionGraphComplete(graph) {
  assertGraph(graph);
  return graph.nodes.every((node) => node.status === "succeeded");
}
