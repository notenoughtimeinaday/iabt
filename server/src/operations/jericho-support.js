// Deterministic operational knowledge, grounded in the signed-in account's
// persisted records and current configuration. This module never runs jobs,
// calls providers, changes permissions, or updates model weights.
export const SUPPORTED_AGENT_NAMES = Object.freeze(["iabt_creator", "iabt_exchange"]);

const FAILURE_GUIDES = [
  [/^(?:openai|openai_image|elevenlabs|luma)_not_configured$/, "provider_configuration", "Ask the administrator to configure and verify this provider before approving a new production quote."],
  [/^(?:openai|elevenlabs|luma)_(?:authentication_failed|access_denied)$/, "provider_access", "Ask the administrator to verify provider credentials and permissions. Do not paste secrets into chat."],
  [/^(?:openai|elevenlabs|luma)_insufficient_balance$/, "provider_balance", "Ask the administrator to check the supplier balance and approved spending limits before retrying."],
  [/^(?:explicit_approval_required|commercial_approval_required|cost_ceiling_exceeded)$/, "approval_required", "Review the quote and required approval. Configuration or spending gates cannot be bypassed by chat."],
  [/^(?:openai|elevenlabs|luma)_(?:rate_limited|provider_unavailable)$/, "provider_transient", "Check the job status before submitting again. Any existing retry remains within its original approval and attempt budget."],
  [/^(?:durable_output_required|luma_invalid_video|openai_invalid_image|elevenlabs_invalid_audio|luma_generation_failed|luma_generation_timeout)$/, "unverified_output", "No verified delivery is established by this failure. Check the job's artifact and credit records; provider charges require separate reconciliation."],
  [/^(?:job_lease_lost|job_attempts_exhausted|provider_outcome_unknown|provider_submission_uncertain)$/, "execution_uncertain", "Ask the administrator to reconcile the provider submission and job ledger before approving another paid request."],
  [/^(?:email_not_configured|email_delivery_failed)$/, "account_email", "Ask the administrator to verify transactional email configuration and delivery before requesting another code."],
  [/^(?:unsupported_job_type|function_not_migrated)$/, "unsupported_capability", "This operation needs an implemented and verified standalone handler before it can run."]
];

export const describeFailure = (value) => {
  const code = String(value || "");
  const match = FAILURE_GUIDES.find(([pattern]) => pattern.test(code));
  return match
    ? { code, category: match[1], next_action: match[2] }
    : {
        code: "unclassified_failure",
        category: "needs_investigation",
        next_action: "Share the incident ID with the administrator for investigation. Do not repeat a paid request until its outcome is reconciled."
      };
};

const nonnegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const safeId = (value) => /^[a-zA-Z0-9_-]{1,100}$/.test(String(value || "")) ? String(value) : null;
const safeDate = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeStatus = (value) => ["queued", "running", "succeeded", "failed", "needs_setup"].includes(value) ? value : "unknown";

const providerSummary = (readiness = {}, role) => Object.fromEntries(
  ["openai", "openai_image", "elevenlabs", "luma", "stripe"].map((name) => {
    const value = readiness[name] || {};
    const technical = value.configured === true;
    const media = ["openai_image", "elevenlabs", "luma"].includes(name);
    return [name, {
      technically_configured: technical,
      commercial_ready: media ? technical && value.commercial_ready === true : null,
      owner_demo_available: media && role === "admin" && technical,
      checkout_ready: name === "stripe" ? value.checkout_ready === true : null,
      live_probe_performed: false
    }];
  })
);

export const buildJerichoKnowledge = async ({ repository, user, providers, storage, config }) => {
  if (!user?.id) throw Object.assign(new Error("Authentication required"), { status: 401, code: "auth_required" });
  // Even an owner conversation is scoped to the owner's account. Administrative
  // investigation of another account belongs in explicitly authorized tools.
  const account = { ...user, role: "user" };
  const [rawJobs, rawIncidents] = await Promise.all([
    repository.listJobs(account, { limit: 50 }),
    repository.listIncidents(account, { limit: 50 })
  ]);
  const jobs = rawJobs.filter((job) => job.owner_id === user.id).slice(0, 50).map((job) => ({
    job_id: safeId(job.id),
    status: safeStatus(job.status),
    attempt_count: nonnegative(job.attempt_count),
    max_attempts: nonnegative(job.max_attempts),
    verified_output: job.status === "succeeded" && job.output?.verified === true,
    released_credits: job.output?.recovery === "credit_release" ? nonnegative(job.output?.released_credits) : null,
    incident_id: safeId(job.output?.incident_id),
    failure: job.last_error_code ? describeFailure(job.last_error_code) : null,
    updated_at: safeDate(job.updated_date)
  }));
  const incidents = rawIncidents.filter((incident) => incident.owner_id === user.id).slice(0, 50).map((incident) => ({
    incident_id: safeId(incident.id),
    job_id: safeId(incident.job_id),
    ...describeFailure(incident.error_code),
    resolved: Boolean(incident.resolved_at),
    created_at: safeDate(incident.created_date)
  }));
  const patterns = Object.values(incidents.reduce((result, incident) => {
    const entry = result[incident.code] ||= { code: incident.code, occurrences: 0, next_action: incident.next_action };
    entry.occurrences += 1;
    return result;
  }, {}));
  const ready = providerSummary(providers?.readiness?.(), user.role);
  return {
    version: "jericho-operations-v1",
    runtime: "standalone",
    base44_required: false,
    evidence_scope: "signed_in_account_latest_50_jobs_and_incidents",
    observed_at: new Date().toISOString(),
    capabilities: {
      planning: "deterministic_intent_routing_with_server_signed_quotes",
      interactive: "bounded_templates_with_html_preview_and_react_source_zip",
      documents: "markdown_docx_pdf_exports",
      code: "bounded_javascript_scaffolds_with_limitation_reports",
      design: "tokens_and_svg_review_boards",
      gcode: "simulation_only_no_machine_execution",
      automation: "disabled_dry_run_runbooks_no_scheduler",
      files: "private_upload_authorized_download_and_bounded_utf8_source_review",
      exchange: "authenticated_profiles_matching_mutual_introductions_and_private_rooms",
      integrations: "route_preferences_and_configuration_discovery_no_external_account_authorization",
      support: "read_only_capability_and_account_incident_diagnostics"
    },
    infrastructure: {
      persistence_configured: Boolean(config?.databaseUrl),
      storage_configured: Boolean(storage),
      storage_kind: ["s3", "local"].includes(storage?.kind) ? storage.kind : "unavailable",
      email_configured: config?.email?.provider === "resend" && Boolean(config.email.apiKey && config.email.from),
      email_delivery_verified: false,
      worker_liveness: "not_probed",
      deployment_verified: false
    },
    providers: ready,
    recent_jobs: jobs,
    recent_incidents: incidents,
    recurring_failure_patterns: patterns,
    active_incident_count: incidents.filter((item) => !item.resolved).length,
    learning: {
      source: "persisted_incidents_and_current_runtime_configuration",
      model_training: false,
      self_modification: false,
      automatic_fix_execution: false
    },
    limits: [
      "This snapshot describes implemented code and configured adapters; it is not a live deployment or provider test.",
      "Chat does not train a model, change source code, credentials, permissions, DNS, or publish a release.",
      "Paid production requires a valid quote, explicit approval, credits, and provider gates; chat cannot bypass them.",
      "Provider outcomes must be reconciled before repeating an ambiguous paid submission.",
      "Credit restoration is reported only when the job records it; IABT credit restoration is not a supplier or cash refund.",
      "Attached UTF-8 text, Markdown, JSON, CSV, and common code files support deterministic document source reviews (128 KiB / 2,000 lines per file, 256 KiB / 4,000 lines total, up to 12 files). PDF, Office, archives, media, general semantic analysis, and uploaded-code execution are unsupported. No uploaded file is sent to a model by this workflow.",
      "External AI-client consent is unavailable. Exchange changes use authenticated Exchange workflows; this support responder does not perform them."
    ]
  };
};

const isSupportRequest = (text) => {
  const normalized = String(text || "").trim().toLowerCase();
  // Creation requests that happen to mention an error must still reach planning.
  if (/^(?:(?:please|can you|could you)\s+)?(?:create|build|generate|write|design|make)\b/.test(normalized)) return false;
  return /\b(?:diagnos\w*|troubleshoot\w*|recover\w*|incident|system health|capabilit\w*|what can you|what do you know|what (?:is|are) (?:supported|available)|why (?:did|does|is|has)|learn from|self[- ]heal|my (?:job|audio|video|image).*(?:failed|stuck|broken)|check.*(?:status|health)|retry.*(?:job|failure))\b/.test(normalized);
};

export const respondToSupportRequest = async (context) => {
  const exchange = context.agentName === "iabt_exchange";
  if (!exchange && !isSupportRequest(context.requestText)) return null;
  const knowledge = await buildJerichoKnowledge(context);
  const content = [
    exchange
      ? "I can explain the standalone runtime and review your account's recorded failures. Use the authenticated Exchange workflows to manage your profile, find matches, approve mutual introductions, and enter private rooms. This chat response is read-only and has not contacted anyone or changed your Exchange records."
      : "I can inspect my implemented features and your account's recorded job outcomes. These are read-only observations; no production job or provider charge was started.",
    "Available creation paths include bounded app/website templates, document exports, code scaffolds, design boards, simulation-only G-code, and disabled automation runbooks. Media production depends on provider configuration, commercial gates, and an approved quote.",
    "Latest account evidence: " + knowledge.recent_jobs.length + " job(s), " + knowledge.active_incident_count + " unresolved incident(s) in the latest 50 records.",
    ...knowledge.recent_jobs.slice(0, 5).map((job) =>
      "Job " + job.job_id + ": " + job.status +
      (job.verified_output ? "; verified output recorded" : "; no verified delivery established by this snapshot") +
      (job.released_credits !== null ? "; " + job.released_credits + " IABT credit(s) restored in the job record" : "; credit restoration not recorded here") + "."
    ),
    ...knowledge.recurring_failure_patterns.slice(0, 5).map((failure) =>
      failure.code + " (" + failure.occurrences + " recorded occurrence(s)): " + failure.next_action
    ),
    ...(!knowledge.infrastructure.email_configured ? ["Account verification and recovery email need administrator configuration."] : []),
    "I use persisted incident history and current configuration to support diagnosis. I do not train myself or alter code, access, or spending permissions. Live worker health, email delivery, and public deployment still need independent verification."
  ].join("\n\n");
  return { content, metadata: { response_kind: "operational_support", knowledge_version: knowledge.version, knowledge } };
};
