import { secrets } from "base44:runtime";

export const CREATION_PRICING_VERSION = "iabt-creation-2026-08-21.1";
export const CREATION_QUOTE_TTL_MS = 30 * 60 * 1000;
export const LUMA_MODEL = "ray-3.2";
export const LUMA_API_BASE = "https://agents.lumalabs.ai/v1";
export const PROVIDER_COST_PER_IABT_CREDIT_CENTS = 5;

const INTENTS = [
  "app",
  "website",
  "image",
  "video",
  "audio",
  "document",
  "code",
  "design",
  "gcode",
  "automation",
  "other",
];

export function selectedCreationIntent(value: unknown) {
  const candidate = String(value || "").trim().toLowerCase();
  return INTENTS.includes(candidate) ? candidate : "";
}

const VIDEO_PRICES_CENTS = {
  "360p": { "5s": 6, "10s": 18 },
  "540p": { "5s": 15, "10s": 45 },
  "720p": { "5s": 30, "10s": 90 },
  "1080p": { "5s": 120, "10s": 360 },
};

const VIDEO_ASPECT_RATIOS = new Set(["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"]);
const COMPONENT_TYPES = new Set(["Text", "Input", "Button", "ScannerInput"]);

function enabled(name: string) {
  return /^(1|true|yes|on)$/i.test(String(secrets.get(name) || "").trim());
}

export function getMediaReadiness() {
  const lumaKeyRaw = String(secrets.get("LUMA_AGENTS_API_KEY") || "").trim();
  const paidMediaRaw = String(secrets.get("IABT_ENABLE_PAID_MEDIA") || "").trim();
  const mediaBillingRaw = String(secrets.get("IABT_MEDIA_BILLING_READY") || "").trim();
  const lumaKeyConfigured = Boolean(lumaKeyRaw);
  const paidMediaEnabled = /^(1|true|yes|on)$/i.test(paidMediaRaw);
  const mediaBillingReady = /^(1|true|yes|on)$/i.test(mediaBillingRaw);
  return {
    luma_key_configured: lumaKeyConfigured,
    paid_media_gate_configured: Boolean(paidMediaRaw),
    paid_media_enabled: paidMediaEnabled,
    media_billing_gate_configured: Boolean(mediaBillingRaw),
    media_billing_ready: mediaBillingReady,
    luma_ready: lumaKeyConfigured && paidMediaEnabled && mediaBillingReady,
  };
}

function videoSettings(spec: any = {}) {
  const resolution = Object.prototype.hasOwnProperty.call(VIDEO_PRICES_CENTS, spec?.resolution)
    ? String(spec.resolution)
    : "720p";
  const duration = Number(spec?.duration_seconds) === 10 ? "10s" : "5s";
  const aspectRatio = VIDEO_ASPECT_RATIOS.has(String(spec?.aspect_ratio))
    ? String(spec.aspect_ratio)
    : "16:9";
  return {
    resolution,
    duration,
    duration_seconds: duration === "10s" ? 10 : 5,
    aspect_ratio: aspectRatio,
    provider_cost_cents: VIDEO_PRICES_CENTS[resolution][duration],
  };
}

export function normalizeIntent(value: unknown, requestText = "") {
  const candidate = String(value || "").trim().toLowerCase();
  const request = String(requestText || "").toLowerCase();
  let inferred = "other";
  if (/\b(g-?code|cnc|toolpath|3d print|laser cut|router path)\b/.test(request)) inferred = "gcode";
  else if (/\b(video|movie|film|animation|animated|clip|reel|trailer)\b/.test(request)) inferred = "video";
  else if (/\b(song|music|audio|voiceover|voice-over|podcast|soundtrack|sound effect)\b/.test(request)) inferred = "audio";
  else if (/\b(image|picture|photo|photograph|artwork|illustration|logo|poster|painting)\b/.test(request)) inferred = "image";
  else if (/\b(floor plan|blueprint|layout|visual design|mockup|wireframe)\b/.test(request)) inferred = "design";
  else if (/\b(code|script|library|package|api client|program)\b/.test(request)) inferred = "code";
  else if (/\b(automation|workflow|integration|scheduled task|bot)\b/.test(request)) inferred = "automation";
  else if (/\b(app|application|website|web site|portal|dashboard|software|saas)\b/.test(request)) {
    inferred = /\b(website|web site)\b/.test(request) ? "website" : "app";
  } else if (/\b(document|report|proposal|resume|letter|manual|guide|book|article|plan)\b/.test(request)) {
    inferred = "document";
  }

  if (INTENTS.includes(candidate)) {
    const appNounPresent = /\b(app|application|website|web site|portal|dashboard|software|saas)\b/.test(request);
    if ((candidate === "app" || candidate === "website") && !appNounPresent && inferred !== "other") {
      return inferred;
    }
    return candidate;
  }
  return inferred;
}

function clampText(value: unknown, max: number, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text.slice(0, max);
}

function stringList(value: unknown, fallback: string[] = [], max = 12) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => clampText(item, 500)).filter(Boolean).slice(0, max);
}

function sanitizeSpec(value: any, requestText: string, intent: string) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const spec: Record<string, any> = {
    creative_prompt: clampText(source.creative_prompt, 6000, requestText),
    audience: clampText(source.audience, 500, "The intended end user"),
    style: clampText(source.style, 500, "Professional and polished"),
    tone: clampText(source.tone, 300, "Clear and useful"),
    format: clampText(source.format, 200, intent),
    features: stringList(source.features, [], 20),
    sections: stringList(source.sections, [], 20),
    technical_requirements: stringList(source.technical_requirements, [], 20),
    safety_constraints: stringList(source.safety_constraints, [], 20),
  };

  if (intent === "video") Object.assign(spec, videoSettings(source));
  if (intent === "image" || intent === "design") {
    spec.aspect_ratio = VIDEO_ASPECT_RATIOS.has(String(source.aspect_ratio))
      ? String(source.aspect_ratio)
      : "1:1";
  }
  if (intent === "gcode") {
    spec.machine_profile = clampText(source.machine_profile, 500, "Not supplied");
    spec.material = clampText(source.material, 300, "Not supplied");
    spec.dimensions = clampText(source.dimensions, 300, "Not supplied");
    spec.production_ready = false;
  }
  return spec;
}

function heuristicDetails(requestText: string, intent: string) {
  const titleSource = requestText.replace(/\s+/g, " ").trim();
  const title = titleSource.length > 100 ? titleSource.slice(0, 97) + "..." : titleSource;
  const base = {
    title: title || "New creation",
    intent,
    assistant_summary: "IABT translated the request into an executable " + intent + " plan and will preserve that output type.",
    normalized_spec: sanitizeSpec({}, requestText, intent),
    steps: [] as any[],
    deliverables: [] as string[],
    success_criteria: ["The result directly addresses the requested deliverable.", "The result is clearly labeled with any limitations."],
    clarification_questions: [] as string[],
    warnings: [] as string[],
  };

  const step = (order: number, name: string, description: string, tool: string, deliverable: string) => ({
    order,
    title: name,
    description,
    tool,
    deliverable,
  });

  if (intent === "app" || intent === "website") {
    base.steps = [
      step(1, "Product architecture", "Translate the request into users, data, workflows, and acceptance criteria.", "IABT planner", "Architecture specification"),
      step(2, "AppDefinition generation", "Create importable pages, routes, components, data, workflows, integrations, and permissions.", "Base44 managed AI", "IABT AppDefinition JSON"),
    ];
    base.deliverables = ["Importable IABT AppDefinition JSON", "Implementation blueprint"];
  } else if (intent === "image" || intent === "design") {
    base.steps = [
      step(1, "Art direction", "Resolve subject, composition, visual style, lighting, and output ratio.", "IABT planner", "Production prompt"),
      step(2, "Image generation", "Render the requested visual.", "Base44 image generation", "Generated image"),
    ];
    base.deliverables = ["Generated image", "Prompt and production metadata"];
    if (intent === "design") base.warnings.push("Floor plans and technical layouts are conceptual unless reviewed by a qualified professional.");
  } else if (intent === "video") {
    base.steps = [
      step(1, "Direction package", "Create a production-ready concept, script, shot list, motion, camera, lighting, and pacing.", "IABT planner", "Video direction package"),
      step(2, "Render or preproduction", "Render with Ray 3.2 when explicitly enabled and approved; otherwise produce detailed preproduction.", "Luma Ray 3.2 or IABT preproduction", "MP4 or clearly labeled preproduction document"),
    ];
    base.deliverables = ["Video direction package", "Rendered MP4 when the paid provider is ready; otherwise storyboard-ready preproduction"];
  } else if (intent === "audio") {
    base.steps = [
      step(1, "Audio direction", "Define structure, timing, voice, instrumentation, lyrics or script, and production notes.", "IABT planner", "Audio production specification"),
      step(2, "Preproduction package", "Create the detailed material needed by a compatible audio renderer.", "Base44 managed AI", "Audio preproduction document"),
    ];
    base.deliverables = ["Audio production brief", "Lyrics, script, cue sheet, or arrangement as appropriate"];
    base.warnings.push("No audio-rendering provider is connected in this release; the output is preproduction, not an audio file.");
  } else if (intent === "code" || intent === "automation") {
    base.steps = [
      step(1, "Technical design", "Define inputs, outputs, architecture, error handling, and verification.", "IABT planner", "Technical specification"),
      step(2, "Source generation", "Generate a structured source bundle with setup and verification instructions.", "Base44 managed AI", "Code bundle"),
    ];
    base.deliverables = ["Structured source-code bundle", "Setup and verification instructions"];
  } else if (intent === "gcode") {
    base.steps = [
      step(1, "Manufacturing assumptions", "Capture machine, material, dimensions, tooling, origin, and safety constraints.", "IABT planner", "Assumptions and safety notes"),
      step(2, "Simulation-first draft", "Generate a clearly labeled G-code draft for offline review and simulation.", "Base44 managed AI", "G-code draft"),
    ];
    base.deliverables = ["Simulation-first G-code draft", "Machine assumptions and verification checklist"];
    base.warnings.push("Generated G-code is never machine-ready by default. Simulate it and verify machine limits, origin, tooling, material, clearances, and emergency-stop operation before use.");
  } else {
    base.steps = [
      step(1, "Detailed specification", "Turn the request into a complete, useful deliverable without changing its requested modality.", "IABT planner", "Structured specification"),
      step(2, "Content production", "Create the requested document or production package.", "Base44 managed AI", "Detailed artifact"),
    ];
    base.deliverables = ["Detailed document or production package"];
  }
  return base;
}

const PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    intent: { type: "string", enum: INTENTS },
    assistant_summary: { type: "string" },
    normalized_spec: {
      type: "object",
      additionalProperties: false,
      properties: {
        creative_prompt: { type: "string" },
        audience: { type: "string" },
        style: { type: "string" },
        tone: { type: "string" },
        format: { type: "string" },
        aspect_ratio: { type: "string" },
        duration_seconds: { type: "integer" },
        resolution: { type: "string" },
        features: { type: "array", items: { type: "string" } },
        sections: { type: "array", items: { type: "string" } },
        technical_requirements: { type: "array", items: { type: "string" } },
        safety_constraints: { type: "array", items: { type: "string" } },
        machine_profile: { type: "string" },
        material: { type: "string" },
        dimensions: { type: "string" },
      },
      required: ["creative_prompt"],
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          order: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          tool: { type: "string" },
          deliverable: { type: "string" },
        },
        required: ["order", "title", "description", "tool", "deliverable"],
      },
    },
    deliverables: { type: "array", items: { type: "string" } },
    success_criteria: { type: "array", items: { type: "string" } },
    clarification_questions: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["title", "intent", "assistant_summary", "normalized_spec", "steps", "deliverables", "success_criteria", "clarification_questions", "warnings"],
};

export function parseStructured(value: any) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = String(fenced?.[1] || text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The generation did not return valid structured data.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function planRequest(base44: any, requestText: string, context: any = null) {
  const forcedIntent = selectedCreationIntent(context?.selected_mode);
  const inferredIntent = forcedIntent || normalizeIntent("", requestText);
  const fallback = heuristicDetails(requestText, inferredIntent);
  const contextText = context && typeof context === "object"
    ? JSON.stringify(context).slice(0, 10000)
    : "";

  const prompt = [
    "You are IABT's multimodal creation planner.",
    "Classify the requested deliverable accurately. Never turn a video, song, image, document, code, design, G-code, or automation request into app pages.",
    forcedIntent
      ? "The Studio explicitly selected " + forcedIntent + " mode. Set intent exactly to " + forcedIntent + " and plan that output type even when the request is vague."
      : "No Studio mode was supplied; infer the requested output type from the request.",
    "Make useful professional assumptions instead of blocking on optional details. Ask clarification only when a missing physical-machine fact would make a G-code draft unsafe.",
    "For video, choose only 5 or 10 seconds, 360p/540p/720p/1080p, and one of 9:16, 3:4, 1:1, 4:3, 16:9, 21:9. Default to 5 seconds, 720p, 16:9.",
    "For floor plans or regulated technical designs, label results conceptual and require qualified review.",
    "For G-code, always mark production_ready false and require offline simulation and machine-specific verification.",
    "Return concise structured data matching the supplied schema.",
    "",
    "UNTRUSTED USER REQUEST:",
    requestText,
    contextText ? "\nOPTIONAL PROJECT CONTEXT:\n" + contextText : "",
  ].join("\n");

  try {
    const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: PLANNER_SCHEMA,
    });
    const value = parseStructured(raw);
    const intent = forcedIntent || normalizeIntent(value?.intent, requestText);
    return {
      ...fallback,
      title: clampText(value?.title, 140, fallback.title),
      intent,
      assistant_summary: clampText(value?.assistant_summary, 2000, fallback.assistant_summary),
      normalized_spec: sanitizeSpec(value?.normalized_spec, requestText, intent),
      steps: Array.isArray(value?.steps) && value.steps.length ? value.steps.slice(0, 12) : fallback.steps,
      deliverables: stringList(value?.deliverables, fallback.deliverables, 12),
      success_criteria: stringList(value?.success_criteria, fallback.success_criteria, 12),
      clarification_questions: stringList(value?.clarification_questions, [], 5),
      warnings: stringList(value?.warnings, fallback.warnings, 12),
    };
  } catch (error) {
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        "IABT used its deterministic planning fallback because the planning model was temporarily unavailable.",
      ],
      planning_error: error instanceof Error ? error.message.slice(0, 300) : "Planning model unavailable.",
    };
  }
}

export function getCreationCapabilities() {
  const media = getMediaReadiness();
  const video = media.luma_ready
    ? {
        id: "video-iabt-managed",
        intent: "video",
        name: "Video generation",
        description: "Generate a short MP4 through IABT managed production after an exact quote is explicitly approved.",
        provider: "luma-ray-3.2",
        provider_ready: true,
        render_ready: true,
        fallback_available: true,
        output_kinds: ["video", "document"],
        pricing: { currency: "USD", from_cents: 6, default_cents: 30, maximum_cents: 360, platform_fee_cents: 0 },
      }
    : {
        id: "video-preproduction",
        intent: "video",
        name: "Video preproduction",
        description: "Create a detailed concept, script, shot list, camera plan, and storyboard prompts. This does not claim to render an MP4.",
        provider: "iabt-preproduction",
        provider_ready: true,
        render_ready: false,
        fallback_available: true,
        output_kinds: ["document"],
        pricing: { currency: "USD", from_cents: 0, default_cents: 0, maximum_cents: 0, platform_fee_cents: 0 },
      };

  return [
    { id: "app-production", intent: "app", name: "Application generation", description: "Create an importable AppDefinition plus data, workflows, integrations, permissions, and implementation notes.", provider: "base44-managed-ai", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["app"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "website-production", intent: "website", name: "Website generation", description: "Create an importable multi-page website AppDefinition and implementation blueprint.", provider: "base44-managed-ai", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["app"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "image-production", intent: "image", name: "Image generation", description: "Render an original image from the approved production prompt.", provider: "base44-core-image", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["image", "document"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    video,
    { id: "audio-preproduction", intent: "audio", name: "Audio preproduction", description: "Create lyrics, narration, timing, arrangement, sound design, and production notes. No audio renderer is connected yet.", provider: "iabt-preproduction", provider_ready: true, render_ready: false, fallback_available: true, output_kinds: ["document"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "document-production", intent: "document", name: "Document generation", description: "Write a detailed, structured document tailored to the requested audience and purpose.", provider: "base44-managed-ai", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["document"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "code-production", intent: "code", name: "Code generation", description: "Create a structured source bundle with files, setup steps, and verification instructions.", provider: "base44-managed-ai", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["code"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "design-production", intent: "design", name: "Visual design generation", description: "Render a conceptual visual design and include its production prompt. Technical plans require qualified review.", provider: "base44-core-image", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["image", "document"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "gcode-production", intent: "gcode", name: "G-code draft generation", description: "Generate a simulation-first G-code draft with machine assumptions and a mandatory safety checklist.", provider: "base44-managed-ai", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["gcode"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "automation-production", intent: "automation", name: "Automation source generation", description: "Create automation source, integration contracts, failure handling, and verification instructions.", provider: "base44-managed-ai", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["code"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
    { id: "general-production", intent: "other", name: "General creation", description: "Produce a detailed document or production package without forcing the request into an app.", provider: "base44-managed-ai", provider_ready: true, render_ready: true, fallback_available: true, output_kinds: ["document"], pricing: { currency: "USD", default_cents: 0, platform_fee_cents: 0 } },
  ];
}

export function capabilityFor(intent: string, spec: any = {}) {
  const normalized = normalizeIntent(intent);
  const capabilities = getCreationCapabilities();
  const exact = capabilities.find((capability) => capability.intent === normalized);
  const capability = exact || capabilities.find((item) => item.intent === "other");
  const video = videoSettings(spec);
  const providerCost = normalized === "video" && capability?.render_ready
    ? video.provider_cost_cents
    : Number(capability?.pricing?.default_cents || 0);
  const platformFee = Number(capability?.pricing?.platform_fee_cents || 0);
  const creditCost = providerCost > 0
    ? Math.max(1, Math.ceil((providerCost + platformFee) / PROVIDER_COST_PER_IABT_CREDIT_CENTS))
    : 1;
  return {
    ...capability,
    credit_cost: creditCost,
    provider_cost_cents: providerCost,
    platform_fee_cents: platformFee,
    total_estimated_cost_cents: providerCost + platformFee,
    currency: "USD",
  };
}

export function quoteFor(intent: string, spec: any = {}) {
  const capability = capabilityFor(intent, spec);
  const expiresAt = new Date(Date.now() + CREATION_QUOTE_TTL_MS).toISOString();
  const creditLabel = capability.credit_cost === 1 ? "1 IABT credit" : capability.credit_cost + " IABT credits";
  const noChargeMessage = capability.total_estimated_cost_cents > 0
    ? creditLabel + " will be reserved only after approval. The displayed " +
      "$" + (capability.total_estimated_cost_cents / 100).toFixed(2) +
      " provider cost is covered by those credits and is not a separate card charge. If Luma rejects the request before it is queued, the reservation is restored."
    : creditLabel + " will be reserved only after approval. No separate card charge will occur.";
  return {
    capability,
    credit_cost: capability.credit_cost,
    provider_cost_cents: capability.provider_cost_cents,
    platform_fee_cents: capability.platform_fee_cents,
    total_estimated_cost_cents: capability.total_estimated_cost_cents,
    currency: "USD",
    pricing_version: CREATION_PRICING_VERSION,
    quote_expires_at: expiresAt,
    consent_summary: noChargeMessage,
    requires_explicit_approval: true,
    billing_action: "reserve_iabt_credits",
  };
}

export async function requireUser(base44: any) {
  let user;
  try {
    user = await base44.auth.me();
  } catch {
    user = null;
  }
  if (!user?.id || !user?.email) {
    throw new Response(JSON.stringify({ error: "Authentication required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

const APP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    app: {
      type: "object",
      additionalProperties: false,
      properties: { name: { type: "string" }, description: { type: "string" } },
      required: ["name", "description"],
    },
    theme: {
      type: "object",
      additionalProperties: false,
      properties: {
        primary: { type: "string" },
        background: { type: "string" },
        surface: { type: "string" },
        text: { type: "string" },
        radius: { type: "integer" },
      },
      required: ["primary", "background", "surface", "text", "radius"],
    },
    pages: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          route: { type: "string" },
          layout: { type: "string", enum: ["column"] },
          components: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["Text", "Input", "Button", "ScannerInput"] },
                props: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    value: { type: "string" },
                    placeholder: { type: "string" },
                    label: { type: "string" },
                    to: { type: "string" },
                  },
                },
              },
              required: ["type", "props"],
            },
          },
        },
        required: ["name", "route", "layout", "components"],
      },
    },
    data: { type: "array", items: { type: "object" } },
    workflows: { type: "array", items: { type: "object" } },
    integrations: { type: "array", items: { type: "string" } },
    permissions: { type: "array", items: { type: "string" } },
    implementation_notes: { type: "array", items: { type: "string" } },
  },
  required: ["app", "theme", "pages", "data", "workflows", "integrations", "permissions", "implementation_notes"],
};

function color(value: unknown, fallback: string) {
  const candidate = String(value || "");
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function cleanRoute(value: unknown, index: number, used: Set<string>) {
  let route = String(value || "").trim().toLowerCase().replace(/[^a-z0-9/_-]/g, "-");
  if (!route.startsWith("/")) route = "/" + route;
  if (index === 0 && (route === "/" || route === "/home")) route = "/";
  if (!route || route === "//") route = index === 0 ? "/" : "/page-" + (index + 1);
  const base = route;
  let suffix = 2;
  while (used.has(route)) route = base.replace(/\/$/, "") + "-" + suffix++;
  used.add(route);
  return route;
}

export async function generateAppDefinition(base44: any, requestText: string, spec: any) {
  const prompt = [
    "Create a complete, importable IABT AppDefinition for the request.",
    "This is the app/website production path. Include meaningful pages, precise conversion copy, routes, data models, workflows, integrations, permissions, and implementation notes.",
    "The current visual editor supports only Text(value), Input(placeholder), Button(label and optional to), and ScannerInput(label). Use those exact types while capturing richer backend behavior in data, workflows, integrations, permissions, and implementation_notes.",
    "Buttons that navigate must use an exact generated route. Return only structured data.",
    "",
    "USER REQUEST:",
    requestText,
    "",
    "NORMALIZED SPEC:",
    JSON.stringify(spec).slice(0, 12000),
  ].join("\n");
  const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: APP_SCHEMA,
  });
  const value = parseStructured(raw);
  const usedRoutes = new Set<string>();
  const pages = (Array.isArray(value?.pages) ? value.pages : []).slice(0, 12).map((page: any, index: number) => ({
    id: "page_" + crypto.randomUUID(),
    name: clampText(page?.name, 80, "Page " + (index + 1)),
    route: cleanRoute(page?.route, index, usedRoutes),
    layout: "column",
    components: (Array.isArray(page?.components) ? page.components : []).slice(0, 50)
      .filter((component: any) => COMPONENT_TYPES.has(String(component?.type)))
      .map((component: any) => ({
        id: "component_" + crypto.randomUUID(),
        type: String(component.type),
        props: component.props && typeof component.props === "object" ? component.props : {},
      })),
  }));
  if (!pages.length) throw new Error("The app generator returned no usable pages.");
  return {
    schemaVersion: "1.0",
    app: {
      name: clampText(value?.app?.name, 100, "IABT Application"),
      description: clampText(value?.app?.description, 500, requestText),
    },
    theme: {
      primary: color(value?.theme?.primary, "#7c3aed"),
      background: color(value?.theme?.background, "#0b1020"),
      surface: color(value?.theme?.surface, "#151c30"),
      text: color(value?.theme?.text, "#f8fafc"),
      radius: String(Math.min(32, Math.max(0, Number(value?.theme?.radius) || 16))),
    },
    pages,
    data: Array.isArray(value?.data) ? value.data.slice(0, 30) : [],
    workflows: Array.isArray(value?.workflows) ? value.workflows.slice(0, 30) : [],
    integrations: stringList(value?.integrations, [], 30),
    permissions: stringList(value?.permissions, [], 30),
    implementation_notes: stringList(value?.implementation_notes, [], 30),
  };
}

export async function generateTextDeliverable(base44: any, requestText: string, spec: any, intent: string) {
  const modeInstruction = intent === "audio"
    ? "Create an audio preproduction package: concept, timing, structure, lyrics or spoken script when appropriate, instrumentation or voice direction, cue sheet, mix notes, and production checklist. State clearly that no audio file was rendered."
    : intent === "video"
      ? "Create a video preproduction package: logline, audience, duration, aspect ratio, visual language, full script, shot-by-shot list, camera/motion/lighting notes, storyboard image prompts, sound plan, edit plan, and render prompt. State clearly that no MP4 was rendered."
      : intent === "design"
        ? "Create a conceptual design specification with layout rationale, dimensions or scale assumptions, materials, annotations, and qualified-review warnings when applicable."
        : "Write the requested document in polished, complete Markdown with concrete details, sections, and an actionable checklist.";
  const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: [
      "You are IABT's production writer.",
      modeInstruction,
      "Do not claim that a file or media render exists when it does not.",
      "",
      "USER REQUEST:",
      requestText,
      "",
      "NORMALIZED SPEC:",
      JSON.stringify(spec).slice(0, 12000),
    ].join("\n"),
  });
  const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  if (!text.trim()) throw new Error("The content generator returned an empty result.");
  return text.slice(0, 300000);
}

const CODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    language: { type: "string" },
    files: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          purpose: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "purpose", "content"],
      },
    },
    setup: { type: "array", items: { type: "string" } },
    verification: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "language", "files", "setup", "verification", "limitations"],
};

function safeFilePath(value: unknown, index: number) {
  const candidate = String(value || "file-" + (index + 1) + ".txt")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
  return candidate.slice(0, 200) || "file-" + (index + 1) + ".txt";
}

export async function generateCodeBundle(base44: any, requestText: string, spec: any) {
  const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: [
      "Generate a coherent source-code bundle for the request.",
      "Include every essential file, secure defaults, input validation, error handling, setup steps, and verification. Do not claim code was executed.",
      "Do not include secrets or absolute machine paths. Return only structured data.",
      "",
      "USER REQUEST:",
      requestText,
      "",
      "NORMALIZED SPEC:",
      JSON.stringify(spec).slice(0, 12000),
    ].join("\n"),
    response_json_schema: CODE_SCHEMA,
  });
  const value = parseStructured(raw);
  const files = (Array.isArray(value?.files) ? value.files : []).slice(0, 30).map((file: any, index: number) => ({
    path: safeFilePath(file?.path, index),
    purpose: clampText(file?.purpose, 500),
    content: String(file?.content || "").slice(0, 100000),
  })).filter((file: any) => file.content);
  if (!files.length) throw new Error("The code generator returned no usable files.");
  return {
    summary: clampText(value?.summary, 3000),
    language: clampText(value?.language, 100, "mixed"),
    files,
    setup: stringList(value?.setup, [], 30),
    verification: stringList(value?.verification, [], 30),
    limitations: stringList(value?.limitations, [], 30),
  };
}

export async function generateGCodeDraft(base44: any, requestText: string, spec: any) {
  const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: [
      "Create a simulation-first G-code draft for the request.",
      "Begin with a prominent comment block: NOT MACHINE-READY; offline simulation and machine-specific review are mandatory.",
      "Echo machine profile, material, dimensions, units, coordinate mode, work origin, tooling, feeds, speeds, clearances, and every assumption.",
      "If machine, material, tooling, dimensions, or origin is missing, keep potentially hazardous motion disabled in comments and provide safe placeholders rather than inventing operating values.",
      "Never claim the output is safe. End with a verification checklist in comments.",
      "Return plain G-code text only.",
      "",
      "USER REQUEST:",
      requestText,
      "",
      "NORMALIZED SPEC:",
      JSON.stringify(spec).slice(0, 12000),
    ].join("\n"),
  });
  const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  if (!text.trim()) throw new Error("The G-code generator returned an empty result.");
  const banner = [
    "; IABT SIMULATION-FIRST DRAFT — NOT MACHINE-READY",
    "; DO NOT RUN ON PHYSICAL EQUIPMENT UNTIL REVIEWED AND SIMULATED.",
    "; Verify machine limits, units, origin, tooling, material, clearances, workholding, feeds/speeds, and emergency stop.",
    "",
  ].join("\n");
  return (text.includes("NOT MACHINE-READY") ? text : banner + text).slice(0, 300000);
}

export async function generateImage(base44: any, prompt: string) {
  const result = await base44.asServiceRole.integrations.Core.GenerateImage({ prompt: clampText(prompt, 6000) });
  const url = String(result?.url || "").trim();
  if (!/^https:\/\//i.test(url)) throw new Error("The image provider did not return a usable image URL.");
  return { url };
}

function lumaKey() {
  return String(secrets.get("LUMA_AGENTS_API_KEY") || "").trim();
}

async function lumaRequest(path: string, init: RequestInit) {
  const key = lumaKey();
  if (!key) throw new Error("IABT's managed renderer is not configured.");
  const response = await fetch(LUMA_API_BASE + path, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + key,
      "X-Request-Id": crypto.randomUUID(),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail || payload?.error?.message || payload?.message || "Supplier request failed with status " + response.status + ".";
    console.error("managed video supplier request failed:", response.status, String(detail).slice(0, 800));
    const code =
      response.status === 402 ? "luma_insufficient_balance" :
      response.status === 401 ? "luma_authentication_failed" :
      response.status === 403 ? "luma_access_denied" :
      response.status === 429 ? "luma_rate_limited" :
      response.status >= 500 ? "luma_provider_unavailable" :
      "luma_invalid_request";
    const error: any = new Error("IABT's managed renderer request failed.");
    error.status = response.status;
    error.code = code;
    error.request_id = String(response.headers.get("x-request-id") || "");
    error.retryable = [429, 502, 503].includes(response.status);
    throw error;
  }
  return payload;
}

export async function submitLumaVideo(spec: any) {
  const readiness = getMediaReadiness();
  if (!readiness.luma_ready) throw new Error("IABT's paid video rendering is not fully enabled.");
  const settings = videoSettings(spec);
  const payload = {
    model: LUMA_MODEL,
    type: "video",
    prompt: clampText(spec?.creative_prompt, 6000, "Create a polished cinematic video."),
    aspect_ratio: settings.aspect_ratio,
    video: {
      resolution: settings.resolution,
      duration: settings.duration,
    },
  };
  const result = await lumaRequest("/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!result?.id) throw new Error("IABT's managed renderer accepted the request without returning a job ID.");
  return { generation: result, settings };
}

export async function getLumaGeneration(generationId: string) {
  const id = String(generationId || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id)) throw new Error("Invalid managed-renderer job ID.");
  return lumaRequest("/generations/" + encodeURIComponent(id), { method: "GET" });
}

export function lumaVideoOutput(generation: any) {
  const candidates = [
    ...(Array.isArray(generation?.output) ? generation.output : []),
    generation?.output,
    generation?.assets?.video,
    generation?.video,
  ];
  for (const candidate of candidates) {
    const url = typeof candidate === "string"
      ? candidate
      : candidate?.url || candidate?.video_url || candidate?.download_url;
    if (/^https:\/\//i.test(String(url || ""))) {
      return { url: String(url), type: "video" };
    }
  }
  return null;
}

export async function persistRemoteFile(base44: any, url: string, name: string, expectedType: string) {
  if (!/^https:\/\//i.test(String(url || ""))) throw new Error("The provider output URL is invalid.");
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not retrieve the provider output for secure storage.");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 200_000_000) throw new Error("Provider output exceeds the 200 MB secure-copy limit.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("The provider output was empty.");
  if (blob.size > 200_000_000) throw new Error("Provider output exceeds the 200 MB secure-copy limit.");
  const mimeType = String(blob.type || response.headers.get("content-type") || expectedType || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (expectedType.startsWith("video/") && !mimeType.startsWith("video/")) {
    throw new Error("The provider returned a non-video response instead of the expected media file.");
  }
  const signature = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (expectedType === "video/mp4") {
    const hasFtyp = signature.length >= 12 && String.fromCharCode(...signature.slice(4, 8)) === "ftyp";
    if (!hasFtyp) throw new Error("The provider response was not a valid MP4 file.");
  }
  const file = new File([blob], name, { type: mimeType });
  const stored = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
  const fileUri = String(stored?.file_uri || "").trim();
  if (!fileUri) throw new Error("Base44 private storage did not return a file URI.");
  return { file_uri: fileUri, mime_type: mimeType, size_bytes: blob.size };
}

export function executionKey(userId: string, planId: string, mode: string) {
  return ["creation", userId, planId, mode].join(":");
}

export function publicCapability(capability: any) {
  return {
    id: capability.id,
    intent: capability.intent,
    name: capability.name,
    description: capability.description,
    provider: capability.provider,
    provider_ready: capability.provider_ready,
    render_ready: capability.render_ready,
    fallback_available: capability.fallback_available,
    output_kinds: capability.output_kinds,
    pricing: capability.pricing,
  };
}
