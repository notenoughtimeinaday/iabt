// Discovery exposes only configuration evidence. It never authenticates, spends,
// or upgrades a stored preference into a verified external connection.
const FUNCTION_NAMES = new Set([
  "get-integration-center", "set-integration-preference",
  "get-connection-fabric", "get-commercial-control"
]);
const MODES = new Set(["customer_account", "iabt_managed", "not_selected"]);
const CATALOG = [
  { id: "github", name: "GitHub", category: "Development", auth_method: "oauth", customer_cost: "Your GitHub account", managed_supported: false,
    description: "Repository and deployment handoff. Independent account authorization is not installed.", setup_prompt: "Plan a GitHub connection with minimum repository permissions." },
  { id: "stripe_commerce", name: "Stripe for project commerce", category: "Payments", auth_method: "oauth", customer_cost: "Your Stripe processing fees", managed_supported: false,
    description: "Generated-project payments remain separate from IABT billing. Account authorization is not installed.", setup_prompt: "Plan my project's Stripe checkout while keeping IABT billing separate." },
  { id: "openai", name: "OpenAI", category: "Intelligence", auth_method: "api_key", customer_cost: "Your OpenAI API usage", managed_supported: true,
    description: "Server-side Responses API generation subject to configured cost and approval controls.", setup_prompt: "Check the server-side OpenAI route and approval requirements." },
  { id: "elevenlabs", name: "ElevenLabs", category: "Audio", auth_method: "api_key", customer_cost: "Your ElevenLabs credits", managed_supported: true,
    description: "Original instrumental audio with server-side provider authorization and durable output verification.", setup_prompt: "Check audio provider configuration, cost and commercial approval before quoting." },
  { id: "luma", name: "Luma", category: "Video", auth_method: "api_key", customer_cost: "Your Luma provider balance", managed_supported: true,
    description: "Video generation with polling, private storage, cost and commercial approval gates.", setup_prompt: "Check video provider configuration, cost and commercial approval before quoting." },
  { id: "dns", name: "Domains and DNS", category: "Publishing", auth_method: "scoped_token", customer_cost: "Your registrar or DNS provider", managed_supported: false,
    description: "Domain setup planning. An independently authorized DNS execution adapter is not installed.", setup_prompt: "Prepare exact domain records for review before any DNS change." }
];
const reply = (data) => ({ status: 200, payload: { data } });
const reject = (status, code, error) => ({ status, payload: { error, code } });
const text = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const list = (value) => Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean).slice(0, 30) : [];
const integer = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const ownerActor = (user) => ({ ...user, role: "user" });
const managedReady = (id, readiness) => Boolean(
  readiness[id]?.configured && (id === "openai" || readiness[id]?.commercial_ready)
);
const safeReadiness = (value = {}) => ({
  configured: value.configured === true,
  commercial_ready: value.commercial_ready === true,
  blocker_codes: list(value.blocker_codes)
});

async function integrationCenter({ repository, user, readiness }) {
  const rows = await repository.listRecords("IntegrationConnection", ownerActor(user), {
    query: { user_id: user.id }, sort: "-updated_date", limit: 100
  });
  const byProvider = new Map();
  for (const row of rows) {
    if (row.owner_id === user.id && !byProvider.has(row.provider)) byProvider.set(row.provider, row);
  }
  return reply({
    ok: true,
    providers: CATALOG.map((item) => {
      const row = byProvider.get(item.id);
      const preference = MODES.has(row?.connection_mode) &&
        (row.connection_mode !== "iabt_managed" || item.managed_supported)
        ? row.connection_mode : "not_selected";
      const ready = item.managed_supported && managedReady(item.id, readiness);
      return {
        ...item, preference,
        status: preference === "not_selected" ? "not_selected"
          : preference === "iabt_managed" && ready ? "ready" : "setup_required",
        connection_status: "not_connected",
        managed_status: item.managed_supported ? ready ? "available" : "setup_required" : "not_supported",
        cost_owner: preference === "iabt_managed" ? "iabt" : preference === "customer_account" ? "customer" : "not_selected",
        external_account_label: "", scopes: [], last_health_at: null,
        customer_authorization_supported: false,
        setup_requires_user_authorization: true,
        readiness_scope: "server_configuration_only",
        per_job_approval_required: true,
        blocker_codes: preference === "customer_account" ? ["customer_authorization_not_implemented"]
          : item.managed_supported ? safeReadiness(readiness[item.id]).blocker_codes : []
      };
    }),
    iabt_billing: {
      name: "IABT plans and credits", merchant: "Insured Spending, LLC", provider: "Stripe",
      status: readiness.stripe?.checkout_ready ? "configured" : "setup_required",
      mode: readiness.stripe?.mode === "live" ? "live" : "test",
      separation_rule: "IABT billing credentials are never copied into generated projects."
    },
    security: {
      credentials_in_prompts: false, credentials_in_frontend: false, credentials_in_artifacts: false,
      external_authorization_required: true,
      note: "Saving a route preference does not connect an account, store credentials, or authorize charges."
    }
  });
}

async function setPreference({ body, repository, user }) {
  const provider = text(body.provider, 80).toLowerCase();
  const mode = text(body.connection_mode, 80).toLowerCase();
  const item = CATALOG.find((entry) => entry.id === provider);
  if (!item) return reject(400, "unsupported_provider", "Unsupported integration provider.");
  if (!MODES.has(mode)) return reject(400, "unsupported_connection_mode", "Unsupported connection mode.");
  if (mode === "iabt_managed" && !item.managed_supported) {
    return reject(400, "customer_account_required", "This integration requires the project owner's account.");
  }
  const actor = ownerActor(user);
  const rows = await repository.listRecords("IntegrationConnection", actor, {
    query: { user_id: user.id, provider }, sort: "-updated_date", limit: 100
  });
  const existing = rows.find((row) => row.owner_id === user.id);
  const record = {
    user_id: user.id, provider, connection_mode: mode,
    status: mode === "not_selected" ? "not_connected" : "setup_required",
    auth_method: mode === "iabt_managed" ? "platform_managed" : item.auth_method,
    cost_owner: mode === "iabt_managed" ? "iabt" : mode === "customer_account" ? "customer" : "not_selected",
    metadata: { credential_stored: false, selection_only: true, updated_from: "integration_center" }
  };
  const saved = existing
    ? await repository.updateRecord("IntegrationConnection", existing.id, actor, record)
    : await repository.createRecord("IntegrationConnection", actor, record);
  if (!saved) return reject(409, "preference_conflict", "The route changed. Refresh and try again.");
  return reply({
    ok: true,
    connection: { id: saved.id, provider, connection_mode: mode, status: record.status,
      auth_method: record.auth_method, cost_owner: record.cost_owner },
    next_action: mode === "customer_account"
      ? "Your preference is saved. Independent customer-account authorization still requires implementation; no account is connected."
      : mode === "iabt_managed"
        ? "JERICHO will check provider readiness and require approval for each quoted job."
        : "No provider route is selected.",
    credentials_changed: false, charged: false
  });
}

const adapter = (id, name, intents, capabilities, readiness, extra = {}) => ({
  adapter_id: id, display_name: name, supported_intents: intents, capabilities,
  status: readiness ? "active" : "setup_required", enabled: true, source: "system",
  interface_type: "https_api", auth_mode: "secret_reference", priority: 50,
  operations: ["plan", "quote", "approve", "execute", "verify"],
  execution_function: "execute-creation", verification_mode: "artifact", risk_tier: "medium",
  readiness_scope: "server_configuration_only", ...extra
});

// A saved manifest describes an adapter; it cannot install executable code or
// override the authoritative readiness of a built-in route.
async function connectionFabric({ body, repository, user, readiness }) {
  const adapters = [
    adapter("iabt-standalone-artifacts", "IABT deterministic creation", ["app", "website", "document", "code", "design", "gcode", "automation"],
      ["app_packages", "document_export", "code_scaffolds", "design_specs", "simulation_only_gcode", "disabled_automation_runbooks"], true,
      { priority: 10, interface_type: "platform", auth_mode: "session", risk_tier: "low" }),
    adapter("openai-responses", "OpenAI Responses", ["app", "website", "document", "code"], ["structured_generation"], managedReady("openai", readiness), { priority: 20 }),
    adapter("openai-images", "OpenAI images", ["image", "design"], ["image_generation"], managedReady("openai_image", readiness), { priority: 30 }),
    adapter("elevenlabs-audio", "ElevenLabs audio", ["audio"], ["original_instrumental_audio"], managedReady("elevenlabs", readiness), { priority: 40 }),
    adapter("luma-video", "Luma video", ["video"], ["video_generation"], managedReady("luma", readiness), { priority: 50 })
  ];
  // Administrative records are read globally but only administrator-owned
  // manifests may appear. Legacy/user-authored status claims are not authority.
  const stored = await repository.listRecords("ConnectionAdapter", { id: user.id, role: "admin" }, {
    query: { enabled: true }, sort: "priority", limit: 100
  });
  const trusted = await administratorOwned(stored, repository);
  const ids = new Set(adapters.map((item) => item.adapter_id));
  for (const row of trusted) {
    const id = text(row.adapter_id, 120);
    if (!id || ids.has(id) || /base44/i.test(id)) continue;
    ids.add(id);
    adapters.push({
      adapter_id: id, display_name: text(row.display_name),
      supported_intents: list(row.supported_intents), capabilities: list(row.capabilities),
      interface_type: text(row.interface_type, 80),
      status: "setup_required", enabled: true, source: "admin_manifest",
      priority: 100, execution_function: "", operations: [],
      readiness_scope: "manifest_only", blocker_codes: ["standalone_adapter_not_installed"]
    });
  }
  const intent = text(body.intent, 80).toLowerCase();
  const requested = text(body.requested_system || body.system, 500).toLowerCase();
  const words = [...new Set(requested.split(/[^a-z0-9]+/).filter((word) => word.length > 2))];
  const candidates = adapters.map((item) => {
    const haystack = [item.adapter_id, item.display_name, ...item.capabilities].join(" ").toLowerCase();
    const relevance = (item.supported_intents.includes(intent) ? 5 : 0) + words.filter((word) => haystack.includes(word)).length;
    return { item, score: relevance + (item.status === "active" ? 2 : 0) };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.priority - b.item.priority)
    .slice(0, 6).map(({ item }) => item.adapter_id);
  return reply({
    ok: true, discovery_only: true, charged: false,
    fabric: {
      version: "iabt-standalone-fabric-1", adapters, route_candidates: candidates,
      status_counts: adapters.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), {}),
      interfaces: [{ id: "platform", name: "IABT creation" }, { id: "https_api", name: "Server-side provider APIs" }],
      positioning: "Standalone adapters describe installed capabilities and current configuration.",
      routing_rule: "Check configuration, quote cost, require authorization, execute and verify durable output.",
      credentials_rule: "Credentials remain in server-side configuration, outside prompts, manifests and artifacts.",
      autonomy: { connection_truth: "Configuration readiness does not prove a funded account, live provider availability, or deployment health.",
        approval_required: "Paid jobs require explicit approval. External-account, DNS and machine-control execution are not installed." }
    },
    note: "Discovery performs no provider calls and creates no external connections."
  });
}

async function administratorOwned(records, repository) {
  const owners = new Map(await Promise.all(
    [...new Set(records.map((record) => record.owner_id))].map(async (ownerId) =>
      [ownerId, (await repository.getUser(ownerId))?.role === "admin"])
  ));
  return records.filter((record) => owners.get(record.owner_id));
}

const approvedAgreement = (row) => ["standard_terms_approved", "contract_approved"].includes(row.status) &&
  row.embedded_use_allowed === true && row.white_label_allowed === true &&
  row.commercial_output_allowed === true && row.customer_data_allowed === true &&
  ["accepted", "not_required"].includes(row.dpa_status) &&
  (!row.next_review_at || (Number.isFinite(Date.parse(row.next_review_at)) && Date.parse(row.next_review_at) > Date.now()));
const safeAgreement = (row) => ({
  id: row.id, provider_id: text(row.provider_id), display_name: text(row.display_name),
  service_category: text(row.service_category), status: text(row.status, 80), billing_mode: text(row.billing_mode, 80),
  embedded_use_allowed: row.embedded_use_allowed === true, white_label_allowed: row.white_label_allowed === true,
  commercial_output_allowed: row.commercial_output_allowed === true, customer_data_allowed: row.customer_data_allowed === true,
  dpa_status: text(row.dpa_status, 80), next_review_at: text(row.next_review_at, 80) || null,
  approval_complete: approvedAgreement(row)
});
const safePolicy = (row = {}) => ({
  id: row.id, policy_id: text(row.policy_id), provider_id: text(row.provider_id), capability_id: text(row.capability_id),
  status: text(row.status, 80) || "not_configured",
  retail_credit_value_cents: integer(row.retail_credit_value_cents),
  provider_cost_per_credit_cents: integer(row.provider_cost_per_credit_cents),
  target_margin_bps: integer(row.target_margin_bps), minimum_margin_bps: integer(row.minimum_margin_bps),
  maximum_job_cost_cents: integer(row.maximum_job_cost_cents), daily_spend_limit_cents: integer(row.daily_spend_limit_cents),
  monthly_spend_limit_cents: integer(row.monthly_spend_limit_cents), purchased_credits_required: row.purchased_credits_required === true
});

async function commercialControl({ user, repository, readiness, config }) {
  if (user.role !== "admin") return reject(403, "admin_required", "Administrator access required.");
  const [agreementRows, policyRows, spendRows, acceptances] = await Promise.all([
    repository.listRecords("ProviderAgreement", user, { sort: "-updated_date", limit: 1000 }),
    repository.listRecords("CommercialPolicy", user, { sort: "-updated_date", limit: 1000 }),
    repository.listRecords("ProviderSpendLedger", user, { sort: "-occurred_at", limit: 5000 }),
    repository.listRecords("PolicyAcceptance", user, { sort: "-accepted_at", limit: 5000 })
  ]);
  const agreements = (await administratorOwned(agreementRows, repository)).map(safeAgreement);
  const policies = (await administratorOwned(policyRows, repository)).map(safePolicy);
  const timestamp = new Date().toISOString();
  const day = timestamp.slice(0, 10);
  const month = timestamp.slice(0, 7);
  const spend = spendRows.filter((row) => row.status !== "reversed" && row.event_type !== "refunded");
  const sum = (rows) => rows.reduce((total, row) => total + integer(row.amount_cents), 0);
  const billing = { ready: readiness.stripe?.checkout_ready === true,
    mode: config.providers.stripe.mode === "live" ? "live" : "test",
    ...safeReadiness(readiness.stripe) };
  const approved = agreements.filter((row) => row.approval_complete);
  const mediaApproved = managedReady("luma", readiness) && approved.some((row) => row.provider_id === "luma");
  const snapshotLimited = agreementRows.length === 1000 || policyRows.length === 1000 || spendRows.length === 5000 || acceptances.length === 5000;
  return reply({
    ok: true, generated_at: timestamp, billing,
    media: { ...safeReadiness(readiness.luma), commercial_approved: mediaApproved },
    commercial: {
      policy_version: "iabt-standalone-commercial-observation-1",
      default_policy: policies.find((row) => row.provider_id === "*" && row.capability_id === "*" && row.status === "active") || safePolicy(),
      agreements, policies, enforcement_ready: false,
      spend: { day_key: day, month_key: month,
        accounting_complete: false,
        accounting_blocker: "standalone_spend_ledger_not_recorded",
        daily_committed_cents: null,
        monthly_committed_cents: null,
        recorded_totals_label: "Stored ledger entries only; excludes unrecorded standalone provider calls.",
        daily_recorded_cents: sum(spend.filter((row) => row.day_key === day)),
        monthly_recorded_cents: sum(spend.filter((row) => row.month_key === month)),
        lifetime_recorded_cents: sum(spend), snapshot_limit_reached: spendRows.length === 5000,
        recent_events: spendRows.slice(0, 25).map((row) => ({ id: row.id, provider_id: text(row.provider_id),
          amount_cents: integer(row.amount_cents), status: text(row.status, 80), event_type: text(row.event_type, 80), occurred_at: text(row.occurred_at, 80) })) }
    },
    acceptance: { policy_version: "2026-09-01.1", recorded_count: acceptances.filter((row) => row.policy_version === "2026-09-01.1").length,
      snapshot_limit_reached: acceptances.length === 5000 },
    readiness: {
      legal_center_built: true, policy_acceptance_gate_built: true, stripe_code_ready: true,
      stripe_live_ready: billing.mode === "live" && billing.ready,
      paid_media_commercial_gate_approved: mediaApproved,
      approved_provider_agreements: approved.length,
      pending_provider_agreements: agreements.filter((row) => row.status === "pending_review").length,
      production_launch_ready: false, snapshot_limit_reached: snapshotLimited,
      blocker_codes: ["commercial_policy_enforcement_not_implemented", "standalone_spend_ledger_not_recorded", "production_validation_required", ...(snapshotLimited ? ["snapshot_incomplete"] : [])]
    },
    required_owner_actions: [
      "Implement and verify standalone agreement, margin and aggregate spending enforcement before broad paid production.",
      "Record provider cost commitments and settlements before relying on daily or monthly supplier spending totals.",
      "Validate live hosting, recovery, email delivery and test-mode billing end to end.",
      "Record reviewed supplier rights and final legal policies before approving a commercial launch."
    ]
  });
}

export async function handleIntegrationFunction({ name, body = {}, user, repository, config, providers }) {
  if (!FUNCTION_NAMES.has(name)) return null;
  if (!user?.id) return reject(401, "authentication_required", "Authentication required.");
  const input = { body: body && typeof body === "object" && !Array.isArray(body) ? body : {}, user, repository, config,
    readiness: providers?.readiness?.() || {} };
  if (name === "get-integration-center") return integrationCenter(input);
  if (name === "set-integration-preference") return setPreference(input);
  if (name === "get-connection-fabric") return connectionFabric(input);
  return commercialControl(input);
}
