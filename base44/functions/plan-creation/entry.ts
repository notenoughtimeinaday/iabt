import { createClientFromRequest } from "npm:@base44/sdk";
import {
  getCreationCapabilities,
  planRequest,
  publicCapability,
  quoteFor,
  requireUser,
} from "../../shared/creation.ts";

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
    const conversationId = text(body?.conversation_id, 200);
    const projectId = text(body?.project_id, 200);
    const context = body?.context && typeof body.context === "object" && !Array.isArray(body.context)
      ? body.context
      : null;

    if (requestText.length < 3) {
      return Response.json({ error: "Describe what you want IABT to create." }, { status: 400 });
    }

    await verifyProjectAccess(base44, user, projectId);
    const details = await planRequest(base44, requestText, context);
    const quote = quoteFor(details.intent, details.normalized_spec);
    const capability = quote.capability;
    const service = base44.asServiceRole;

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
      assistant_summary: details.assistant_summary,
      normalized_spec: details.normalized_spec,
      steps: details.steps,
      deliverables: details.deliverables,
      success_criteria: details.success_criteria,
      clarification_questions: details.clarification_questions,
      warnings: details.warnings,
      credit_cost: quote.credit_cost,
      provider_cost_cents: quote.provider_cost_cents,
      platform_fee_cents: quote.platform_fee_cents,
      total_estimated_cost_cents: quote.total_estimated_cost_cents,
      currency: quote.currency,
      pricing_version: quote.pricing_version,
      quote_expires_at: quote.quote_expires_at,
      consent_summary: quote.consent_summary,
    });

    await service.entities.UsageLedger.create({
      user_id: user.id,
      user_email: user.email,
      plan_id: plan.id,
      event_type: "estimate",
      unit: quote.provider_cost_cents > 0 ? "usd_cent" : "generation",
      amount: quote.provider_cost_cents > 0 ? quote.provider_cost_cents : 1,
      pricing_version: quote.pricing_version,
      description: quote.provider_cost_cents > 0
        ? "Provider-cost quote preview only; no card charge, credit reservation, or deduction was performed."
        : "Included generation estimate only; no card charge, credit reservation, or deduction was performed.",
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
        billing_action: "none",
      },
      capabilities: getCreationCapabilities().map(publicCapability),
      next_action: "Show the exact quote and plan to the user. Call execute-creation only after explicit approval.",
      billing: {
        card_charged: false,
        credits_deducted: false,
        action: "none",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
