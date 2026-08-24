import { createClientFromRequest } from "npm:@base44/sdk";
import {
  getCreationCapabilities,
  planRequest,
  publicCapability,
  quoteFor,
  requireUser,
  selectedCreationIntent,
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
    const quote = quoteFor(details.intent, details.normalized_spec);
    const capability = quote.capability;
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
    const service = base44.asServiceRole;
    const videoRenderUnavailable = details.intent === "video" && !capability.render_ready;
    const planSummary = videoRenderUnavailable
      ? "JERICHO can prepare the complete video production package, but IABT's managed renderer is not active yet. Approving this plan will not create or imply an MP4."
      : details.assistant_summary;
    const planSteps = videoRenderUnavailable
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
      : details.steps;
    const planDeliverables = videoRenderUnavailable
      ? [
          "Video direction package",
          "Storyboard-ready preproduction document",
          "Final render prompt for a compatible video renderer",
        ]
      : details.deliverables;
    const planWarnings = videoRenderUnavailable
      ? Array.from(new Set([
          ...(details.warnings || []),
          "VIDEO RENDERER OFFLINE: this approval creates preproduction only. No MP4 will be generated until IABT's managed renderer and paid-media gates are enabled.",
        ]))
      : [...(details.warnings || [])];
    if (!creditCovered) {
      planWarnings.push(
        creditPolicy.purchased_credits_only
          ? "PURCHASED PRODUCTION CREDITS REQUIRED: Free-plan paid production needs purchased IABT credits before approval."
          : "IABT CREDIT BALANCE TOO LOW: this plan needs " + quote.credit_cost + " credits, but only " + availableCredits + " eligible credits are currently available.",
      );
    }
    if (!commercialAssessment.allowed) {
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
      success_criteria: details.success_criteria,
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
          margin_target_met: commercialAssessment.margin.target_met,
          margin_floor_met: commercialAssessment.margin.floor_met,
          blocker_codes: commercialAssessment.blockers,
          policy_version: commercialAssessment.policy.pricing_version,
        },
      },
      capabilities: getCreationCapabilities().map(publicCapability),
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
