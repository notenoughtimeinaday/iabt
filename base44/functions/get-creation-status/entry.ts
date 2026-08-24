import { createClientFromRequest } from "npm:@base44/sdk";
import { getCreationCapabilities, requireUser } from "../../shared/creation.ts";

function clean(value: unknown, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function planSummary(plan: any) {
  if (!plan) return null;
  return {
    id: plan.id,
    conversation_id: plan.conversation_id || null,
    project_id: plan.project_id || null,
    title: plan.title,
    intent: plan.intent,
    status: plan.status,
    capability_id: plan.capability_id,
    provider: plan.provider,
    provider_ready: Boolean(plan.provider_ready),
    render_ready: Boolean(plan.render_ready),
    fallback_available: Boolean(plan.fallback_available),
    assistant_summary: clean(plan.assistant_summary, 3000),
    steps: Array.isArray(plan.steps) ? plan.steps.slice(0, 20) : [],
    deliverables: Array.isArray(plan.deliverables) ? plan.deliverables.slice(0, 20) : [],
    success_criteria: Array.isArray(plan.success_criteria) ? plan.success_criteria.slice(0, 20) : [],
    clarification_questions: Array.isArray(plan.clarification_questions)
      ? plan.clarification_questions.slice(0, 10)
      : [],
    warnings: Array.isArray(plan.warnings) ? plan.warnings.slice(0, 20) : [],
    credit_cost: Number(plan.credit_cost || 0),
    provider_cost_cents: Number(plan.provider_cost_cents || 0),
    platform_fee_cents: Number(plan.platform_fee_cents || 0),
    total_estimated_cost_cents: Number(plan.total_estimated_cost_cents || 0),
    currency: plan.currency || "USD",
    pricing_version: plan.pricing_version,
    quote_expires_at: plan.quote_expires_at || null,
    approved_at: plan.approved_at || null,
    execution_job_id: plan.execution_job_id || null,
    created_at: plan.created_date || null,
    updated_at: plan.updated_date || null,
  };
}

function jobSummary(job: any) {
  if (!job) return null;
  return {
    id: job.id,
    plan_id: job.plan_id,
    conversation_id: job.conversation_id || null,
    project_id: job.project_id || null,
    intent: job.intent,
    mode: job.mode,
    provider: job.provider,
    provider_model: job.provider_model || null,
    status: job.status,
    progress: Number(job.progress || 0),
    stage: clean(job.stage, 1000),
    artifact_id: job.artifact_id || null,
    usage_state: job.usage_state || "none",
    reserved_credits: Number(job.usage_reservation?.amount || 0),
    included_credits: Number(job.usage_reservation?.included_credits || 0),
    purchased_credits: Number(job.usage_reservation?.bonus_credits || 0),
    credits_captured: job.usage_state === "captured",
    credits_restored: job.usage_state === "released",
    error_message: clean(job.error_message, 1200) || null,
    started_at: job.started_at || null,
    completed_at: job.completed_at || null,
    poll_after: job.poll_after || null,
    created_at: job.created_date || null,
    updated_at: job.updated_date || null,
  };
}

function artifactSummary(artifact: any) {
  const hasPrivateFile = Boolean(clean(artifact?.file_uri, 2000));
  const hasPublicUrl = /^https:\/\//i.test(clean(artifact?.file_url, 4000));
  const contentLength = typeof artifact?.content === "string" ? artifact.content.length : 0;
  const expired = artifact?.expires_at
    ? Date.parse(String(artifact.expires_at)) < Date.now()
    : false;
  return {
    id: artifact.id,
    plan_id: artifact.plan_id,
    job_id: artifact.job_id,
    conversation_id: artifact.conversation_id || null,
    project_id: artifact.project_id || null,
    name: artifact.name,
    kind: artifact.kind,
    mime_type: artifact.mime_type,
    provider: artifact.provider,
    status: expired
      ? "expired"
      : hasPrivateFile || hasPublicUrl || contentLength > 0
        ? "available"
        : "recorded_without_output",
    has_private_file: hasPrivateFile,
    has_public_url: hasPublicUrl,
    has_content: contentLength > 0,
    content_length: contentLength,
    ephemeral: Boolean(artifact.ephemeral),
    expires_at: artifact.expires_at || null,
    created_at: artifact.created_date || null,
    updated_at: artifact.updated_date || null,
  };
}

async function latestJob(service: any, userId: string, plan: any) {
  if (plan?.execution_job_id) {
    try {
      const direct = await service.entities.GenerationJob.get(plan.execution_job_id);
      if (String(direct?.user_id) === String(userId) && String(direct?.plan_id) === String(plan.id)) {
        return direct;
      }
    } catch {
      // Fall back to the plan-scoped query.
    }
  }
  const jobs = await service.entities.GenerationJob.filter(
    { user_id: userId, plan_id: plan.id },
    "-created_date",
    1,
  );
  return jobs?.[0] || null;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const service = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const planId = clean(body?.plan_id, 200);
    const conversationId = clean(body?.conversation_id, 200);

    if (!planId && !conversationId) {
      return Response.json({
        error: "Provide plan_id or conversation_id.",
      }, { status: 400 });
    }

    let plan: any = null;
    if (planId) {
      try {
        const candidate = await service.entities.CreationPlan.get(planId);
        if (String(candidate?.user_id) === String(user.id)) plan = candidate;
      } catch {
        plan = null;
      }
    } else {
      const plans = await service.entities.CreationPlan.filter(
        { user_id: user.id, conversation_id: conversationId },
        "-created_date",
        1,
      );
      plan = plans?.[0] || null;
    }

    if (!plan) {
      return Response.json({ error: "Creation status not found." }, { status: 404 });
    }
    if (conversationId && planId && String(plan.conversation_id || "") !== conversationId) {
      return Response.json({ error: "Creation status not found." }, { status: 404 });
    }

    const currentCapability = getCreationCapabilities().find((item: any) => item.intent === String(plan.intent)) || null;
    const capabilityChanged = Boolean(
      currentCapability && (
        String(currentCapability.provider || "") !== String(plan.provider || "") ||
        Boolean(currentCapability.render_ready) !== Boolean(plan.render_ready) ||
        Boolean(currentCapability.provider_ready) !== Boolean(plan.provider_ready)
      )
    );
    const quoteStale = Boolean(String(plan.status) === "quoted" && capabilityChanged);

    const job = await latestJob(service, user.id, plan);
    const artifacts = await service.entities.CreationArtifact.filter(
      { user_id: user.id, plan_id: plan.id },
      "-created_date",
      20,
    );
    const artifactSummaries = (artifacts || []).map(artifactSummary);
    const primaryArtifact = job?.artifact_id
      ? artifactSummaries.find((item: any) => item.id === job.artifact_id) || artifactSummaries[0] || null
      : artifactSummaries[0] || null;

    const refreshable = Boolean(
      job?.id &&
      job?.provider === "luma-ray-3.2" &&
      ["queued", "running", "waiting_provider", "needs_setup"].includes(String(job.status)),
    );
    const privateArtifact = artifactSummaries.find((item: any) =>
      item.status === "available" && item.has_private_file
    ) || null;
    const builderProjectId = plan.project_id || job?.project_id || primaryArtifact?.project_id || null;

    let nextAction = "No further generation step is currently required.";
    if (quoteStale) nextAction = "Provider readiness changed after this quote was created. Request a new plan before approval so the provider, render mode, and price are recalculated.";
    else if (!job) nextAction = "The plan has not been executed in Studio.";
    else if (refreshable) nextAction = "Call refresh-generation-job with refresh_job_id to check the provider safely.";
    else if (job.status === "failed") nextAction = "Explain the recorded failure and offer to create a revised plan.";
    else if (job.status === "needs_setup") nextAction = "Explain the missing external setup without claiming completion.";
    else if (privateArtifact) nextAction = "Call get-artifact-access-url with access_artifact_id when the user wants to open the private file.";
    else if (builderProjectId) nextAction = "The generated project is ready to open in Builder.";

    return Response.json({
      ok: true,
      query: planId ? { plan_id: planId } : { conversation_id: conversationId },
      plan: planSummary(plan),
      job: jobSummary(job),
      artifact: primaryArtifact,
      artifacts: artifactSummaries,
      current_capability: currentCapability ? {
        id: currentCapability.id,
        provider: currentCapability.provider,
        provider_ready: Boolean(currentCapability.provider_ready),
        render_ready: Boolean(currentCapability.render_ready),
      } : null,
      quote_stale: quoteStale,
      continuation: {
        refreshable,
        refresh_job_id: refreshable ? job.id : null,
        has_private_artifact: Boolean(privateArtifact),
        access_artifact_id: privateArtifact?.id || null,
        builder_project_id: builderProjectId,
        next_action: nextAction,
      },
      privacy: {
        private_storage_uri_exposed: false,
        artifact_content_included: false,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error
      ? clean(error.message, 1000)
      : "Could not load creation status.";
    return Response.json({ error: message }, { status: 500 });
  }
});
