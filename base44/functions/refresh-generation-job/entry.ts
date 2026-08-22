import { createClientFromRequest } from "npm:@base44/sdk";
import {
  getLumaGeneration,
  getMediaReadiness,
  lumaVideoOutput,
  persistRemoteFile,
  requireUser,
} from "../../shared/creation.ts";

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

function billing() {
  return {
    charged: false,
    card_charged: false,
    credits_deducted: false,
    action: "none",
    note: "Refreshing a job never charges a card or deducts IABT credits.",
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

async function markComplete(service: any, job: any, artifact: any) {
  if (!artifact?.id || !clean(artifact.file_uri, 2000)) {
    throw new Error("A durable private media artifact is required before completion.");
  }
  const completedJob = await service.entities.GenerationJob.update(job.id, {
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

  const usage = await service.entities.UsageLedger.filter(
    { user_id: job.user_id, job_id: job.id, event_type: "included_usage" },
    "-created_date",
    1,
  );
  if (!usage?.length) {
    await service.entities.UsageLedger.create({
      user_id: job.user_id,
      user_email: job.user_email,
      plan_id: job.plan_id,
      job_id: job.id,
      event_type: "included_usage",
      unit: "generation",
      amount: 1,
      pricing_version: String(job.quote_snapshot?.pricing_version || "unknown"),
      description: "Completed approved video generation and private-file persistence. Usage metadata only; no IABT card charge or app-credit deduction was performed.",
      status: "settled",
      occurred_at: new Date().toISOString(),
    });
  }
  return completedJob;
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
    const jobId = clean(body?.job_id || body?.generation_job_id, 200);
    if (!jobId) return Response.json({ error: "job_id is required." }, { status: 400 });

    let job;
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
      if (!hasArtifactOutput(artifact) || (job.provider === "luma-ray-3.2" && !clean(artifact?.file_uri, 2000))) {
        job = await service.entities.GenerationJob.update(job.id, {
          status: "failed",
          progress: 100,
          stage: "Artifact integrity check failed",
          error_message: "The completed job has no durable private media artifact.",
          completed_at: new Date().toISOString(),
        });
        return Response.json({
          error: "The completed job has no durable media artifact.",
          job,
          artifact: null,
          complete: true,
          billing: billing(),
        }, { status: 409 });
      }
      return Response.json({ ok: true, job, artifact, complete: true, billing: billing() });
    }

    if (["failed", "canceled"].includes(String(job.status))) {
      return Response.json({
        ok: false,
        job,
        artifact: artifact || null,
        complete: true,
        billing: billing(),
      }, { status: 409 });
    }

    if (job.provider !== "luma-ray-3.2") {
      return Response.json({
        ok: true,
        job,
        artifact: artifact || null,
        complete: ["succeeded", "failed", "canceled"].includes(String(job.status)),
        billing: billing(),
      });
    }

    if (!job.provider_job_id) {
      job = await service.entities.GenerationJob.update(job.id, {
        status: "needs_setup",
        progress: 0,
        stage: "Provider job was not submitted",
        error_message: "No Luma generation ID exists for this job. Request a new creation plan.",
      });
      return Response.json({
        error: "This job has no provider generation ID. No video artifact exists.",
        job,
        artifact: null,
        complete: true,
        billing: billing(),
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
        billing: billing(),
      }, { status: 503 });
    }

    const generation = await getLumaGeneration(job.provider_job_id);
    const state = clean(generation?.state || generation?.status || "unknown", 100).toLowerCase();
    const failed = ["failed", "error", "canceled", "cancelled"].includes(state);
    const completed = ["completed", "complete", "succeeded", "success"].includes(state);

    if (failed) {
      const reason = clean(
        generation?.failure_reason || generation?.error?.message || generation?.message || "The video provider reported a failed render.",
        1000,
      );
      job = await service.entities.GenerationJob.update(job.id, {
        status: "failed",
        progress: 100,
        stage: "Video provider reported failure",
        error_message: reason,
        completed_at: new Date().toISOString(),
      });
      await service.entities.CreationPlan.update(job.plan_id, {
        status: "failed",
        execution_job_id: job.id,
      });
      return Response.json({
        ok: false,
        error: reason,
        job,
        artifact: null,
        complete: true,
        billing: billing(),
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
        billing: billing(),
      }, { status: 202 });
    }

    if (artifact?.id && clean(artifact.file_uri, 2000)) {
      job = await markComplete(service, job, artifact);
      return Response.json({
        ok: true,
        job,
        artifact,
        complete: true,
        result: { message: "The video is complete and stored as a private Base44 artifact." },
        billing: billing(),
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
        billing: billing(),
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
        billing: billing(),
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
    job = await markComplete(service, job, artifact);
    return Response.json({
      ok: true,
      job,
      artifact,
      complete: true,
      result: { message: "The Ray 3.2 MP4 is complete and stored as a private Base44 artifact." },
      billing: billing(),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? clean(error.message, 1000) : "Could not refresh the generation job.";
    return Response.json({ error: message, billing: billing() }, { status: 500 });
  }
});
