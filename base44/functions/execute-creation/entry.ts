import { createClientFromRequest } from "npm:@base44/sdk";
import {
  CREATION_PRICING_VERSION,
  LUMA_MODEL,
  executionKey,
  generateAppDefinition,
  generateCodeBundle,
  generateGCodeDraft,
  generateImage,
  generateTextDeliverable,
  getMediaReadiness,
  requireUser,
  submitLumaVideo,
} from "../../shared/creation.ts";

function clean(value: unknown, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function hasArtifactOutput(artifact: any) {
  return Boolean(
    clean(artifact?.file_uri, 2000) ||
    clean(artifact?.file_url, 4000) ||
    (typeof artifact?.content === "string" && artifact.content.trim().length > 0),
  );
}

function artifactBase(user: any, plan: any, job: any, key: string) {
  return {
    user_id: user.id,
    user_email: user.email,
    plan_id: plan.id,
    job_id: job.id,
    ...(plan.conversation_id ? { conversation_id: plan.conversation_id } : {}),
    ...(plan.project_id ? { project_id: plan.project_id } : {}),
    metadata: {
      execution_key: key,
      source_intent: plan.intent,
      plan_title: plan.title,
      created_by: "iabt-orchestrator",
    },
    ephemeral: false,
  };
}

async function loadArtifact(service: any, job: any) {
  if (job?.artifact_id) {
    try {
      return await service.entities.CreationArtifact.get(job.artifact_id);
    } catch {
      // Fall through to the ownership-scoped job lookup.
    }
  }
  const records = await service.entities.CreationArtifact.filter(
    { user_id: job.user_id, job_id: job.id },
    "-created_date",
    1,
  );
  return records?.[0] || null;
}

function billing() {
  return {
    charged: false,
    card_charged: false,
    credits_deducted: false,
    action: "none",
    note: "IABT recorded approval and usage metadata only. It did not charge a card or deduct app credits.",
  };
}

function responseForExisting(job: any, artifact: any) {
  const complete = ["succeeded", "failed", "canceled", "needs_setup"].includes(String(job.status));
  return Response.json({
    ok: job.status !== "failed",
    reused: true,
    job,
    artifact: artifact || null,
    complete,
    result: job.status === "succeeded"
      ? { message: "The previously approved execution is complete.", artifact_kind: artifact?.kind || null }
      : { message: "The previously approved execution was reused.", status: job.status },
    billing: billing(),
  }, { status: job.status === "failed" ? 409 : 200 });
}

Deno.serve(async (req) => {
  let service: any = null;
  let plan: any = null;
  let job: any = null;

  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    service = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const planId = clean(body?.plan_id, 200);

    if (!planId) return Response.json({ error: "plan_id is required." }, { status: 400 });
    if (body?.approved !== true) {
      return Response.json({
        error: "Explicit approval is required. Review the plan and exact quote, then submit approved: true.",
      }, { status: 400 });
    }

    try {
      plan = await service.entities.CreationPlan.get(planId);
    } catch {
      plan = null;
    }
    if (!plan || String(plan.user_id) !== String(user.id)) {
      return Response.json({ error: "Creation plan not found." }, { status: 404 });
    }

    const acceptedTotal = Number(body?.accepted_total_cents);
    const acceptedPricing = clean(body?.pricing_version, 200);
    if (!Number.isInteger(acceptedTotal) || acceptedTotal < 0) {
      return Response.json({ error: "accepted_total_cents must exactly match the quoted integer amount." }, { status: 400 });
    }
    if (
      acceptedPricing !== String(plan.pricing_version) ||
      acceptedPricing !== CREATION_PRICING_VERSION ||
      acceptedTotal !== Number(plan.total_estimated_cost_cents)
    ) {
      return Response.json({
        error: "The approval does not match the server-owned quote. Request a new plan and review its exact pricing.",
      }, { status: 409 });
    }

    const mode = plan.render_ready ? "render" : "prepare";
    const key = executionKey(user.id, plan.id, mode);
    const existingJobs = await service.entities.GenerationJob.filter(
      { user_id: user.id, plan_id: plan.id, mode },
      "created_date",
      10,
    );
    const existing = (existingJobs || []).find((record: any) =>
      String(record?.quote_snapshot?.execution_key || "") === key
    ) || existingJobs?.[0];

    if (existing) {
      const artifact = await loadArtifact(service, existing);
      if (existing.status === "succeeded" && !hasArtifactOutput(artifact)) {
        const failed = await service.entities.GenerationJob.update(existing.id, {
          status: "failed",
          progress: 100,
          stage: "Artifact integrity check failed",
          error_message: "The execution record had no durable output artifact.",
          completed_at: new Date().toISOString(),
        });
        return Response.json({
          error: "The prior execution did not produce a durable artifact.",
          reused: true,
          job: failed,
          artifact: null,
          billing: billing(),
        }, { status: 409 });
      }
      return responseForExisting(existing, artifact);
    }

    if (["canceled", "expired"].includes(String(plan.status))) {
      return Response.json({ error: "This creation plan can no longer be executed. Request a new plan." }, { status: 409 });
    }
    const expiresAt = Date.parse(String(plan.quote_expires_at || ""));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      await service.entities.CreationPlan.update(plan.id, { status: "expired" });
      return Response.json({ error: "This quote expired. Request a new plan before execution." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const quoteSnapshot = {
      execution_key: key,
      client_idempotency_key: clean(body?.idempotency_key, 200) || null,
      pricing_version: plan.pricing_version,
      provider_cost_cents: Number(plan.provider_cost_cents || 0),
      platform_fee_cents: Number(plan.platform_fee_cents || 0),
      total_estimated_cost_cents: Number(plan.total_estimated_cost_cents || 0),
      currency: plan.currency,
      quote_expires_at: plan.quote_expires_at,
      approved_at: now,
      billing_action: "none",
      card_charged: false,
      credits_deducted: false,
    };

    job = await service.entities.GenerationJob.create({
      user_id: user.id,
      user_email: user.email,
      plan_id: plan.id,
      ...(plan.conversation_id ? { conversation_id: plan.conversation_id } : {}),
      ...(plan.project_id ? { project_id: plan.project_id } : {}),
      intent: plan.intent,
      mode,
      provider: plan.provider,
      ...(plan.provider === "luma-ray-3.2" ? { provider_model: LUMA_MODEL } : {}),
      status: "running",
      progress: 5,
      stage: "Approval recorded; starting generation",
      input_spec: plan.normalized_spec,
      quote_snapshot: quoteSnapshot,
      started_at: now,
    });

    const concurrentJobs = await service.entities.GenerationJob.filter(
      { user_id: user.id, plan_id: plan.id, mode },
      "created_date",
      10,
    );
    const canonicalJob = (concurrentJobs || []).find((record: any) =>
      String(record?.quote_snapshot?.execution_key || "") === key
    );
    if (canonicalJob && canonicalJob.id !== job.id) {
      job = await service.entities.GenerationJob.update(job.id, {
        status: "canceled",
        progress: 100,
        stage: "Duplicate execution suppressed",
        error_message: "A prior execution already owns this approved plan.",
        completed_at: new Date().toISOString(),
      });
      return responseForExisting(canonicalJob, await loadArtifact(service, canonicalJob));
    }

    const priorConsents = await service.entities.ConsentGrant.filter(
      { user_id: user.id, plan_id: plan.id, mode },
      "created_date",
      1,
    );
    if (!priorConsents?.length) {
      await service.entities.ConsentGrant.create({
        user_id: user.id,
        user_email: user.email,
        plan_id: plan.id,
        job_id: job.id,
        mode,
        pricing_version: plan.pricing_version,
        accepted_total_cents: acceptedTotal,
        currency: plan.currency,
        acceptance_text: "User explicitly approved the exact server-owned quote. No IABT card charge or app-credit deduction was authorized or performed.",
        accepted_at: now,
      });
    }

    await service.entities.CreationPlan.update(plan.id, {
      status: "executing",
      approved_at: now,
      execution_job_id: job.id,
    });

    const finish = async (artifactData: any, message: string) => {
      const payload = {
        ...artifactBase(user, plan, job, key),
        ...artifactData,
        metadata: {
          ...artifactBase(user, plan, job, key).metadata,
          ...(artifactData.metadata || {}),
        },
      };
      if (!hasArtifactOutput(payload)) {
        throw new Error("Generation returned no durable artifact output.");
      }

      const artifact = await service.entities.CreationArtifact.create(payload);
      if (!artifact?.id || !hasArtifactOutput(artifact)) {
        throw new Error("The artifact could not be persisted safely.");
      }

      job = await service.entities.GenerationJob.update(job.id, {
        status: "succeeded",
        progress: 100,
        stage: "Artifact created",
        artifact_id: artifact.id,
        completed_at: new Date().toISOString(),
        error_message: "",
      });
      plan = await service.entities.CreationPlan.update(plan.id, {
        status: "completed",
        execution_job_id: job.id,
      });
      await service.entities.UsageLedger.create({
        user_id: user.id,
        user_email: user.email,
        plan_id: plan.id,
        job_id: job.id,
        event_type: "included_usage",
        unit: "generation",
        amount: 1,
        pricing_version: plan.pricing_version,
        description: "Completed approved IABT generation. Usage metadata only; no card charge or app-credit deduction was performed. Execution key: " + key,
        status: "settled",
        occurred_at: new Date().toISOString(),
      });
      return Response.json({
        ok: true,
        reused: false,
        plan,
        job,
        artifact,
        complete: true,
        result: { message, artifact_kind: artifact.kind },
        billing: billing(),
      });
    };

    if (plan.intent === "app" || plan.intent === "website") {
      const definition = await generateAppDefinition(base44, plan.request_text, plan.normalized_spec);
      return await finish({
        name: clean(plan.title, 160) + " — AppDefinition.json",
        kind: "app",
        mime_type: "application/vnd.iabt+json",
        content: JSON.stringify(definition, null, 2),
        provider: "base44-managed-ai",
        metadata: { schema_version: definition.schemaVersion, page_count: definition.pages.length },
      }, "IABT created an importable AppDefinition with pages and the requested application blueprint.");
    }

    if (plan.intent === "image" || plan.intent === "design") {
      try {
        const generated = await generateImage(base44, plan.normalized_spec?.creative_prompt || plan.request_text);
        return await finish({
          name: clean(plan.title, 160) + ".png",
          kind: "image",
          mime_type: "image/png",
          file_url: generated.url,
          provider: "base44-core-image",
          metadata: { prompt: clean(plan.normalized_spec?.creative_prompt || plan.request_text, 6000) },
        }, "IABT rendered the requested image.");
      } catch (imageError) {
        const content = await generateTextDeliverable(base44, plan.request_text, plan.normalized_spec, "design");
        return await finish({
          name: clean(plan.title, 160) + " — visual production brief.md",
          kind: "document",
          mime_type: "text/markdown",
          content,
          provider: "iabt-preproduction",
          metadata: {
            requested_kind: plan.intent,
            rendered: false,
            fallback_reason: imageError instanceof Error ? clean(imageError.message, 500) : "Image provider unavailable",
          },
        }, "The image renderer was unavailable, so IABT created a clearly labeled visual production brief instead.");
      }
    }

    if (plan.intent === "video") {
      if (plan.provider === "luma-ray-3.2") {
        if (!getMediaReadiness().luma_ready) {
          job = await service.entities.GenerationJob.update(job.id, {
            status: "needs_setup",
            progress: 0,
            stage: "Paid video provider setup required",
            error_message: "Luma rendering requires LUMA_AGENTS_API_KEY plus both paid-media safety gates.",
            completed_at: new Date().toISOString(),
          });
          plan = await service.entities.CreationPlan.update(plan.id, {
            status: "failed",
            execution_job_id: job.id,
          });
          return Response.json({
            error: "Paid video rendering is not currently configured. No provider request was sent.",
            plan,
            job,
            artifact: null,
            complete: true,
            billing: billing(),
          }, { status: 409 });
        }

        const submission = await submitLumaVideo(plan.normalized_spec);
        job = await service.entities.GenerationJob.update(job.id, {
          status: "waiting_provider",
          progress: 10,
          stage: "Ray 3.2 render submitted",
          provider_model: LUMA_MODEL,
          provider_job_id: submission.generation.id,
          poll_after: new Date(Date.now() + 30_000).toISOString(),
        });
        return Response.json({
          ok: true,
          reused: false,
          plan,
          job,
          artifact: null,
          complete: false,
          result: {
            message: "The approved Ray 3.2 render was submitted. It is not complete until the MP4 is copied into private Base44 storage.",
            provider_status: submission.generation.state || submission.generation.status || "submitted",
          },
          billing: billing(),
        }, { status: 202 });
      }

      const content = await generateTextDeliverable(base44, plan.request_text, plan.normalized_spec, "video");
      return await finish({
        name: clean(plan.title, 160) + " — video preproduction.md",
        kind: "document",
        mime_type: "text/markdown",
        content,
        provider: "iabt-preproduction",
        metadata: { requested_kind: "video", rendered: false },
      }, "IABT created detailed video preproduction. No MP4 was rendered or claimed.");
    }

    if (plan.intent === "audio") {
      const content = await generateTextDeliverable(base44, plan.request_text, plan.normalized_spec, "audio");
      return await finish({
        name: clean(plan.title, 160) + " — audio preproduction.md",
        kind: "document",
        mime_type: "text/markdown",
        content,
        provider: "iabt-preproduction",
        metadata: { requested_kind: "audio", rendered: false },
      }, "IABT created a detailed audio production package. No audio file was rendered or claimed.");
    }

    if (plan.intent === "code" || plan.intent === "automation") {
      const bundle = await generateCodeBundle(base44, plan.request_text, plan.normalized_spec);
      return await finish({
        name: clean(plan.title, 160) + " — source bundle.json",
        kind: "code",
        mime_type: "application/json",
        content: JSON.stringify(bundle, null, 2),
        provider: "base44-managed-ai",
        metadata: { language: bundle.language, file_count: bundle.files.length },
      }, "IABT created a structured source-code bundle with setup and verification instructions.");
    }

    if (plan.intent === "gcode") {
      const content = await generateGCodeDraft(base44, plan.request_text, plan.normalized_spec);
      return await finish({
        name: clean(plan.title, 160) + " — simulation-first.nc",
        kind: "gcode",
        mime_type: "text/x.gcode",
        content,
        provider: "base44-managed-ai",
        metadata: { production_ready: false, simulation_required: true },
      }, "IABT created a simulation-first G-code draft. It is not machine-ready.");
    }

    const content = await generateTextDeliverable(base44, plan.request_text, plan.normalized_spec, plan.intent);
    return await finish({
      name: clean(plan.title, 160) + ".md",
      kind: "document",
      mime_type: "text/markdown",
      content,
      provider: "base44-managed-ai",
      metadata: { requested_kind: plan.intent },
    }, "IABT created the requested detailed deliverable.");
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? clean(error.message, 1000) : "Creation failed.";
    if (service && job?.id) {
      try {
        job = await service.entities.GenerationJob.update(job.id, {
          status: "failed",
          progress: 100,
          stage: "Generation failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        });
      } catch {
        // Preserve the original generation error.
      }
    }
    if (service && plan?.id) {
      try {
        await service.entities.CreationPlan.update(plan.id, {
          status: "failed",
          ...(job?.id ? { execution_job_id: job.id } : {}),
        });
      } catch {
        // Preserve the original generation error.
      }
    }
    return Response.json({
      error: message,
      ...(job ? { job } : {}),
      billing: billing(),
    }, { status: 500 });
  }
});
