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
  quoteFor,
  requireUser,
  submitLumaVideo,
} from "../../shared/creation.ts";
import {
  captureJobCredits,
  releaseIabtCredits,
  releaseJobCredits,
  reserveIabtCredits,
} from "../../shared/usage.ts";

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

function billing(job: any = null) {
  const state = String(job?.usage_state || "none");
  const amount = Number(job?.usage_reservation?.amount || 0);
  return {
    charged: false,
    card_charged: false,
    credit_amount: amount,
    credits_reserved: ["reserved", "release_pending"].includes(state),
    credits_deducted: state === "captured",
    credits_released: state === "released",
    action:
      state === "captured" ? "credits_captured" :
      state === "released" ? "credits_released" :
      state === "reserved" ? "credits_reserved" :
      "none",
    note: amount
      ? "IABT credits cover the approved provider cost; no separate card charge is made during creation."
      : "No separate card charge was made during creation.",
  };
}

async function responseForExisting(base44: any, job: any, artifact: any) {
  const terminalFailure = ["failed", "canceled", "needs_setup"].includes(String(job.status));
  if (job.status === "succeeded" && job.usage_state === "reserved") {
    if (await captureJobCredits(base44, job, "Completed IABT creation; reserved credits captured.")) {
      job = { ...job, usage_state: "captured" };
    }
  } else if (terminalFailure && ["reserved", "release_failed"].includes(String(job.usage_state))) {
    try {
      if (await releaseJobCredits(base44, job, "Creation did not complete; reserved credits restored.")) {
        job = { ...job, usage_state: "released" };
      }
    } catch (error) {
      console.error("existing job credit release failed:", error);
      job = { ...job, usage_state: "release_failed" };
    }
  }

  const complete = ["succeeded", "failed", "canceled", "needs_setup"].includes(String(job.status));
  const ok = !["failed", "canceled", "needs_setup"].includes(String(job.status));
  return Response.json({
    ok,
    reused: true,
    job,
    artifact: artifact || null,
    complete,
    result: job.status === "succeeded"
      ? { message: "The previously approved execution is complete.", artifact_kind: artifact?.kind || null }
      : { message: "The previously approved execution was reused.", status: job.status },
    billing: billing(job),
  }, { status: ok ? 200 : 409 });
}

async function projectLimitFor(service: any, user: any) {
  const records = await service.entities.AccountEntitlement.filter(
    { user_id: user.id },
    "-updated_date",
    1,
  );
  const entitlement = records?.[0];
  if (user.role === "admin" && !entitlement) return 0;
  if (!entitlement || !["active", "trialing"].includes(String(entitlement.status))) return 1;
  const limit = Number(entitlement.project_limit);
  return Number.isInteger(limit) && limit >= 0 ? limit : 1;
}

async function enforceProjectCapacity(service: any, user: any) {
  const limit = await projectLimitFor(service, user);
  if (limit === 0) return;

  const byOwnerId = await service.entities.Project.filter(
    { user_id: user.id },
    "-created_date",
    Math.min(1000, limit + 10),
  );
  let byCreator: any[] = [];
  try {
    byCreator = await service.entities.Project.filter(
      { created_by: user.email },
      "-created_date",
      Math.min(1000, limit + 10),
    );
  } catch {
    // Explicit owner IDs cover all orchestrator-created projects.
  }
  const ids = new Set([...(byOwnerId || []), ...(byCreator || [])].map((project: any) => project.id));
  if (ids.size >= limit) {
    throw new Response(JSON.stringify({
      error: "Your current plan project limit has been reached.",
      code: "project_limit_reached",
      project_limit: limit,
      current_projects: ids.size,
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function saveGeneratedProject(service: any, user: any, plan: any, definition: any) {
  const values = {
    user_id: user.id,
    user_email: user.email,
    title: clean(definition?.app?.name || plan.title, 100) || "IABT Application",
    description: clean(definition?.app?.description || plan.request_text, 500),
    category: "Other",
    status: "ready",
    color: clean(definition?.theme?.primary, 20) || "#7c3aed",
    tags: ["IABT Generated", String(plan.intent || "app")].slice(0, 10),
    schema_version: clean(definition?.schemaVersion, 30) || "1.0",
    app_definition: definition,
    last_opened_at: new Date().toISOString(),
  };

  if (plan.project_id) {
    let current;
    try {
      current = await service.entities.Project.get(plan.project_id);
    } catch {
      current = null;
    }
    const ownsProject = current && (
      user.role === "admin" ||
      String(current.user_id || "") === String(user.id) ||
      String(current.created_by || "") === String(user.email)
    );
    if (!ownsProject) {
      throw new Response(JSON.stringify({ error: "The target project no longer exists or is not owned by this user." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return service.entities.Project.update(current.id, values);
  }

  await enforceProjectCapacity(service, user);
  return service.entities.Project.create(values);
}

Deno.serve(async (req) => {
  let base44: any = null;
  let service: any = null;
  let plan: any = null;
  let job: any = null;
  let creditReservation: any = null;
  let providerSubmission: any = null;
  let providerAccepted = false;
  let committedArtifact: any = null;

  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    base44 = createClientFromRequest(req);
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

    const currentQuote = quoteFor(String(plan.intent || "other"), plan.normalized_spec || {});
    const capabilityChanged = Boolean(
      String(currentQuote?.capability?.provider || "") !== String(plan.provider || "") ||
      Boolean(currentQuote?.capability?.render_ready) !== Boolean(plan.render_ready) ||
      Boolean(currentQuote?.capability?.provider_ready) !== Boolean(plan.provider_ready) ||
      Number(currentQuote?.total_estimated_cost_cents || 0) !== Number(plan.total_estimated_cost_cents || 0) ||
      Number(currentQuote?.credit_cost || 1) !== Number(plan.credit_cost || 1)
    );
    if (capabilityChanged) {
      return Response.json({
        error: "Provider readiness or pricing changed after this quote was created. Request a new plan before approving execution.",
        code: "quote_stale",
      }, { status: 409 });
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
        return await responseForExisting(base44, failed, null);
      }
      return await responseForExisting(base44, existing, artifact);
    }

    if (String(plan.status) === "expired") {
      return Response.json({ error: "This quote expired. Request a new plan before execution." }, { status: 410 });
    }
    if (String(plan.status) !== "quoted") {
      return Response.json({
        error: "This creation plan is no longer eligible for a new execution. Request a new plan.",
        status: plan.status,
      }, { status: 409 });
    }
    const expiresAt = Date.parse(String(plan.quote_expires_at || ""));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      await service.entities.CreationPlan.update(plan.id, { status: "expired" });
      return Response.json({ error: "This quote expired. Request a new plan before execution." }, { status: 410 });
    }
    if (Array.isArray(plan.clarification_questions) && plan.clarification_questions.length > 0) {
      return Response.json({
        error: "This plan still needs required information before it can be approved.",
        clarification_questions: plan.clarification_questions,
      }, { status: 422 });
    }

    const paidMedia = plan.provider === "luma-ray-3.2" &&
      Number(plan.provider_cost_cents || 0) > 0;
    const credit = await reserveIabtCredits(
      base44,
      user,
      Number(plan.credit_cost || 1),
      { usageKind: "content_generation", paidMedia },
    );
    creditReservation = credit.reservation;

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
      billing_action: "reserve_iabt_credits",
      credit_cost: Number(plan.credit_cost || 1),
      card_charged: false,
      credits_reserved: true,
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
      usage_state: "reserved",
      usage_reservation: creditReservation,
      started_at: now,
    });

    const lock = await service.entities.CreationPlan.updateMany(
      { id: plan.id, status: "quoted" },
      {
        $set: {
          status: "approved",
          approved_at: now,
          execution_job_id: job.id,
        },
      },
    );
    if (Number(lock?.updated || 0) !== 1) {
      const lockedPlan = await service.entities.CreationPlan.get(plan.id);
      const canonicalJobId = clean(lockedPlan?.execution_job_id, 200);
      job = await service.entities.GenerationJob.update(job.id, {
        status: "canceled",
        progress: 100,
        stage: "Duplicate execution suppressed",
        error_message: "A prior execution already owns this approved plan.",
        completed_at: new Date().toISOString(),
      });
      try {
        if (await releaseJobCredits(base44, job, "Duplicate execution suppressed; reserved credits restored.")) {
          job = { ...job, usage_state: "released" };
        }
      } catch (releaseError) {
        console.error("duplicate job credit release failed:", releaseError);
        job = { ...job, usage_state: "release_failed" };
      }
      if (canonicalJobId && canonicalJobId !== job.id) {
        const canonicalJob = await service.entities.GenerationJob.get(canonicalJobId);
        return await responseForExisting(
          base44,
          canonicalJob,
          await loadArtifact(service, canonicalJob),
        );
      }
      return Response.json({
        error: "This plan is already executing or is no longer eligible for execution.",
        job,
        billing: billing(job),
      }, { status: 409 });
    }

    await service.entities.UsageLedger.create({
      user_id: user.id,
      user_email: user.email,
      plan_id: plan.id,
      job_id: job.id,
      event_type: "reserve",
      unit: "media_credit",
      amount: Number(creditReservation.amount || 0),
      pricing_version: plan.pricing_version,
      description: "Reserved IABT credits for an approved creation. Execution key: " + key,
      status: "pending",
      occurred_at: now,
    });

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
        acceptance_text: "User explicitly approved the exact server-owned quote and authorized the listed IABT credit reservation. No separate card charge is made during creation.",
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
      const project = await saveGeneratedProject(service, user, plan, definition);
      plan = await service.entities.CreationPlan.update(plan.id, {
        status: "executing",
        project_id: project.id,
        execution_job_id: job.id,
      });
      job = await service.entities.GenerationJob.update(job.id, {
        project_id: project.id,
        stage: "Project created; securing AppDefinition artifact",
        progress: 90,
      });
      return await finish({
        name: clean(plan.title, 160) + " — AppDefinition.json",
        kind: "app",
        mime_type: "application/vnd.iabt+json",
        content: JSON.stringify(definition, null, 2),
        provider: "base44-managed-ai",
        metadata: {
          schema_version: definition.schemaVersion,
          page_count: definition.pages.length,
          project_id: project.id,
          builder_ready: true,
        },
      }, "IABT created a Builder-ready project and an importable AppDefinition artifact.");
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
