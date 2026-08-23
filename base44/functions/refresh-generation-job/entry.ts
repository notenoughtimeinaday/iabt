import { createClientFromRequest } from "npm:@base44/sdk";
import {
  getLumaGeneration,
  getMediaReadiness,
  lumaVideoOutput,
  persistRemoteFile,
  requireUser,
} from "../../shared/creation.ts";
import {
  captureJobCredits,
  releaseJobCredits,
} from "../../shared/usage.ts";

function clean(value: unknown, max = 600) {
  return String(value || "").trim().slice(0, max);
}

function hasArtifactOutput(artifact: any) {
  return Boolean(
    clean(artifact?.file_uri, 2000) ||
    clean(artifact?.file_url, 4000) ||
    (typeof artifact?.content === "string" && artifact.content.trim().length > 0),
  );
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
      ? "Refreshing does not charge a card; it only reconciles the existing IABT credit reservation."
      : "Refreshing a job never charges a card.",
  };
}

async function loadArtifact(service: any, job: any) {
  if (job?.artifact_id) {
    try {
      return await service.entities.CreationArtifact.get(job.artifact_id);
    } catch {
      // Fall through to the job-scoped lookup.
    }
  }
  const records = await service.entities.CreationArtifact.filter(
    { user_id: job.user_id, job_id: job.id },
    "-created_date",
    5,
  );
  return (records || []).find(hasArtifactOutput) || null;
}

async function markComplete(base44: any, service: any, job: any, artifact: any) {
  if (!artifact?.id || !clean(artifact.file_uri, 2000)) {
    throw new Error("A durable private media artifact is required before completion.");
  }
  let completedJob = await service.entities.GenerationJob.update(job.id, {
    status: "succeeded",
    progress: 100,
    stage: "Video secured in private storage",
    artifact_id: artifact.id,
    completed_at: new Date().toISOString(),
    error_message: "",
  });
  await service.entities.CreationPlan.update(job.plan_id, {
    status: "completed",
    execution_job_id: job.id,
  });
  if (await captureJobCredits(
    base44,
    completedJob,
    "Video completed and was secured in private Base44 storage; reserved credits captured.",
  )) {
    completedJob = { ...completedJob, usage_state: "captured" };
  }
  return completedJob;
}

async function restoreJobCredits(base44: any, job: any, description: string) {
  if (!["reserved", "release_failed"].includes(String(job?.usage_state || ""))) return job;
  try {
    if (await releaseJobCredits(base44, job, description)) {
      return { ...job, usage_state: "released" };
    }
    return job;
  } catch (error) {
    console.error("generation job credit restoration failed:", error);
    return { ...job, usage_state: "release_failed" };
  }
}

Deno.serve(async (req) => {
  let base44: any = null;
  let service: any = null;
  let job: any = null;

  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    service = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const jobId = clean(body?.job_id || body?.generation_job_id, 200);
    if (!jobId) return Response.json({ error: "job_id is required." }, { status: 400 });

    try {
      job = await service.entities.GenerationJob.get(jobId);
    } catch {
      job = null;
    }
    if (!job || String(job.user_id) !== String(user.id)) {
      return Response.json({ error: "Generation job not found." }, { status: 404 });
    }

    let artifact = await loadArtifact(service, job);
    if (job.status === "succeeded") {
      const invalidArtifact = !hasArtifactOutput(artifact) ||
        (job.provider === "luma-ray-3.2" && !clean(artifact?.file_uri, 2000));
      if (invalidArtifact && job.provider === "luma-ray-3.2" && job.provider_job_id) {
        job = await service.entities.GenerationJob.update(job.id, {
          status: "waiting_provider",
          progress: 95,
          stage: "Recovering durable video artifact",
          error_message: "The provider render completed, but the private artifact must be recovered.",
          poll_after: new Date().toISOString(),
        });
      } else if (invalidArtifact) {
        job = await service.entities.GenerationJob.update(job.id, {
          status: "failed",
          progress: 100,
          stage: "Artifact integrity check failed",
          error_message: "The completed job has no durable output artifact.",
          completed_at: new Date().toISOString(),
        });
        job = await restoreJobCredits(
          base44,
          job,
          "No durable artifact existed; reserved credits restored.",
        );
        return Response.json({
          error: "The completed job has no durable artifact.",
          job,
          artifact: null,
          complete: true,
          billing: billing(job),
        }, { status: 409 });
      } else {
        if (job.usage_state === "reserved" && await captureJobCredits(
          base44,
          job,
          "Existing durable artifact verified; reserved credits captured.",
        )) {
          job = { ...job, usage_state: "captured" };
        }
        return Response.json({ ok: true, job, artifact, complete: true, billing: billing(job) });
      }
    }

    if (["failed", "canceled"].includes(String(job.status))) {
      job = await restoreJobCredits(
        base44,
        job,
        "Terminal generation job produced no durable artifact; reserved credits restored.",
      );
      return Response.json({
        ok: false,
        job,
        artifact: artifact || null,
        complete: true,
        billing: billing(job),
      }, { status: 409 });
    }

    if (job.provider !== "luma-ray-3.2") {
      return Response.json({
        ok: true,
        job,
        artifact: artifact || null,
        complete: ["succeeded", "failed", "canceled"].includes(String(job.status)),
        billing: billing(job),
      });
    }

    if (!job.provider_job_id) {
      job = await service.entities.GenerationJob.update(job.id, {
        status: "needs_setup",
        progress: 0,
        stage: "Provider job was not submitted",
        error_message: "No Luma generation ID exists for this job. Request a new creation plan.",
      });
      job = await restoreJobCredits(
        base44,
        job,
        "No provider job was submitted; reserved credits restored.",
      );
      return Response.json({
        error: "This job has no provider generation ID. No video artifact exists.",
        job,
        artifact: null,
        complete: true,
        billing: billing(job),
      }, { status: 409 });
    }

    if (!getMediaReadiness().luma_key_configured) {
      job = await service.entities.GenerationJob.update(job.id, {
        status: "needs_setup",
        stage: "Luma credential required to retrieve the render",
        error_message: "LUMA_AGENTS_API_KEY is not configured. The provider job cannot be checked or copied yet.",
        poll_after: new Date(Date.now() + 60_000).toISOString(),
      });
      return Response.json({
        error: "Luma credentials are required to refresh this render. No artifact is being claimed.",
        job,
        artifact: null,
        complete: false,
        billing: billing(job),
      }, { status: 503 });
    }

    const generation = await getLumaGeneration(job.provider_job_id);
    const state = clean(generation?.state || generation?.status || "unknown", 100).toLowerCase();
    const failed = ["failed", "error", "canceled", "cancelled"].includes(state);
    const completed = ["completed", "complete", "succeeded", "success"].includes(state);

    if (failed) {
      const failureCode = clean(
        generation?.failure_code || generation?.error?.code,
        200,
      );
      const reason = clean(
        generation?.failure_reason ||
        generation?.error?.message ||
        generation?.message ||
        "The video provider reported a failed render.",
        1000,
      );
      const providerFailure = failureCode ? failureCode + ": " + reason : reason;
      job = await service.entities.GenerationJob.update(job.id, {
        status: "failed",
        progress: 100,
        stage: "Video provider reported failure",
        error_message: providerFailure,
        completed_at: new Date().toISOString(),
      });
      job = await restoreJobCredits(
        base44,
        job,
        "The video provider reported a failed render; reserved credits restored.",
      );
      await service.entities.CreationPlan.update(job.plan_id, {
        status: "failed",
        execution_job_id: job.id,
      });
      return Response.json({
        ok: false,
        error: providerFailure,
        ...(failureCode ? { code: failureCode } : {}),
        job,
        artifact: null,
        complete: true,
        billing: billing(job),
      }, { status: 502 });
    }

    if (!completed) {
      const rawProgress = Number(generation?.progress);
      const progress = Number.isFinite(rawProgress)
        ? Math.max(10, Math.min(95, Math.round(rawProgress <= 1 ? rawProgress * 100 : rawProgress)))
        : Math.max(10, Number(job.progress || 10));
      job = await service.entities.GenerationJob.update(job.id, {
        status: "waiting_provider",
        progress,
        stage: "Ray 3.2 render in progress",
        error_message: "",
        poll_after: new Date(Date.now() + 30_000).toISOString(),
      });
      return Response.json({
        ok: true,
        job,
        artifact: null,
        complete: false,
        provider_status: state,
        billing: billing(job),
      }, { status: 202 });
    }

    if (artifact?.id && clean(artifact.file_uri, 2000)) {
      job = await markComplete(base44, service, job, artifact);
      return Response.json({
        ok: true,
        job,
        artifact,
        complete: true,
        result: { message: "The video is complete and stored as a private Base44 artifact." },
        billing: billing(job),
      });
    }

    const output = lumaVideoOutput(generation);
    if (!output?.url) {
      job = await service.entities.GenerationJob.update(job.id, {
        status: "waiting_provider",
        progress: 95,
        stage: "Render complete; waiting for downloadable MP4",
        error_message: "The provider reported completion but has not supplied a downloadable video file.",
        poll_after: new Date(Date.now() + 20_000).toISOString(),
      });
      return Response.json({
        ok: true,
        job,
        artifact: null,
        complete: false,
        provider_status: state,
        billing: billing(job),
      }, { status: 202 });
    }

    let stored;
    try {
      const filename = "iabt-video-" + clean(job.id, 80).replace(/[^a-zA-Z0-9_-]/g, "-") + ".mp4";
      stored = await persistRemoteFile(base44, output.url, filename, "video/mp4");
    } catch (copyError) {
      const detail = copyError instanceof Error ? clean(copyError.message, 700) : "Secure media copy failed.";
      job = await service.entities.GenerationJob.update(job.id, {
        status: "waiting_provider",
        progress: 96,
        stage: "Render complete; secure copy pending",
        error_message: detail,
        poll_after: new Date(Date.now() + 20_000).toISOString(),
      });
      return Response.json({
        ok: true,
        job,
        artifact: null,
        complete: false,
        provider_status: state,
        message: "The provider render is complete, but IABT has not yet secured the MP4. Success is not being claimed.",
        billing: billing(job),
      }, { status: 202 });
    }

    if (!stored?.file_uri) throw new Error("Private storage returned no durable file URI.");
    artifact = await service.entities.CreationArtifact.create({
      user_id: user.id,
      user_email: user.email,
      plan_id: job.plan_id,
      job_id: job.id,
      ...(job.conversation_id ? { conversation_id: job.conversation_id } : {}),
      ...(job.project_id ? { project_id: job.project_id } : {}),
      name: "IABT Ray 3.2 video.mp4",
      kind: "video",
      mime_type: stored.mime_type || "video/mp4",
      file_uri: stored.file_uri,
      metadata: {
        execution_key: job.quote_snapshot?.execution_key || null,
        provider_job_id: job.provider_job_id,
        provider_model: job.provider_model || "ray-3.2",
        resolution: job.input_spec?.resolution || null,
        duration_seconds: Number(job.input_spec?.duration_seconds || 0) || null,
        aspect_ratio: job.input_spec?.aspect_ratio || null,
        pricing_version: job.quote_snapshot?.pricing_version || null,
        persisted_to_private_storage: true,
        size_bytes: stored.size_bytes,
      },
      provider: "luma-ray-3.2",
      ephemeral: false,
    });

    if (!artifact?.id || !clean(artifact.file_uri, 2000)) {
      throw new Error("The video artifact could not be persisted safely.");
    }
    job = await markComplete(base44, service, job, artifact);
    return Response.json({
      ok: true,
      job,
      artifact,
      complete: true,
      result: { message: "The Ray 3.2 MP4 is complete and stored as a private Base44 artifact." },
      billing: billing(job),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? clean(error.message, 1000) : "Could not refresh the generation job.";
    return Response.json({ error: message, billing: billing(job) }, { status: 500 });
  }
});
