import { evaluateAction } from "./policy.js";
import { privateAcceptanceAccess } from "./private-acceptance.js";

export function orchestrationConfigured(config, user) {
  const options = config?.orchestration || {};
  return Boolean(options.enabled && options.budgetAccepted && config?.providers?.openai?.apiKey && config.providers.openai.paidEnabled &&
    Number.isSafeInteger(options.budgetCents) && options.budgetCents > 0 &&
    Number.isSafeInteger(options.responseCostCents) && options.responseCostCents > 0 && options.responseCostCents <= options.budgetCents &&
    privateAcceptanceAccess(config, user));
}

// Configured is configuration evidence only. Remote connections remain unknown
// until a real operation establishes health; listing this registry incurs no
// provider charges, sends no email and does not contact infrastructure APIs.
export async function capabilityRegistry({ config = {}, providers, repository, storage, user, observe = true }) {
  const readiness = providers?.readiness?.() || {};
  const probe = async (component) => {
    if (!observe || typeof component?.health !== "function") return null;
    try { return (await component.health())?.ok === true; } catch { return false; }
  };
  const [databaseOk, storageOk] = await Promise.all([probe(repository), probe(storage)]);
  const entry = (id, { configured = true, operational = null, risk = "generate", cost = 0, reversible = true, blockers = [], ...details } = {}) => ({
    id, configured, operational, commercial_ready: null,
    estimated_cost_cents: cost, reversible, risk_class: risk,
    requires_human_approval: evaluateAction({ risk_class: risk, reversible, estimated_cost_cents: cost }, { authorized: true }).requires_human_approval,
    blocker_codes: [...new Set([...(!configured ? ["not_configured"] : []), ...blockers])],
    fallback_capability: null, ...details
  });
  const remote = (id, state, fallback = null, cost = null, risk = "spending") => entry(id, {
    configured: Boolean(state?.configured), operational: null, risk, cost, reversible: false,
    commercial_ready: state?.commercial_ready ?? null,
    blockers: [...(state?.blocker_codes || []), "connectivity_not_verified"], fallback_capability: fallback
  });
  const privateReady = databaseOk === false || storageOk === false ? false : databaseOk === true && storageOk === true ? true : null;
  const videoEnabled = config.creation?.videoEnabled === true;
  const privateBlockers = [...(databaseOk !== true ? ["database_not_verified"] : []), ...(storageOk !== true ? ["storage_not_verified"] : [])];
  const local = (id, limitations) => entry(id, { operational: privateReady, blockers: privateBlockers, implementation: "deterministic", limitations });
  const restricted = (capability) => ({ ...capability, public_creation_enabled: false, new_plan_access: config.creation?.profile === "advanced" ? "administrator_only" : "paused", adapter_preserved: true });
  return {
    version: "jericho-capabilities-v2", observed_at: new Date().toISOString(), base44_required: false,
    creation_profile: config.creation?.profile || "core",
    public_creation_focus: ["app", "website", "document"],
    capabilities: {
      app: local("app", ["Named starters or approved self-contained HTML generation and owned-source revision. Preview/export do not prove runtime correctness."]),
      website: local("website", ["Private preview and source packaging; no public deployment."]),
      document: local("document", ["Export explicitly supplied text or create bounded text source reviews without a paid provider. Original writing requires configured Responses orchestration and an approved quote; request summaries are not completed documents."]),
      code: local("code", ["Scaffold packaging; no isolated execution of generated code."]),
      design: local("design", ["Specification and SVG board; no external design-account changes."]),
      automation: restricted(local("automation", ["Disabled runbooks only; no external execution."])),
      gcode_simulation: restricted(local("gcode_simulation", ["Simulation preparation only; no machine motion."])),
      source_review: local("source_review", ["UTF-8 text/code only; ownership and content hashes verified."]),
      internal_planner: entry("internal_planner", { operational: true, implementation: "server_rules" }),
      openai_responses: remote("openai_responses", { ...readiness.openai, configured: orchestrationConfigured(config, user), blocker_codes: [...(readiness.openai?.blocker_codes || []), ...(!orchestrationConfigured(config, user) ? ["orchestration_budget_not_enabled"] : [])] }, "internal_planner", config.orchestration?.budgetCents || null),
      openai_image: restricted(remote("openai_image", readiness.openai_image, "design", config.providers?.openai?.imageCostCents || null)),
      neon_postgres: entry("neon_postgres", { configured: Boolean(config.databaseUrl), operational: config.databaseUrl ? databaseOk : null, risk: "read", blockers: databaseOk === true ? [] : ["database_not_verified"] }),
      private_storage: entry("private_storage", { configured: Boolean(storage), operational: storageOk, risk: "read", blockers: storageOk === true ? [] : ["storage_not_verified"] }),
      render: remote("render", { configured: Boolean(config.infrastructure?.render) }, null, null, "publication"),
      github: remote("github", { configured: Boolean(config.infrastructure?.github) }, null, null, "publication"),
      resend: remote("resend", { configured: config.email?.provider === "resend" && Boolean(config.email?.apiKey && config.email?.from) }, null, null, "external_communication"),
      stripe: remote("stripe", readiness.stripe),
      elevenlabs: restricted(remote("elevenlabs", readiness.elevenlabs, "document")),
      luma: {
        ...restricted(remote("luma", readiness.luma, "document")),
        feature_enabled: videoEnabled,
        new_plan_access: videoEnabled && config.creation?.profile === "advanced" ? "administrator_only" : "paused",
        blocker_codes: [...new Set([...(readiness.luma?.blocker_codes || []), ...(!videoEnabled ? ["feature_paused"] : []), "connectivity_not_verified"])]
      },
      image_to_video: {
        ...restricted(remote("image_to_video", readiness.luma)),
        feature_enabled: videoEnabled,
        new_plan_access: videoEnabled && config.creation?.profile === "advanced" ? "administrator_only" : "paused",
        blocker_codes: [...new Set([...(readiness.luma?.blocker_codes || []), ...(!videoEnabled ? ["feature_paused"] : []), "connectivity_not_verified"])],
        input_formats: ["image/jpeg", "image/png"],
        max_input_files: 1,
        max_input_bytes: 5 * 1024 * 1024,
        limitations: ["Video rendering is excluded from the current Jericho release. The adapter remains isolated for a separately approved future release.", "No image editing, face restoration or guarantee of visual fidelity. Provider configuration does not establish a funded account or a verified video."]
      },
      file_processing: entry("file_processing", { configured: Boolean(storage), operational: storageOk, risk: "read", blockers: storageOk === true ? [] : ["storage_not_verified"], limitations: ["Bounded UTF-8 text/code extraction for source reviews. A verified JPEG/PNG video input remains adapter-only while video rendering is excluded. Image editing, PDF/Office interpretation and uploaded-code execution remain unsupported."] }),
      background_jobs: entry("background_jobs", { configured: Boolean(repository), operational: null, blockers: ["worker_heartbeat_not_observed"] }),
      scheduled_maintenance: entry("scheduled_maintenance", { configured: Boolean(repository?.claimDueMaintenance && config.maintenance?.enabled), operational: null, risk: "validate", blockers: ["maintenance_pass_not_observed"], implementation: "durable_account_schedule", limitations: ["Requires a running worker; inspect the account maintenance snapshot for actual progress.", "Repairs derived records and checks bounded private files using existing infrastructure; does not charge credits or execute paid generation.", "Cannot edit code, deploy or certify launch readiness."] }),
      artifact_verification: entry("artifact_verification", { configured: Boolean(storage), operational: storageOk, risk: "validate", blockers: storageOk === true ? [] : ["storage_not_verified"] })
    }
  };
}
