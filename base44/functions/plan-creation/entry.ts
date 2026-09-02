import { createClientFromRequest } from "npm:@base44/sdk";
import {
  getCreationCapabilities,
  planRequest,
  publicCapability,
  quoteFor,
  requireUser,
  selectedCreationIntent,
  verifyElevenLabsAuthentication,
} from "../../shared/creation.ts";
import { creditEligibility } from "../../shared/credit-policy.ts";
import {
  entitlementUsageSummary,
  getOrCreateEntitlement,
} from "../../shared/usage.ts";
import { evaluateCommercialExecution } from "../../shared/commercial-governance.ts";

function text(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

async function verifyProjectAccess(base44: any, user: any, projectId: string) {
  if (!projectId) return;
  try {
    const project = await base44.entities.Project.get(projectId);
    const ownsProject = project && (
      user.role === "admin" ||
      String(project.user_id || "") === String(user.id) ||
      String(project.created_by || "") === String(user.email)
    );
    if (!ownsProject) {
      throw new Error("Project not found.");
    }
  } catch {
    throw new Response(JSON.stringify({ error: "Project not found or access denied." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "tsv", "json", "jsonc", "yaml", "yml", "xml", "html", "css",
  "js", "jsx", "ts", "tsx", "py", "java", "cpp", "c", "h", "go", "rs", "rb", "php",
  "sql", "sh", "env", "log", "rtf",
]);
const TEXT_MIME_RE = /^(text\/|application\/(json|xml|javascript|x-javascript|typescript|csv|sql|yaml|x-yaml)|image\/svg\+xml)/i;

function uniqueTextList(values: unknown[], max = 12) {
  return [...new Set(values.map((value) => text(value, 240)).filter(Boolean))].slice(0, max);
}

function ownsAsset(user: any, asset: any) {
  return Boolean(asset && (
    user.role === "admin" ||
    String(asset.user_id || "") === String(user.id) ||
    String(asset.created_by || "") === String(user.email)
  ));
}

function assetIdList(context: any) {
  const fromArrays = [
    ...(Array.isArray(context?.uploaded_asset_ids) ? context.uploaded_asset_ids : []),
    ...(Array.isArray(context?.input_asset_ids) ? context.input_asset_ids : []),
    ...(Array.isArray(context?.asset_ids) ? context.asset_ids : []),
    ...(Array.isArray(context?.uploaded_assets) ? context.uploaded_assets.map((asset: any) => asset?.id || asset?.asset_id) : []),
  ];
  return uniqueTextList(fromArrays, 12);
}

function assetScopeList(context: any, conversationId: string, projectId: string) {
  return uniqueTextList([
    context?.asset_scope_id,
    projectId,
    conversationId ? "conversation:" + conversationId : "",
  ], 4);
}

function shouldExtractText(asset: any) {
  const ext = text(asset?.file_type || String(asset?.name || "").split(".").pop(), 40).toLowerCase();
  const mime = text(asset?.mime_type, 120).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || TEXT_MIME_RE.test(mime);
}

async function extractTextExcerpt(asset: any) {
  if (!shouldExtractText(asset)) return { status: "metadata_only", text_excerpt: "" };
  const size = Number(asset?.size_bytes || 0);
  if (size > 1_000_000) return { status: "metadata_only_large_file", text_excerpt: "" };
  const url = text(asset?.file_url, 4000);
  if (!/^https:\/\//i.test(url)) return { status: "metadata_only_no_url", text_excerpt: "" };
  try {
    const response = await fetch(url);
    if (!response.ok) return { status: "text_fetch_failed", text_excerpt: "" };
    const declared = Number(response.headers.get("content-length") || size || 0);
    if (declared > 1_000_000) return { status: "metadata_only_large_file", text_excerpt: "" };
    const contentType = String(response.headers.get("content-type") || asset?.mime_type || "");
    if (!TEXT_MIME_RE.test(contentType) && !shouldExtractText(asset)) {
      return { status: "metadata_only", text_excerpt: "" };
    }
    const raw = await response.text();
    const cleaned = raw.replace(/\u0000/g, "").replace(/[\t ]+$/gm, "").trim();
    return {
      status: cleaned ? "text_excerpt_ready" : "metadata_only_empty_text",
      text_excerpt: cleaned.slice(0, 12000),
    };
  } catch {
    return { status: "text_fetch_failed", text_excerpt: "" };
  }
}

async function summarizeAsset(asset: any) {
  const extracted = await extractTextExcerpt(asset);
  return {
    id: text(asset?.id, 200),
    name: text(asset?.name, 240),
    kind: text(asset?.kind, 40) || "other",
    mime_type: text(asset?.mime_type, 120),
    file_type: text(asset?.file_type, 40),
    size_bytes: Number.isFinite(Number(asset?.size_bytes)) ? Number(asset.size_bytes) : 0,
    notes: text(asset?.notes, 1000),
    processing_status: extracted.status,
    ...(extracted.text_excerpt ? { text_excerpt: extracted.text_excerpt } : {}),
  };
}

async function resolveInputAssets(base44: any, user: any, context: any, conversationId: string, projectId: string) {
  const service = base44.asServiceRole;
  const ids = assetIdList(context || {});
  const scopes = assetScopeList(context || {}, conversationId, projectId);
  const records = new Map<string, any>();

  for (const id of ids) {
    const asset = await service.entities.Asset.get(id).catch(() => null);
    if (asset?.id) records.set(String(asset.id), asset);
  }
  for (const scope of scopes) {
    const rows = await service.entities.Asset.filter({ project_id: scope }, "-created_date", 20).catch(() => []);
    for (const asset of rows || []) {
      if (asset?.id) records.set(String(asset.id), asset);
    }
  }

  const owned = [...records.values()].filter((asset) => ownsAsset(user, asset)).slice(0, 12);
  return Promise.all(owned.map(summarizeAsset));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const requestText = text(body?.request_text || body?.request || body?.prompt, 12000);
    const rawContext = body?.context && typeof body.context === "object" && !Array.isArray(body.context)
      ? body.context
      : null;
    const contextHasMode = rawContext && Object.prototype.hasOwnProperty.call(rawContext, "selected_mode");
    const selectedMode = selectedCreationIntent(rawContext?.selected_mode);
    if (contextHasMode && !selectedMode) {
      return Response.json({ error: "context.selected_mode is not a supported creation mode." }, { status: 400 });
    }
    const context = rawContext
      ? { ...rawContext, ...(selectedMode ? { selected_mode: selectedMode } : {}) }
      : null;
    const bodyConversationId = text(body?.conversation_id, 200);
    const contextConversationId = text(context?.conversation_id, 200);
    if (bodyConversationId && contextConversationId && bodyConversationId !== contextConversationId) {
      return Response.json({ error: "conversation_id does not match context.conversation_id." }, { status: 400 });
    }
    const conversationId = bodyConversationId || contextConversationId;
    const projectId = text(body?.project_id, 200);

    if (requestText.length < 3) {
      return Response.json({ error: "Describe what you want IABT to create." }, { status: 400 });
    }

    await verifyProjectAccess(base44, user, projectId);
    const details = await planRequest(base44, requestText, context);
    const ownerDemoRequested = user.role === "admin";
    const audioProvider = details.intent === "audio"
      ? await verifyElevenLabsAuthentication()
      : null;
    const audioAuthenticated = details.intent !== "audio" || audioProvider?.authenticated === true;
    const audioMusicApiEligible = details.intent !== "audio" || audioProvider?.music_api_eligible === true;
    const quote = quoteFor(details.intent, details.normalized_spec, {
      ownerDemo: ownerDemoRequested,
      audioAuthenticated,
      audioMusicApiEligible,
      audioErrorCode: audioProvider?.error_code,
    });
    const capability = quote.capability;
    const ownerDemoOnly = Boolean(capability.owner_demo_only && ownerDemoRequested);
    const entitlement = await getOrCreateEntitlement(base44, user);
    const usage = entitlementUsageSummary(entitlement);
    const paidMedia = Number(capability.total_estimated_cost_cents || 0) > 0;
    const creditPolicy = creditEligibility(usage.plan, paidMedia);
    const availableCredits = creditPolicy.included_credits_eligible
      ? usage.total_remaining
      : usage.bonus_remaining;
    const creditCovered = availableCredits >= quote.credit_cost;
    const commercialAssessment = await evaluateCommercialExecution(base44, {
      provider: capability.provider,
      capabilityId: capability.id,
      providerCostCents: quote.provider_cost_cents,
      creditCost: quote.credit_cost,
    });
    const ownerDemoExecutionAllowed = ownerDemoOnly &&
      commercialAssessment.blockers.every((code: string) => code === "provider_agreement_not_approved");
    const service = base44.asServiceRole;
    const videoRenderUnavailable = details.intent === "video" && !capability.render_ready;
    const audioRenderUnavailable = details.intent === "audio" && !capability.render_ready;
    const audioRenderReady = details.intent === "audio" && capability.render_ready;
    const planSummary = ownerDemoOnly
      ? details.intent === "audio"
        ? "JERICHO will create a private owner-test MP3 through IABT managed audio production. This demo is AI-generated and is not approved for customer production, resale, advertising, or white-label release."
        : "JERICHO will create a private owner-test MP4 through IABT managed video production. This demo is AI-generated and is not approved for customer production, resale, or white-label release."
      : videoRenderUnavailable
        ? "JERICHO can prepare the complete video production package, but IABT's managed renderer is not active yet. Approving this plan will not create or imply an MP4."
      : audioRenderUnavailable
        ? "JERICHO can create a downloadable audio preproduction package, but IABT managed audio production is not fully enabled. Approving this plan will not create or imply WAV, MP3, stems, or MIDI files."
        : details.assistant_summary;
    const planSteps = audioRenderReady
      ? [
          {
            order: 1,
            title: "Audio direction",
            description: "Define duration, structure, instrumentation, voice, pacing, and mix direction.",
            tool: "JERICHO planner",
            deliverable: "Audio production specification",
          },
          {
            order: 2,
            title: ownerDemoOnly ? "Owner audio render" : "Managed audio render",
            description: "Generate and securely store the approved MP3 through ElevenLabs Music.",
            tool: "IABT managed audio production",
            deliverable: "Playable MP3",
          },
        ]
      : videoRenderUnavailable
      ? [
          {
            order: 1,
            title: "Production direction",
            description: "Create the concept, script, shot list, motion, camera, lighting, pacing, and sound direction.",
            tool: "JERICHO planner",
            deliverable: "Video direction package",
          },
          {
            order: 2,
            title: "Renderer-ready package",
            description: "Create storyboard prompts and a final render prompt for the installed video adapter. No MP4 is produced until the renderer is active.",
            tool: "IABT preproduction",
            deliverable: "Storyboard-ready preproduction document",
          },
        ]
      : audioRenderUnavailable
        ? [
            {
              order: 1,
              title: "Audio direction",
              description: "Define structure, timing, voice, instrumentation, lyrics or script, arrangement, and mix direction.",
              tool: "JERICHO planner",
              deliverable: "Audio production specification",
            },
            {
              order: 2,
              title: "Downloadable preproduction package",
              description: "Create a detailed production document for use with a compatible audio renderer or human producer. No playable audio is generated.",
              tool: "IABT preproduction",
              deliverable: "Audio preproduction document",
            },
          ]
        : details.steps;
    const planDeliverables = audioRenderReady
      ? [
          "Playable downloadable MP3",
          "Downloadable audio production specification",
        ]
      : videoRenderUnavailable
      ? [
          "Video direction package",
          "Storyboard-ready preproduction document",
          "Final render prompt for a compatible video renderer",
        ]
      : audioRenderUnavailable
        ? [
            "Downloadable audio preproduction document",
            "Timing, cue sheet, arrangement, voice, and mix direction",
            "Renderer-ready instructions for a compatible audio production service",
          ]
        : details.deliverables;
    const planSuccessCriteria = audioRenderReady
      ? [
          "The MP3 is non-empty, stored privately, and playable through a signed delivery URL.",
          "The audio production specification is preserved with the MP3 artifact.",
          "Provider execution occurs only after the exact quote is explicitly approved.",
        ]
      : audioRenderUnavailable
      ? [
          "A downloadable audio preproduction document is delivered.",
          "The result does not claim that playable audio, stems, or MIDI files were rendered.",
        ]
      : details.success_criteria;
    const planWarnings = audioRenderReady
      ? (details.warnings || []).filter((warning: string) => !/AUDIO RENDERER NOT READY/i.test(warning))
      : videoRenderUnavailable
      ? Array.from(new Set([
          ...(details.warnings || []),
          "VIDEO RENDERER OFFLINE: this approval creates preproduction only. No MP4 will be generated until IABT's managed renderer and paid-media gates are enabled.",
        ]))
      : audioRenderUnavailable
        ? Array.from(new Set([
            ...(details.warnings || []),
            "AUDIO RENDERER NOT CONNECTED: this approval creates a downloadable production document only. No WAV, MP3, stems, or MIDI files will be generated.",
          ]))
        : [...(details.warnings || [])];
    if (!creditCovered) {
      planWarnings.push(
        creditPolicy.purchased_credits_only
          ? "PURCHASED PRODUCTION CREDITS REQUIRED: Free-plan paid production needs purchased IABT credits before approval."
          : "IABT CREDIT BALANCE TOO LOW: this plan needs " + quote.credit_cost + " credits, but only " + availableCredits + " eligible credits are currently available.",
      );
    }
    if (ownerDemoExecutionAllowed) {
      planWarnings.push(
        details.intent === "audio"
          ? "OWNER DEMO ONLY: this private AI-generated MP3 is not approval for customer production, resale, advertising, public white-label release, or commercial launch."
          : "OWNER DEMO ONLY: this private AI-generated MP4 is not approval for customer production, resale, public white-label release, or commercial launch.",
      );
    } else if (!commercialAssessment.allowed) {
      planWarnings.push(
        "COMMERCIAL APPROVAL REQUIRED: final paid production is blocked until its supplier agreement, privacy review, margin floor, and spending limits all pass.",
      );
    }

    const plan = await service.entities.CreationPlan.create({
      user_id: user.id,
      user_email: user.email,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      request_text: requestText,
      title: details.title,
      intent: details.intent,
      status: "quoted",
      capability_id: capability.id,
      provider: capability.provider,
      provider_ready: capability.provider_ready,
      render_ready: capability.render_ready,
      fallback_available: capability.fallback_available,
      assistant_summary: planSummary,
      normalized_spec: details.normalized_spec,
      steps: planSteps,
      deliverables: planDeliverables,
      success_criteria: planSuccessCriteria,
      clarification_questions: details.clarification_questions,
      warnings: planWarnings,
      credit_cost: quote.credit_cost,
      provider_cost_cents: quote.provider_cost_cents,
      platform_fee_cents: quote.platform_fee_cents,
      total_estimated_cost_cents: quote.total_estimated_cost_cents,
      currency: quote.currency,
      pricing_version: quote.pricing_version,
      quote_expires_at: quote.quote_expires_at,
      consent_summary: quote.consent_summary,
      commercial_summary: {
        ready: commercialAssessment.allowed,
        execution_ready: commercialAssessment.allowed || ownerDemoExecutionAllowed,
        owner_demo_only: ownerDemoOnly,
        paid_provider: commercialAssessment.paid_provider,
        margin_target_met: commercialAssessment.margin.target_met,
        margin_floor_met: commercialAssessment.margin.floor_met,
        blocker_codes: commercialAssessment.blockers,
        policy_version: commercialAssessment.policy.pricing_version,
        included_credits_eligible: creditPolicy.included_credits_eligible,
        purchased_credits_required: creditPolicy.purchased_credits_only,
      },
    });

    await service.entities.UsageLedger.create({
      user_id: user.id,
      user_email: user.email,
      plan_id: plan.id,
      event_type: "estimate",
      unit: "media_credit",
      amount: quote.credit_cost,
      pricing_version: quote.pricing_version,
      description: quote.provider_cost_cents > 0
        ? "Quote preview: " + quote.credit_cost + " IABT credits cover an estimated provider cost of $" + (quote.provider_cost_cents / 100).toFixed(2) + ". No card charge or credit reservation was performed during planning."
        : "Quote preview: " + quote.credit_cost + " IABT credit. No card charge or credit reservation was performed during planning.",
      status: "preview",
      occurred_at: new Date().toISOString(),
    });

    return Response.json({
      ok: true,
      plan,
      quote: {
        plan_id: plan.id,
        capability: publicCapability(capability),
        credit_cost: quote.credit_cost,
        provider_cost_cents: quote.provider_cost_cents,
        platform_fee_cents: quote.platform_fee_cents,
        total_estimated_cost_cents: quote.total_estimated_cost_cents,
        currency: quote.currency,
        pricing_version: quote.pricing_version,
        quote_expires_at: quote.quote_expires_at,
        consent_summary: quote.consent_summary,
        requires_explicit_approval: true,
        billing_action: quote.billing_action,
        credit_coverage: {
          covered: creditCovered,
          plan: usage.plan,
          required: quote.credit_cost,
          available: availableCredits,
          included_remaining: usage.monthly_remaining,
          purchased_remaining: usage.bonus_remaining,
          included_credits_eligible: creditPolicy.included_credits_eligible,
          purchased_credits_required: creditPolicy.purchased_credits_only,
        },
        commercial: {
          ready: commercialAssessment.allowed,
          execution_ready: commercialAssessment.allowed || ownerDemoExecutionAllowed,
          owner_demo_only: ownerDemoOnly,
          margin_target_met: commercialAssessment.margin.target_met,
          margin_floor_met: commercialAssessment.margin.floor_met,
          blocker_codes: commercialAssessment.blockers,
          policy_version: commercialAssessment.policy.pricing_version,
        },
      },
      capabilities: getCreationCapabilities({
        ownerDemo: ownerDemoRequested,
        audioAuthenticated,
        audioMusicApiEligible,
        audioErrorCode: audioProvider?.error_code,
      }).map(publicCapability),
      next_action: "Show the exact quote and plan to the user. Call execute-creation only after explicit approval.",
      billing: {
        card_charged: false,
        credits_deducted: false,
        credits_reserved: false,
        credits_required_on_approval: quote.credit_cost,
        credit_coverage_ready: creditCovered,
        action: "quote_only",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
