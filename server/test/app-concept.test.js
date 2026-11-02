import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { registeredTools, toolDefinitions, invokeTool } from "../src/autonomy/tools.js";
import { APP_CONCEPT_CONTRACT } from "../src/creation/app-concept.js";

const concept = {
  purpose: "Track borrowed garden equipment", intended_users: ["Garden volunteers"],
  workflows: [{ user_goal: "Record a loan", interaction: "Choose available equipment and enter a return date", resulting_state: "Equipment becomes unavailable until returned", acceptance_check: "Loan the spade and verify that a second loan is blocked", edge_case: "Reject a return date before the loan date" }],
  data_and_rules: ["Each equipment item has a unique ID", "Only one active loan per item"],
  assumptions: ["One browser holds the records"], limitations: ["No shared cloud storage", "Acceptance checks have not run"]
};
const html = '<!doctype html><html><head><title>Garden loans</title></head><body><h1>Garden loans</h1></body></html>';
function fixture(contract = APP_CONCEPT_CONTRACT) {
  const user = { id: "owner", email_verified: true };
  const job = { owner_id: user.id, input: { app_output_contract: "self_contained_html_v1", request_text: "Build a garden equipment app", ...(contract ? { app_concept_contract: contract } : {}) } };
  const tools = registeredTools({ user, job });
  const invoke = (args) => invokeTool({ tools, user, job, call: { name: "create_web_app", arguments: JSON.stringify({ node_id: "build", title: "Garden loans", html, ...args }) } });
  return { user, job, tools, invoke };
}
function unzipStored(bytes) {
  const files = {};
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + nameSize + extra;
    files[bytes.subarray(offset + 30, offset + 30 + nameSize).toString()] = bytes.subarray(start, start + size);
    offset = start + size;
  }
  return files;
}

test("new app tool requires bounded substantive concept data and rejects authority fields", async () => {
  const f = fixture();
  const schema = toolDefinitions(f.tools, f.user, f.job).find(tool => tool.name === "create_web_app").parameters;
  assert.deepEqual(Object.keys(schema.properties), ["node_id", "title", "concept", "html"]);
  for (const input of [undefined, {}, { ...concept, purpose: " " }, { ...concept, purpose: "x".repeat(801) }, { ...concept, workflows: [] }, { ...concept, workflows: Array(13).fill(concept.workflows[0]) }, { ...concept, execute_shell: true }]) {
    await assert.rejects(f.invoke(input === undefined ? {} : { concept: input }), { code: "invalid_tool_input" });
  }
});

test("concept package retains design, objective, source hash and untested boundaries", async () => {
  const f = fixture();
  const result = await f.invoke({ concept });
  assert.equal(result.artifacts.length, 2);
  const app = Buffer.from(result.artifacts[0].content_base64, "base64");
  const files = unzipStored(Buffer.from(result.artifacts[1].content_base64, "base64"));
  assert.deepEqual(files["index.html"], app);
  const design = JSON.parse(files["DESIGN.json"]);
  assert.deepEqual(design.concept, concept);
  assert.equal(design.objective, f.job.input.request_text);
  assert.equal(design.source_sha256, createHash("sha256").update(app).digest("hex"));
  assert.equal(result.artifacts[0].metadata.concept_sha256, createHash("sha256").update(files["DESIGN.json"]).digest("hex"));
  assert.equal(design.provenance, "model_proposed_design");
  assert.equal(design.runtime_tested, false);
  assert.equal(design.semantic_coverage_verified, false);
  assert.match(files["REVIEW.md"].toString(), /DESIGN.json/);
});

test("old app jobs retain their tool schema and source package without regeneration", async () => {
  const f = fixture(null);
  const result = await f.invoke({});
  const files = unzipStored(Buffer.from(result.artifacts[1].content_base64, "base64"));
  assert.deepEqual(Object.keys(files), ["index.html", "README.md", "REVIEW.md"]);
  await assert.rejects(f.invoke({ concept }), { code: "invalid_tool_input" });
});
