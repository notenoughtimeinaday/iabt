import { secrets } from "base44:runtime";

export const CONNECTION_FABRIC_VERSION = "iabt-connection-fabric-2026-08-22.1";

function enabled(name: string) {
  return /^(1|true|yes|on)$/i.test(String(secrets.get(name) || "").trim());
}

function lumaReady() {
  return Boolean(String(secrets.get("LUMA_AGENTS_API_KEY") || "").trim()) &&
    enabled("IABT_ENABLE_PAID_MEDIA") &&
    enabled("IABT_MEDIA_BILLING_READY");
}

const INTERFACES = [
  {
    id: "platform",
    name: "Managed platform tools",
    description: "Built-in AI, image, storage, entity, function, and agent capabilities.",
  },
  {
    id: "oauth2",
    name: "Authorized cloud services",
    description: "OAuth connections to productivity, business, data, development, and communication systems.",
  },
  {
    id: "https_api",
    name: "APIs and webhooks",
    description: "Versioned REST, GraphQL, SOAP, and webhook adapters with server-side credentials.",
  },
  {
    id: "mcp",
    name: "Tool servers",
    description: "Capability-based tool servers that expose inspectable actions and structured results.",
  },
  {
    id: "enterprise_gateway",
    name: "Enterprise and mainframe gateways",
    description: "Customer-controlled bridges for databases, files, queues, batch jobs, ERP, and legacy systems.",
  },
  {
    id: "machine_gateway",
    name: "Machines and devices",
    description: "Simulation-first adapters for scanners, CNC, printers, sensors, and approved controllers.",
  },
];

function builtInAdapters() {
  const videoReady = lumaReady();
  return [
    {
      adapter_id: "base44-managed-intelligence",
      display_name: "Managed intelligence",
      description: "Planning, structured generation, code, documents, automations, and app definitions.",
      category: "intelligence",
      interface_type: "platform",
      auth_mode: "platform_managed",
      status: "active",
      capabilities: ["plan", "generate", "structure", "reason", "verify"],
      operations: ["read_context", "create_plan", "create_artifact"],
      supported_intents: ["app", "website", "audio", "document", "code", "automation", "gcode", "other"],
      execution_function: "execute-creation",
      pricing_mode: "included",
      verification_mode: "artifact",
      risk_tier: "low",
      version: "1.0",
      enabled: true,
      priority: 10,
      source: "system",
    },
    {
      adapter_id: "base44-core-image",
      display_name: "Managed image renderer",
      description: "Original image and conceptual design rendering with artifact verification.",
      category: "media",
      interface_type: "platform",
      auth_mode: "platform_managed",
      status: "active",
      capabilities: ["image_generation", "concept_rendering"],
      operations: ["create_artifact"],
      supported_intents: ["image", "design"],
      execution_function: "execute-creation",
      pricing_mode: "included",
      verification_mode: "artifact",
      risk_tier: "low",
      version: "1.0",
      enabled: true,
      priority: 20,
      source: "system",
    },
    {
      adapter_id: "luma-ray-3-2",
      display_name: "Ray 3.2 video renderer",
      description: videoReady
        ? "Paid video rendering is configured behind exact quote and approval gates."
        : "Video rendering adapter is installed but provider credentials and paid-media gates are not all enabled.",
      category: "media",
      interface_type: "https_api",
      auth_mode: "secret_reference",
      status: videoReady ? "active" : "setup_required",
      capabilities: ["video_generation"],
      operations: ["submit_render", "poll_render", "persist_artifact"],
      supported_intents: ["video"],
      execution_function: "execute-creation",
      pricing_mode: "quoted",
      verification_mode: "provider_status",
      risk_tier: "medium",
      version: "ray-3.2",
      enabled: true,
      priority: 30,
      source: "system",
    },
    {
      adapter_id: "base44-oauth-catalog",
      display_name: "Cloud connector gateway",
      description: "A broad OAuth connector catalog is available for authorized business, productivity, data, development, and communication services. Each connection requires deliberate account authorization and exact scopes.",
      category: "business",
      interface_type: "oauth2",
      auth_mode: "oauth",
      status: "available_to_connect",
      capabilities: ["files", "documents", "communications", "crm", "analytics", "commerce", "development", "data"],
      operations: ["discover", "authorize", "read", "write"],
      supported_intents: ["app", "website", "document", "code", "automation", "other"],
      execution_function: "",
      pricing_mode: "provider_account",
      verification_mode: "read_after_write",
      risk_tier: "medium",
      version: "catalog",
      enabled: true,
      priority: 40,
      source: "system",
    },
    {
      adapter_id: "custom-api-adapter",
      display_name: "Custom API adapter",
      description: "A reviewed server-side adapter can connect future REST, GraphQL, SOAP, or webhook services without changing the conversational product.",
      category: "custom",
      interface_type: "https_api",
      auth_mode: "secret_reference",
      status: "adapter_ready",
      capabilities: ["custom_read", "custom_write", "webhook"],
      operations: ["preflight", "execute", "verify"],
      supported_intents: ["app", "website", "code", "automation", "other"],
      execution_function: "",
      pricing_mode: "custom_contract",
      verification_mode: "custom",
      risk_tier: "medium",
      version: "contract-1.0",
      enabled: true,
      priority: 50,
      source: "system",
    },
    {
      adapter_id: "mcp-tool-adapter",
      display_name: "Tool-server adapter",
      description: "Future MCP-compatible tool servers can expose inspectable capabilities and structured actions behind IABT's approval and verification gates.",
      category: "development",
      interface_type: "mcp",
      auth_mode: "secret_reference",
      status: "adapter_ready",
      capabilities: ["tool_discovery", "structured_action", "structured_result"],
      operations: ["discover", "preflight", "execute", "verify"],
      supported_intents: ["app", "website", "code", "automation", "other"],
      execution_function: "",
      pricing_mode: "provider_account",
      verification_mode: "custom",
      risk_tier: "medium",
      version: "contract-1.0",
      enabled: true,
      priority: 60,
      source: "system",
    },
    {
      adapter_id: "enterprise-gateway-adapter",
      display_name: "Enterprise and mainframe gateway",
      description: "A customer-controlled bridge can expose approved REST/SOAP endpoints, databases, SFTP files, queues, or batch jobs while credentials remain outside IABT records.",
      category: "enterprise",
      interface_type: "enterprise_gateway",
      auth_mode: "customer_gateway",
      status: "adapter_ready",
      capabilities: ["data_exchange", "batch_job", "file_exchange", "message_queue", "system_of_record"],
      operations: ["discover", "preflight", "read", "write", "verify"],
      supported_intents: ["app", "code", "automation", "other"],
      execution_function: "",
      pricing_mode: "custom_contract",
      verification_mode: "read_after_write",
      risk_tier: "high",
      version: "contract-1.0",
      enabled: true,
      priority: 70,
      source: "system",
    },
    {
      adapter_id: "machine-device-gateway",
      display_name: "Machine and device gateway",
      description: "Scanners and approved device adapters can participate now; CNC, robotics, and control outputs remain simulation-first until a machine-specific safety gateway is reviewed.",
      category: "machine",
      interface_type: "machine_gateway",
      auth_mode: "customer_gateway",
      status: "simulation_only",
      capabilities: ["scanner_input", "device_event", "simulation", "gcode_draft"],
      operations: ["capture", "simulate", "verify"],
      supported_intents: ["app", "gcode", "automation"],
      execution_function: "",
      pricing_mode: "custom_contract",
      verification_mode: "simulation",
      risk_tier: "critical",
      version: "contract-1.0",
      enabled: true,
      priority: 80,
      source: "system",
    },
  ];
}

function text(value: unknown, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function list(value: unknown, max = 30) {
  return Array.isArray(value)
    ? value.map((item) => text(item, 160)).filter(Boolean).slice(0, max)
    : [];
}

export function sanitizeStoredAdapter(value: any) {
  return {
    adapter_id: text(value?.adapter_id, 120),
    display_name: text(value?.display_name, 160),
    description: text(value?.description, 1200),
    category: text(value?.category, 80),
    interface_type: text(value?.interface_type, 80),
    auth_mode: text(value?.auth_mode, 80),
    status: text(value?.status, 80),
    capabilities: list(value?.capabilities),
    operations: list(value?.operations),
    supported_intents: list(value?.supported_intents),
    execution_function: text(value?.execution_function, 160),
    pricing_mode: text(value?.pricing_mode, 80),
    verification_mode: text(value?.verification_mode, 80),
    risk_tier: text(value?.risk_tier, 40),
    version: text(value?.version, 80),
    enabled: value?.enabled !== false,
    priority: Number.isFinite(Number(value?.priority)) ? Number(value.priority) : 100,
    source: "admin_manifest",
  };
}

export function mergeConnectionAdapters(stored: any[] = []) {
  const byId = new Map(builtInAdapters().map((adapter) => [adapter.adapter_id, adapter]));
  for (const row of stored) {
    const adapter = sanitizeStoredAdapter(row);
    if (!adapter.adapter_id || !adapter.display_name || !adapter.enabled) continue;
    byId.set(adapter.adapter_id, adapter);
  }
  return [...byId.values()]
    .filter((adapter) => adapter.enabled)
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
}

function candidateScore(adapter: any, intent: string, request: string) {
  let score = 0;
  if (intent && adapter.supported_intents?.includes(intent)) score += 5;
  const haystack = [
    adapter.adapter_id,
    adapter.display_name,
    adapter.description,
    ...(adapter.capabilities || []),
  ].join(" ").toLowerCase();
  const words = request.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  for (const word of words) if (haystack.includes(word)) score += 1;
  if (adapter.status === "active") score += 2;
  return score;
}

export function connectionFabricResponse(adapters: any[], intent = "", requestedSystem = "") {
  const safeIntent = text(intent, 80).toLowerCase();
  const safeSystem = text(requestedSystem, 500);
  const candidates = adapters
    .map((adapter) => ({ adapter, score: candidateScore(adapter, safeIntent, safeSystem) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.adapter.priority || 100) - Number(b.adapter.priority || 100))
    .slice(0, 6)
    .map((item) => item.adapter.adapter_id);
  const counts = adapters.reduce((result: Record<string, number>, adapter) => {
    result[adapter.status] = (result[adapter.status] || 0) + 1;
    return result;
  }, {});

  return {
    version: CONNECTION_FABRIC_VERSION,
    positioning: "Provider-neutral by design: the user's goal stays stable while reviewed adapters can change or expand.",
    routing_rule: "Discover capability, prove connection readiness, calculate cost and risk, obtain required authorization, execute through a reviewed adapter, then verify the result.",
    credentials_rule: "Credentials and tokens never belong in prompts, plans, artifacts, or ConnectionAdapter records. Use OAuth, Base44 secrets, or a customer-controlled gateway.",
    interfaces: INTERFACES,
    adapters,
    route_candidates: candidates,
    status_counts: counts,
    autonomy: {
      safe_read_and_plan: "IABT may continue through connected, authorized, non-destructive steps.",
      approval_required: "External writes, paid work, sensitive access, destructive actions, and machine control require the applicable explicit authority.",
      connection_truth: "Adapter-ready does not mean connected. IABT must verify readiness before claiming access or execution.",
    },
  };
}
