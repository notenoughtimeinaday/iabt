// Design data accompanies the existing creation call. It grants no tools or
// authority and never establishes semantic coverage or tested behavior.
const text = { type: "string", pattern: "^[\\s\\S]{1,800}$" };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (items, minItems = 0, maxItems = 12) => ({ type: "array", items, minItems, maxItems });

export const APP_CONCEPT_CONTRACT = "concept_brief_v1";
export const APP_CONCEPT_SCHEMA = object({
  purpose: text,
  intended_users: list(text, 1, 6),
  workflows: list(object({
    user_goal: text,
    interaction: text,
    resulting_state: text,
    acceptance_check: text,
    edge_case: text
  }), 1),
  data_and_rules: list(text, 1),
  assumptions: list(text),
  limitations: list(text, 1)
});

export const APP_CONCEPT_GUIDANCE = "Before writing HTML, formulate the user's concept as a concise product brief: its purpose, intended users, end-to-end workflows, data and rules, explicit assumptions and limitations. For each workflow describe the user goal, actual interaction, resulting state, an observable manual acceptance check and a relevant edge case. Tailor these to the domain and every explicit requirement, including inspected source requirements. Distinguish requested behavior from assumptions; use conservative defaults for unspecified reversible details. Do not invent working cloud integrations or widen the approved scope. For a revision, focus on the requested change and list existing behavior to preserve. Supply this brief in create_web_app.concept before its html, then implement it. Keep acceptance checks proposed and untested; a filled brief is not proof of understanding or correctness. No additional provider request or separate document export is needed. Reuse the accepted graph and completed source inspections during repairs.";

export function conceptRecord({ concept, request, revision, sourceSha256 }) {
  return {
    version: APP_CONCEPT_CONTRACT,
    provenance: "model_proposed_design",
    objective: request,
    ...(revision ? { revision_of_file_id: revision.file_id, revision_of_sha256: revision.sha256 } : {}),
    source_sha256: sourceSha256,
    concept,
    runtime_tested: false,
    semantic_coverage_verified: false
  };
}
