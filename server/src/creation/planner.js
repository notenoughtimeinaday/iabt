import { createHmac, timingSafeEqual } from "node:crypto";

export const CREATION_PRICING_VERSION = "iabt-standalone-2026-09-04.1";
const QUOTE_TTL_MS = 30 * 60 * 1000;

const normalize = (value, max = 12000) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export const inferCreationIntent = (requestText) => {
  const text = normalize(requestText).toLowerCase();
  if (/\b(website|web site|landing page|storefront|e-?commerce site)\b/.test(text)) return "website";
  if (/\b(app|application|mobile app|web app|software|piano app)\b/.test(text)) return "app";
  if (/\b(video|mp4|film|animation|commercial clip)\b/.test(text)) return "video";
  if (/\b(audio|song|music track|mp3|voiceover|sound effect)\b/.test(text)) return "audio";
  if (/\b(document|report|proposal|letter|pdf|docx|manual)\b/.test(text)) return "document";
  if (/\b(image|photo|illustration|logo|poster|graphic)\b/.test(text)) return "image";
  if (/\b(code|script|library|api)\b/.test(text)) return "code";
  return "app";
};

const titleFor = (requestText, intent) => {
  const text = normalize(requestText, 140);
  if (/piano/i.test(text) && intent === "app") return "Keyboard Piano";
  if (/merch|store|shop|e-?commerce/i.test(text)) return "IABT Advertising Storefront";
  if (intent === "audio") return "Original Audio Production";
  if (intent === "video") return "Video Production";
  if (intent === "document") return "JERICHO Document";
  return text.slice(0, 90) || "IABT Creation";
};

const durationSeconds = (requestText) => {
  const seconds = normalize(requestText).match(/\b(\d{1,3})\s*(?:second|sec|s)\b/i);
  if (seconds) return Math.max(3, Math.min(600, Number(seconds[1])));
  const clock = normalize(requestText).match(/\b(\d{1,2}):(\d{2})\b/);
  return clock ? Math.max(3, Math.min(600, Number(clock[1]) * 60 + Number(clock[2]))) : 30;
};

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
  plan.quote_expires_at
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

const capabilityFor = (intent, user, providers, requestText) => {
  const readiness = providers?.readiness?.() || {};
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
      id: "iabt-document-v1",
      provider: "iabt-standalone",
      providerReady: true,
      renderReady: true,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.document",
      deliverables: ["Downloadable Markdown document"],
      steps: [
        { order: 1, title: "Structure content", deliverable: "Document outline" },
        { order: 2, title: "Create and verify", deliverable: "Markdown document" }
      ],
      warnings: ["DOCX and PDF exporters will be connected in a later standalone migration milestone."]
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
  if (intent === "video") {
    return {
      id: "luma-ray-3.2",
      provider: "luma",
      providerReady: Boolean(readiness.luma?.configured),
      renderReady: false,
      creditCost: 1,
      providerCostCents: 0,
      jobType: "creation.document",
      deliverables: ["Downloadable video production brief"],
      steps: [
        { order: 1, title: "Video direction", deliverable: "Shot and motion plan" },
        { order: 2, title: "Preproduction package", deliverable: "Renderer-ready document" }
      ],
      warnings: ["VIDEO ASYNC ORCHESTRATION PENDING: this standalone milestone will not claim an MP4."]
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
  user,
  requestText,
  conversationId = "",
  projectId = ""
}) => {
  const request = normalize(requestText);
  if (request.length < 3) {
    throw Object.assign(new Error("Describe what you want IABT to create"), {
      status: 400,
      code: "request_too_short"
    });
  }
  const intent = inferCreationIntent(request);
  const capability = capabilityFor(intent, user, providers, request);
  const now = new Date();
  const expires = new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
  const total = capability.providerCostCents;
  const account = await repository.getCreditAccount(user.id);
  const ownerDemo =
    user.role === "admin" &&
    (intent === "audio" || intent === "video") &&
    capability.providerReady;

  let plan = await repository.createRecord("CreationPlan", user, {
    user_id: user.id,
    user_email: user.email,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(projectId ? { project_id: projectId } : {}),
    request_text: request,
    title: titleFor(request, intent),
    intent,
    status: "quoted",
    capability_id: capability.id,
    provider: capability.provider,
    provider_ready: capability.providerReady,
    render_ready: capability.renderReady,
    fallback_available: true,
    assistant_summary:
      "JERICHO inferred " + intent + " from your request and prepared an exact server-owned plan.",
    normalized_spec: {
      creative_prompt: request,
      ...(intent === "audio"
        ? {
            music_length_ms: durationSeconds(request) * 1000,
            force_instrumental: !/vocal|voice|lyrics|sing/i.test(request),
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
  });
  plan = await repository.updateRecord("CreationPlan", plan.id, user, {
    quote_signature: signQuote(config, plan)
  });
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
  user,
  body
}) => {
  const plan = await repository.getRecord("CreationPlan", normalize(body.plan_id, 200), user);
  if (!plan) {
    throw Object.assign(new Error("Creation plan was not found"), {
      status: 404,
      code: "plan_not_found"
    });
  }
  if (body.approved !== true) {
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
      return { ok: true, reused: true, job: existing };
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

  const idempotencyKey =
    normalize(body.idempotency_key, 200) ||
    "plan:" + plan.id + ":" + plan.pricing_version;
  const ownerDemo = Boolean(plan.commercial_summary?.owner_demo_only);
  const job = await repository.enqueueJob({
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
      render_ready: Boolean(plan.render_ready)
    },
    approval: {
      approved: true,
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
  const updated = await repository.updateRecord("CreationPlan", plan.id, user, {
    status: "executing",
    approved_at: new Date().toISOString(),
    execution_job_id: job.id
  });
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
      "User explicitly approved the exact server-owned quote and IABT credit reservation.",
    accepted_at: new Date().toISOString()
  });
  return {
    ok: true,
    reused: false,
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
      progress: 0,
      stage: "Approval recorded; queued for production",
      usage_state: job.credit_amount > 0 ? "reserved" : "none"
    },
    billing: {
      card_charged: false,
      credits_reserved: job.credit_amount > 0,
      credits_deducted: false,
      action: "reserve_only"
    }
  };
};
