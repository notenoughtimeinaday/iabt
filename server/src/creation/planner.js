import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { normalizeFileIds, readTextSources, referenceBinding, sourceReferences } from "../files/text-sources.js";
import { creationPolicy } from "../autonomy/policy.js";
import { capabilityRegistry, orchestrationConfigured } from "../autonomy/capabilities.js";

export const CREATION_PRICING_VERSION = "iabt-standalone-2026-09-20.1";
const QUOTE_TTL_MS = 30 * 60 * 1000;

const normalize = (value, max = 12000) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

// Intent is an authorization precondition, separate from output routing. A
// fallback app classification must never turn conversation into billable work.
export const creationRequestDisposition = (requestText) => {
  const text = normalize(requestText).toLowerCase().replace(/[’]/g, "'");
  const hold = /\b(?:do not|don't|never|not yet|hold off|wait before|stop|cancel)\b.{0,65}\b(?:creat\w*|build\w*|mak\w*|writ\w*|generat\w*|produc\w*|prepar\w*|design\w*|develop\w*|implement\w*|draft\w*|compos\w*|render\w*|review\w*|summari[sz]\w*|analy[sz]\w*|convert\w*|fix\w*|repair\w*|updat\w*|improv\w*|revis\w*|packag\w*|export\w*|test\w*|execut\w*|start\w*|begin\w*|work|anything)\b/.test(text) || /\b(?:but not (?:yet|now|right now)|not until|wait for my (?:approval|permission|confirmation))\b/.test(text) ||
    /\b(?:quote|plan|planning|explain|discussion|discuss)\s+only\b|\b(?:just|only)\s+(?:a\s+)?(?:quote|plan|explanation|discuss|explain)\b|^before\s+(?:creat\w*|build\w*|mak\w*|execut\w*|start\w*)\b|^(?:please\s+)?(?:create|make|build|generate)\s+nothing\b/.test(text);
  if (hold) return { create: false, reason: "execution_withheld", response: "I will keep this read-only and reserve no credits. Describe what you want clarified or quoted; tell me explicitly when you want creation to begin." };
  const request = text.replace(/^(?:(?:hello|hi|hey|okay|ok|thanks|thank you)[,!.\s]+)+/, "");
  if (/^(?:can|could|do|would) you (?:create|build|make|generate) (?:apps|applications|websites|documents|images|videos|audio|software)[?.!]*$/.test(request)) {
    return { create: false, reason: "creation_not_requested", response: "I can explain the available creation tools and their limits. Describe a specific deliverable when you want me to begin; no credits have been reserved." };
  }
  const direct = /^(?:(?:please|can you|could you|would you|will you|i need you to|i want you to|i'd like you to)\s+)*(?:help me\s+)?(?:create|build|make|write|generate|produce|prepare|design|develop|implement|draft|compose|render|review|summari[sz]e|analy[sz]e|convert|fix|repair|update|improve|revise|package|export|test)\b\s+\S/.test(request);
  const deliverable = /^(?:i\s+(?:need|want|would like)|i'd like)\s+(?:(?:an?|the|a new|new|some)\s+)?[^.!?]{0,100}\b(?:app|application|website|report|document|proposal|letter|manual|image|illustration|logo|poster|video|audio|song|script|source code|design|automation|runbook)\b/.test(request) && !/\b(?:help|advice|information|explanation|ideas|discuss)\b/.test(request);
  if (direct || deliverable) return { create: true, reason: "creation_requested" };
  return { create: false, reason: "creation_not_requested", response: "Describe the deliverable you want me to create, or ask about your existing work. I have not started a job or reserved credits." };
};

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "needs_setup", "cancelled"]);
const terminalPlanStatus = (jobStatus) => jobStatus === "succeeded" ? "completed" : "failed";

export const inferCreationIntent = (requestText) => {
  const text = normalize(requestText).toLowerCase();
  if (/\b(g-?code|cnc|toolpath|machining)\b/.test(text)) return "gcode_simulation";
  if (/\b(automation|automate|workflow|scheduled task|webhook workflow)\b/.test(text)) return "automation";
  if (/\b(wireframe|design system|design tokens|interface design|brand guide|mockup)\b/.test(text)) return "design";
  if (/\b(website|web site|landing page|storefront|e-?commerce site)\b/.test(text)) return "website";
  if (/\b(app|application|mobile app|web app|software|piano app)\b/.test(text)) return "app";
  if (/\b(video|mp4|film|animation|commercial clip)\b/.test(text)) return "video";
  if (/\b(audio|song|music track|mp3|voiceover|sound effect)\b/.test(text)) return "audio";
  if (/\b(document|report|proposal|letter|pdf|docx|manual)\b/.test(text)) return "document";
  if (/\b(image|photo|illustration|logo|poster|graphic)\b/.test(text)) return "image";
  if (/\b(code|script|library|api|command line|cli)\b/.test(text)) return "code";
  return "app";
};

const titleFor = (requestText, intent) => {
  const text = normalize(requestText, 140);
  if (/piano/i.test(text) && intent === "app") return "Keyboard Piano";
  if ((intent === "app" || intent === "website") && /merch|store|shop|e-?commerce/i.test(text)) return "IABT Advertising Storefront";
  if (intent === "audio") return "Original Audio Production";
  if (intent === "video") return "Video Production";
  if (intent === "document") return "JERICHO Document";
  if (intent === "image") return "Original Image";
  if (intent === "code") return "JERICHO Code Project";
  if (intent === "design") return "JERICHO Design Specification";
  if (intent === "gcode_simulation") return "JERICHO G-code Simulation";
  if (intent === "automation") return "JERICHO Automation Runbook";
  return text.slice(0, 90) || "IABT Creation";
};

const durationSeconds = (requestText) => {
  const seconds = normalize(requestText).match(/\b(\d{1,3})\s*(?:second|sec|s)\b/i);
  if (seconds) return Math.max(3, Math.min(600, Number(seconds[1])));
  const clock = normalize(requestText).match(/\b(\d{1,2}):(\d{2})\b/);
  return clock ? Math.max(3, Math.min(600, Number(clock[1]) * 60 + Number(clock[2]))) : 30;
};

const videoDurationSeconds = (requestText) =>
  durationSeconds(requestText) >= 8 ? 10 : 5;

const quoteFields = (plan) => [
  plan.id,
  plan.owner_id,
  plan.request_text,
  plan.intent,
  plan.capability_id,
  plan.provider,
  plan.credit_cost,
  plan.provider_cost_cents,
  plan.platform_fee_cents,
  plan.total_estimated_cost_cents,
  plan.currency,
  plan.pricing_version,
  plan.quote_expires_at,
  plan.job_type,
  plan.conversation_id || "",
  plan.project_id || "",
  plan.normalized_spec,
  ...(plan.file_references ? [referenceBinding(plan.file_references)] : [])
];

const signQuote = (config, plan) =>
  createHmac("sha256", config.authSecret)
    .update(JSON.stringify(quoteFields(plan)))
    .digest("base64url");

export const verifyQuoteSignature = (config, plan) => {
  const expected = Buffer.from(signQuote(config, plan));
  const actual = Buffer.from(String(plan.quote_signature || ""));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const capabilityFor = (intent, user, providers, requestText, readiness) => {
  if (intent === "app" || intent === "website") {
    return {
      id: "iabt-deterministic-interactive-v1",
      provider: "iabt-standalone",
      providerReady: true,
      renderReady: true,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.interactive",
      deliverables: [
        "Working sandboxed HTML preview",
        "IABT AppDefinition JSON",
        "Downloadable Vite/React source ZIP",
        "Request-specific verification report"
      ],
      steps: [
        { order: 1, title: "Infer architecture", deliverable: "AppDefinition JSON" },
        { order: 2, title: "Create working interaction", deliverable: "Interactive HTML preview" },
        { order: 3, title: "Package and verify", deliverable: "Source ZIP and verification report" }
      ],
      warnings: intent === "website" && /sell|store|shop|merch|e-?commerce/i.test(requestText)
        ? ["The preview cart is functional. Live checkout remains disabled until the owner's Stripe account is connected and test transactions pass."]
        : []
    };
  }
  if (intent === "document") {
    return {
      id: "iabt-document-v2",
      provider: "iabt-standalone",
      providerReady: true,
      renderReady: true,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.document",
      deliverables: [
        "Downloadable Markdown document",
        "Microsoft Word-compatible DOCX",
        "Portable PDF document"
      ],
      steps: [
        { order: 1, title: "Structure content", deliverable: "Document outline" },
        { order: 2, title: "Create content", deliverable: "Markdown source document" },
        { order: 3, title: "Export and verify", deliverable: "DOCX and PDF files" }
      ],
      warnings: []
    };
  }
  if (intent === "audio") {
    const seconds = durationSeconds(requestText);
    const costPerMinute = Number(providers?.config?.providers?.elevenlabs?.costPerMinuteCents || 0);
    const providerCost = costPerMinute > 0 ? Math.max(1, Math.ceil((seconds / 60) * costPerMinute)) : 0;
    const technical = Boolean(readiness.elevenlabs?.configured);
    const ownerDemo = user.role === "admin" && technical;
    const ready = Boolean(readiness.elevenlabs?.commercial_ready || ownerDemo);
    return {
      id: "elevenlabs-music-v2",
      provider: "elevenlabs",
      providerReady: technical,
      renderReady: ready,
      creditCost: Math.max(1, Math.ceil(providerCost / 3)),
      providerCostCents: providerCost,
      jobType: ready ? "provider.elevenlabs.music" : "creation.document",
      deliverables: ready
        ? ["Playable downloadable MP3", "Audio production specification"]
        : ["Downloadable audio preproduction document"],
      steps: ready
        ? [
            { order: 1, title: "Audio direction", deliverable: "Production specification" },
            { order: 2, title: "Approved audio render", deliverable: "Playable MP3" }
          ]
        : [
            { order: 1, title: "Audio direction", deliverable: "Production specification" },
            { order: 2, title: "Preproduction package", deliverable: "Renderer-ready document" }
          ],
      warnings: ready && ownerDemo && !readiness.elevenlabs?.commercial_ready
        ? ["OWNER DEMO ONLY: this output is not approved for customer production, resale, advertising, or white-label release."]
        : ready
          ? []
          : ["AUDIO RENDERER NOT READY: no playable audio will be claimed or produced."]
    };
  }
  if (intent === "image") {
    const providerCost = Number(providers?.config?.providers?.openai?.imageCostCents || 0);
    const technical = Boolean(readiness.openai_image?.configured);
    const ownerDemo = user.role === "admin" && technical;
    const ready = Boolean(readiness.openai_image?.commercial_ready || ownerDemo);
    return {
      id: "openai-image-generation-v1",
      provider: "openai",
      providerReady: technical,
      renderReady: ready,
      creditCost: Math.max(1, Math.ceil(providerCost / 3)),
      providerCostCents: providerCost,
      jobType: ready ? "provider.openai.image" : "creation.document",
      deliverables: ready
        ? ["Downloadable verified PNG image"]
        : [
            "Downloadable Markdown image production brief",
            "Microsoft Word-compatible DOCX production brief",
            "Portable PDF production brief"
          ],
      steps: ready
        ? [
            { order: 1, title: "Image direction", deliverable: "Renderer-ready specification" },
            { order: 2, title: "Managed image render", deliverable: "Verified private PNG" }
          ]
        : [
            { order: 1, title: "Image direction", deliverable: "Composition and visual plan" },
            { order: 2, title: "Preproduction package", deliverable: "Markdown, DOCX, and PDF brief" }
          ],
      warnings: ready && ownerDemo && !readiness.openai_image?.commercial_ready
        ? ["OWNER DEMO ONLY: this image is not approved for customer production, resale, advertising, or white-label release."]
        : ready
          ? []
          : ["IMAGE RENDERER NOT READY: IABT will create a production brief without claiming an image."]
    };
  }
  if (intent === "video") {
    const seconds = videoDurationSeconds(requestText);
    const unitCost = Number(providers?.config?.providers?.luma?.costPerFiveSecondsCents || 0);
    const providerCost = unitCost > 0 ? Math.ceil(seconds / 5) * unitCost : 0;
    const technical = Boolean(readiness.luma?.configured);
    const ownerDemo = user.role === "admin" && technical;
    const ready = Boolean(readiness.luma?.commercial_ready || ownerDemo);
    return {
      id: "luma-ray-3.2",
      provider: "luma",
      providerReady: technical,
      renderReady: ready,
      creditCost: Math.max(1, Math.ceil(providerCost / 3)),
      providerCostCents: providerCost,
      jobType: ready ? "provider.luma.video" : "creation.document",
      deliverables: ready
        ? ["Playable downloadable MP4"]
        : [
            "Downloadable Markdown video production brief",
            "Microsoft Word-compatible DOCX production brief",
            "Portable PDF production brief"
          ],
      steps: ready
        ? [
            { order: 1, title: "Video direction", deliverable: "Renderer-ready specification" },
            { order: 2, title: "Managed video render", deliverable: "Verified private MP4" }
          ]
        : [
            { order: 1, title: "Video direction", deliverable: "Shot and motion plan" },
            { order: 2, title: "Preproduction package", deliverable: "Markdown, DOCX, and PDF brief" }
          ],
      warnings: ready && ownerDemo && !readiness.luma?.commercial_ready
        ? ["OWNER DEMO ONLY: this video is not approved for customer production, resale, advertising, or white-label release."]
        : ready
          ? []
          : ["VIDEO RENDERER NOT READY: IABT will create a production brief without claiming an MP4."]
    };
  }
  if (intent === "code") {
    return {
      id: "iabt-code-scaffold-v1",
      provider: "iabt-standalone",
      providerReady: true,
      renderReady: true,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.code",
      deliverables: [
        "Runnable dependency-free JavaScript project scaffold",
        "Automated scaffold test",
        "Transparent validation and limitation report"
      ],
      steps: [
        { order: 1, title: "Preserve objective", deliverable: "Request-bound project definition" },
        { order: 2, title: "Create runnable scaffold", deliverable: "Source ZIP" },
        { order: 3, title: "Validate delivery boundary", deliverable: "Validation report" }
      ],
      warnings: [
        "The package is a runnable scaffold. It does not claim request-specific business logic, deployment, or third-party integrations are complete."
      ]
    };
  }
  if (intent === "design") {
    return {
      id: "iabt-design-specification-v1",
      provider: "iabt-standalone",
      providerReady: true,
      renderReady: true,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.design",
      deliverables: [
        "Reviewable Markdown design specification",
        "Machine-readable design tokens",
        "Accessible SVG design board"
      ],
      steps: [
        { order: 1, title: "Define experience direction", deliverable: "Design specification" },
        { order: 2, title: "Create reusable tokens", deliverable: "Design Tokens JSON" },
        { order: 3, title: "Render review board", deliverable: "SVG design board" }
      ],
      warnings: ["No Figma file or implemented production interface is claimed."]
    };
  }
  if (intent === "gcode_simulation") {
    return {
      id: "iabt-gcode-simulation-v1",
      provider: "iabt-standalone",
      providerReady: true,
      renderReady: true,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.gcode-simulation",
      deliverables: [
        "Simulation-only manufacturing runbook",
        "Machine-profile template",
        "Machine-readiness safety report"
      ],
      steps: [
        { order: 1, title: "Identify missing machine inputs", deliverable: "Machine profile template" },
        { order: 2, title: "Define simulation path", deliverable: "Simulation runbook" },
        { order: 3, title: "Enforce physical safety boundary", deliverable: "Safety report" }
      ],
      warnings: [
        "No executable machine-motion G-code will be produced without a verified machine profile, controller post-processor, collision simulation, and operator approval."
      ]
    };
  }
  if (intent === "automation") {
    return {
      id: "iabt-automation-runbook-v1",
      provider: "iabt-standalone",
      providerReady: true,
      renderReady: true,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.automation",
      deliverables: [
        "Disabled dry-run automation runbook",
        "Integration activation guide",
        "Safety validation report"
      ],
      steps: [
        { order: 1, title: "Define trigger and steps", deliverable: "Automation Runbook JSON" },
        { order: 2, title: "Bind authorization gates", deliverable: "Activation guide" },
        { order: 3, title: "Validate safe defaults", deliverable: "Validation report" }
      ],
      warnings: [
        "The runbook is disabled by default. No message, payment, publication, deletion, or external action is performed."
      ]
    };
  }
  return {
    id: "iabt-preproduction-v1",
    provider: "iabt-standalone",
    providerReady: true,
    renderReady: false,
    creditCost: 1,
    providerCostCents: 0,
    jobType: "creation.document",
    deliverables: ["Downloadable production brief"],
    steps: [{ order: 1, title: "Prepare request", deliverable: "Production brief" }],
    warnings: ["A final renderer for this output type is not connected to the standalone runtime yet."]
  };
};

export const createCreationPlan = async ({
  repository,
  config,
  providers,
  storage,
  user,
  requestText,
  conversationId = "",
  projectId = "",
  fileIds = [],
  automatic = false,
  submissionId = ""
}) => {
  const request = normalize(requestText);
  if (request.length < 3) {
    throw Object.assign(new Error("Describe what you want IABT to create"), {
      status: 400,
      code: "request_too_short"
    });
  }
  const ids = normalizeFileIds(fileIds);
  // The requested output wins over its subject: a report about software is
  // still a report. An actual "build an app" request remains unsupported here.
  const explicitSourceReview = /^(?:(?:please|can you|could you|would you)\s+)?(?:(?:create|write|generate|produce|make|prepare)\s+(?:me\s+)?(?:(?:an?|the)\s+)?(?:(?:brief|short|detailed|source|file|review)\s+){0,3}(?:report|document|checklist|summary|review)\b|(?:review|summari[sz]e)\b)/i.test(request);
  const intent = ids.length && explicitSourceReview ? "document" : inferCreationIntent(request);
  const registry = await capabilityRegistry({ config, providers, repository, storage, observe: false });
  const capability = capabilityFor(intent, user, providers, request, registry.capabilities);
  if (ids.length && intent !== "document") {
    throw Object.assign(new Error("Attached files currently support source-review documents only. Ask for a report or document; uploaded code is never executed or modified."), {
      status: 422, code: "source_intent_unsupported"
    });
  }
  const sources = await readTextSources({ repository, storage, user, fileIds: ids });
  const references = sourceReferences(sources);
  if (references.length) {
    for (const [entity, id] of [["AgentConversation", conversationId], ["Project", projectId]]) {
      if (id && !await repository.getRecord(entity, id, { ...user, role: "user" })) {
        throw Object.assign(new Error("The source-review context was not found in your account."), { status: 404, code: "source_context_not_found" });
      }
    }
    capability.id = "iabt-source-review-v1";
    capability.deliverables = ["Source inventory and candidate requirement checklist in Markdown", "Microsoft Word-compatible DOCX source review", "Portable PDF source review"];
    capability.warnings = ["Deterministic UTF-8 source review only: no general semantic analysis, uploaded-code execution, or repository changes."];
  }
  const orchestrated = !references.length && ["app", "website", "document", "code", "design"].includes(intent) && orchestrationConfigured(config);
  if (orchestrated) {
    capability.id = "openai-responses-orchestration-v1";
    capability.provider = "openai";
    capability.jobType = "creation.orchestrated";
    capability.providerCostCents = config.orchestration.budgetCents;
    capability.creditCost = Math.max(capability.creditCost, Math.ceil(capability.providerCostCents / 3));
    capability.deliverables = intent === "document"
      ? ["Request-specific Markdown document", "DOCX and PDF document exports", "Artifact verification results"]
      : ["Request-specific private source package", "Artifact verification results"];
    capability.warnings = ["Provider costs are operator estimates, not a provider-enforced dollar cap. Calls and output tokens are bounded within the approved estimate. Generated code is packaged and checked but not executed in an isolated build environment. Template fallback is labeled if orchestration cannot finish."];
    capability.steps = [
      { order: 1, title: "Interpret objective", deliverable: "Server-owned bounded execution plan" },
      { order: 2, title: "Create with approved tools", deliverable: "Private artifacts" },
      { order: 3, title: "Verify durable delivery", deliverable: "Verification evidence" }
    ];
  }
  const now = new Date();
  const expires = new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
  const total = capability.providerCostCents;
  const account = await repository.getCreditAccount(user.id);
  const ownerDemo =
    user.role === "admin" &&
    (intent === "audio" || intent === "video" || intent === "image") &&
    capability.providerReady;

  const submission = normalize(submissionId, 200);
  const requestKey = submission ? createHash("sha256").update(JSON.stringify([user.id, conversationId, submission])).digest("hex") : "";
  const recordId = requestKey ? [requestKey.slice(0, 8), requestKey.slice(8, 12), requestKey.slice(12, 16), requestKey.slice(16, 20), requestKey.slice(20, 32)].join("-") : undefined;
  const requestFingerprint = createHash("sha256").update(JSON.stringify([request, conversationId, projectId, referenceBinding(references)])).digest("hex");
  let plan = await repository.createRecord("CreationPlan", user, {
    user_id: user.id,
    user_email: user.email,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(projectId ? { project_id: projectId } : {}),
    request_text: request,
    request_fingerprint: requestFingerprint,
    title: references.length ? "JERICHO Source Review" : titleFor(request, intent),
    intent,
    status: "quoted",
    capability_id: capability.id,
    provider: capability.provider,
    provider_ready: capability.providerReady,
    render_ready: capability.renderReady,
    fallback_available: true,
    assistant_summary: references.length
      ? "JERICHO verified " + references.length + " private text source(s) and will create a source inventory, candidate requirement checklist, and complete source evidence. Uploaded code will not run or change."
      : "JERICHO inferred " + intent + " from your request and prepared an exact server-owned plan.",
    ...(references.length ? { file_references: references } : {}),
    normalized_spec: {
      creative_prompt: request,
      ...(orchestrated ? { orchestration_budget_cents: config.orchestration.budgetCents } : {}),
      ...(intent === "audio"
        ? {
            prompt: request,
            music_length_ms: durationSeconds(request) * 1000,
            force_instrumental: !/vocal|voice|lyrics|sing/i.test(request),
            estimated_cost_cents: capability.providerCostCents
          }
        : {}),
      ...(intent === "image"
        ? {
            prompt: request,
            model: providers?.config?.providers?.openai?.imageModel || "gpt-image-1.5",
            output_format: "png",
            quality: "medium",
            size: "1024x1024",
            estimated_cost_cents: capability.providerCostCents
          }
        : {}),
      ...(intent === "video"
        ? {
            prompt: request,
            model: "ray-3.2",
            aspect_ratio: "16:9",
            resolution: "720p",
            duration_seconds: videoDurationSeconds(request),
            estimated_cost_cents: capability.providerCostCents
          }
        : {})
    },
    steps: capability.steps,
    deliverables: capability.deliverables,
    success_criteria: [
      "Every claimed deliverable is persisted as a durable private artifact.",
      "Credits are captured only after artifact verification succeeds.",
      "A terminal failure records an incident and restores reserved credits."
    ],
    clarification_questions: [],
    warnings: capability.warnings,
    credit_cost: capability.creditCost,
    provider_cost_cents: capability.providerCostCents,
    platform_fee_cents: 0,
    total_estimated_cost_cents: total,
    currency: "USD",
    pricing_version: CREATION_PRICING_VERSION,
    quote_expires_at: expires,
    consent_summary:
      capability.creditCost +
      " IABT credit" +
      (capability.creditCost === 1 ? "" : "s") +
      " will be reserved only after explicit approval.",
    job_type: capability.jobType,
    commercial_summary: {
      execution_ready: capability.renderReady,
      owner_demo_only: ownerDemo,
      provider_technical_ready: capability.providerReady
    },
    credit_coverage: {
      covered: account.available_credits >= capability.creditCost,
      available: account.available_credits,
      required: capability.creditCost
    }
  }, { id: recordId });
  if (plan.request_fingerprint !== requestFingerprint) {
    throw Object.assign(new Error("This submission ID belongs to a different request or attachment version."), { status: 409, code: "idempotency_conflict" });
  }
  // Reused records retain their original quote and signature. Re-signing a
  // mutated quote during replay could authorize different tools or file bytes.
  const policy = creationPolicy(plan);
  if (!plan.quote_signature) {
    plan = await repository.updateRecord("CreationPlan", plan.id, user, {
      quote_signature: signQuote(config, plan),
      autonomy_policy: policy,
      consent_summary: automatic && policy.automatic && creationRequestDisposition(request).create
        ? `${plan.credit_cost} IABT credit(s) reserved automatically for your requested private workflow; captured after verified delivery. No external provider charge.`
        : plan.consent_summary
    });
  }
  if (automatic && policy.automatic && creationRequestDisposition(request).create) {
    return executeCreationPlan({ repository, config, storage, user, automatic: true, body: {
      plan_id: plan.id, pricing_version: plan.pricing_version, accepted_total_cents: plan.total_estimated_cost_cents
    } });
  }
  return {
    ok: true,
    plan,
    quote: {
      plan_id: plan.id,
      credit_cost: plan.credit_cost,
      provider_cost_cents: plan.provider_cost_cents,
      platform_fee_cents: plan.platform_fee_cents,
      total_estimated_cost_cents: plan.total_estimated_cost_cents,
      currency: plan.currency,
      pricing_version: plan.pricing_version,
      quote_expires_at: plan.quote_expires_at,
      consent_summary: plan.consent_summary,
      requires_explicit_approval: true,
      credit_coverage: plan.credit_coverage
    },
    billing: {
      card_charged: false,
      credits_reserved: false,
      action: "quote_only"
    }
  };
};

export const executeCreationPlan = async ({
  repository,
  config,
  storage,
  user,
  body,
  automatic = false
}) => {
  const plan = await repository.getRecord("CreationPlan", normalize(body.plan_id, 200), { ...user, role: "user" });
  if (!plan) {
    throw Object.assign(new Error("Creation plan was not found"), {
      status: 404,
      code: "plan_not_found"
    });
  }
  const automaticAllowed = automatic === true && creationPolicy(plan).automatic && creationRequestDisposition(plan.request_text).create;
  if (body.approved !== true && !automaticAllowed) {
    throw Object.assign(new Error("Explicit approval is required"), {
      status: 400,
      code: "explicit_approval_required"
    });
  }
  if (
    body.pricing_version !== plan.pricing_version ||
    Number(body.accepted_total_cents) !== Number(plan.total_estimated_cost_cents) ||
    !verifyQuoteSignature(config, plan)
  ) {
    throw Object.assign(
      new Error("The approval does not match the server-owned quote. Request a new plan."),
      { status: 409, code: "quote_mismatch" }
    );
  }
  if (plan.status !== "quoted") {
    if (plan.execution_job_id) {
      const existing = await repository.getJob(plan.execution_job_id, user);
      if (!existing) throw Object.assign(new Error("The execution job could not be found"), { status: 409, code: "plan_job_missing" });
      const reconciled = TERMINAL_JOB_STATUSES.has(existing.status) && plan.status !== terminalPlanStatus(existing.status)
        ? await repository.updateRecord("CreationPlan", plan.id, user, { status: terminalPlanStatus(existing.status) })
        : plan;
      return { ok: true, reused: true, job: existing, plan: reconciled };
    }
    throw Object.assign(new Error("This plan is no longer eligible for execution"), {
      status: 409,
      code: "plan_not_executable"
    });
  }
  if (Date.parse(plan.quote_expires_at) <= Date.now()) {
    await repository.updateRecord("CreationPlan", plan.id, user, { status: "expired" });
    throw Object.assign(new Error("This quote expired. Request a new plan."), {
      status: 410,
      code: "quote_expired"
    });
  }

  if (plan.file_references?.length) {
    await readTextSources({
      repository, storage, user,
      fileIds: plan.file_references.map((reference) => reference.file_id),
      expectedReferences: plan.file_references
    });
  }

  // A browser-supplied key must never reserve the same plan twice.
  const idempotencyKey = "plan:" + plan.id + ":" + plan.pricing_version;
  const ownerDemo = Boolean(plan.commercial_summary?.owner_demo_only);
  let job = await repository.enqueueJob({
    ownerId: user.id,
    jobType: plan.job_type,
    input: {
      ...plan.normalized_spec,
      title: plan.title,
      intent: plan.intent,
      request_text: plan.request_text,
      plan_id: plan.id,
      conversation_id: plan.conversation_id || "",
      project_id: plan.project_id || "",
      ...(plan.file_references?.length ? { file_references: plan.file_references } : {}),
      render_ready: Boolean(plan.render_ready)
    },
    approval: {
      approved: true,
      source: automaticAllowed ? "autonomy_policy" : "explicit_user",
      policy_version: creationPolicy(plan).version,
      pricing_version: plan.pricing_version,
      approval_id: "plan:" + plan.id,
      approved_at: new Date().toISOString(),
      scope: ownerDemo ? "owner_demo" : "commercial",
      max_cost_cents: Number(plan.provider_cost_cents || 0)
    },
    idempotencyKey,
    creditAmount: Number(plan.credit_cost || 0),
    maxAttempts: 3
  });
  let updated = await repository.updateRecord("CreationPlan", plan.id, user, {
    status: TERMINAL_JOB_STATUSES.has(job.status) ? terminalPlanStatus(job.status) : "executing",
    approved_at: job.approval?.approved_at || new Date().toISOString(),
    execution_job_id: job.id
  });
  // A worker may finish while enqueue/plan projection are interleaved. Read
  // the authoritative job after the write so a late replay cannot roll back a
  // completed plan to "executing" or advertise a second credit reservation.
  job = await repository.getJob(job.id, user) || job;
  const terminal = TERMINAL_JOB_STATUSES.has(job.status);
  if (terminal && updated.status !== terminalPlanStatus(job.status)) {
    updated = await repository.updateRecord("CreationPlan", plan.id, user, { status: terminalPlanStatus(job.status) });
  }
  await repository.createRecord("ConsentGrant", user, {
    user_id: user.id,
    user_email: user.email,
    plan_id: plan.id,
    job_id: job.id,
    mode: plan.render_ready ? "render" : "prepare",
    pricing_version: plan.pricing_version,
    accepted_total_cents: Number(plan.total_estimated_cost_cents || 0),
    currency: plan.currency,
    acceptance_text:
      automaticAllowed
        ? "User requested this workflow; server policy authorized reversible private execution with no external provider cost and the disclosed IABT credit reservation."
        : "User explicitly approved the exact server-owned quote and IABT credit reservation.",
    authorization_source: automaticAllowed ? "autonomy_policy" : "explicit_user",
    accepted_at: new Date().toISOString()
  }, { id: job.id });
  return {
    ok: true,
    reused: terminal,
    plan: updated,
    job: {
      id: job.id,
      plan_id: plan.id,
      conversation_id: plan.conversation_id || "",
      project_id: plan.project_id || "",
      intent: plan.intent,
      mode: plan.render_ready ? "render" : "prepare",
      provider: plan.provider,
      status: job.status,
      progress: job.status === "succeeded" ? 100 : 0,
      stage: terminal ? (job.status === "succeeded" ? "Verified deliverables are ready" : "Job ended; review its recovery details") : automaticAllowed ? "Safe private workflow queued automatically" : "Approval recorded; queued for production",
      usage_state: job.credit_amount > 0 ? terminal ? job.status === "succeeded" ? "captured" : "released" : "reserved" : "none"
    },
    billing: {
      card_charged: false,
      credits_reserved: !terminal && job.credit_amount > 0,
      credits_deducted: false,
      action: terminal ? "already_finalized" : "reserve_only"
    }
  };
};
