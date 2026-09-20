import { createHash } from "node:crypto";
import {
  buildDocumentArtifacts,
  buildInteractiveArtifacts
} from "./creation/app-packager.js";
import {
  buildAutomationArtifacts,
  buildCodeArtifacts,
  buildDesignArtifacts,
  buildGcodeSimulationArtifacts
} from "./creation/specialized-artifacts.js";
import { readTextSources } from "./files/text-sources.js";
import { buildSourceReviewArtifacts } from "./creation/source-review.js";
import { orchestrationStep } from "./autonomy/orchestrator.js";
import { classifyFailure } from "./autonomy/recovery.js";
import { recordExecutionLesson } from "./learning/service.js";

const safeFilename = (value, fallback) => {
  const cleaned = String(value || "")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
};

const artifactObjectId = (jobId, index, digest) => {
  const hex = createHash("sha256").update(jobId + ":" + index + ":" + digest).digest("hex");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-5" + hex.slice(13, 16) + "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
};

// Terminal evidence is a projection. A failed learning write must never repeat
// an operation or reverse a committed artifact/credit transition.
const rememberOutcome = async (repository, job) => {
  try {
    const user = await repository.getUser(job.owner_id);
    if (user) await recordExecutionLesson({ repository, user, job });
  } catch {
    console.error({ code: "execution_learning_sync_failed", job_id: job.id });
  }
};

const internalFallbackJob = (job) => ({
  ...job,
  job_type: ({ app: "creation.interactive", website: "creation.interactive", document: "creation.document", code: "creation.code", design: "creation.design" })[job.input.intent] || "creation.document"
});

const checkpointOutput = async (repository, job, workerId, outputPatch) => {
  await repository.checkpointJob({ jobId: job.id, workerId, outputPatch });
  job.output = { ...job.output, ...outputPatch };
};

const failureContract = (error, { willRetry = false } = {}) => {
  const code = String(error?.code || "job_failed");
  const configuration =
    code.includes("not_configured") ||
    code.includes("approval_required") ||
    code.includes("cost_ceiling") ||
    code.includes("authentication_failed") ||
    code.includes("access_denied");
  return {
    code,
    category: configuration ? "configuration" : "execution",
    needsSetup: configuration,
    safeMessage:
      code === "provider_outcome_unknown"
        ? "A previous worker stopped before the provider result was recorded. IABT did not resubmit the paid request. Reserved IABT credits were restored; the provider outcome needs administrator reconciliation."
        : willRetry
        ? "This attempt did not produce a verified durable output. The job is queued within its approved retry budget; reserved IABT credits remain held."
        : configuration
        ? "IABT detected a provider or configuration requirement that needs administrator setup."
        : "IABT could not verify a durable output for this job. Reserved credits were restored.",
    details: {
      retryable: Boolean(error?.retryable),
      provider_request_id: String(error?.providerRequestId || "")
    }
  };
};

const providerTask = (job) => {
  if (job.job_type === "provider.openai.response") {
    return { provider: "openai", operation: "response", kind: "data" };
  }
  if (job.job_type === "provider.openai.image") {
    return { provider: "openai", operation: "generate_image", kind: "image" };
  }
  if (job.job_type === "provider.elevenlabs.music") {
    return { provider: "elevenlabs", operation: "compose_music", kind: "audio" };
  }
  return null;
};

const resultFor = async (job, providers) => {
  if (job.job_type === "artifact.echo") {
    return {
      metadata: { deterministic: true, artifact_count: 1 },
      artifacts: [{
        bytes: Buffer.from(String(job.input.content || ""), "utf8"),
        contentType: job.input.content_type || "text/plain; charset=utf-8",
        filename: safeFilename(job.input.filename, "iabt-artifact.txt"),
        kind: "document",
        metadata: { deterministic: true }
      }]
    };
  }
  if (job.job_type === "creation.interactive") {
    return buildInteractiveArtifacts({
      title: job.input.title,
      requestText: job.input.request_text,
      spec: job.input
    });
  }
  if (job.job_type === "creation.document") {
    return buildDocumentArtifacts({
      title: job.input.title,
      requestText: job.input.request_text,
      intent: job.input.intent
    });
  }
  if (job.job_type === "creation.code") {
    return buildCodeArtifacts({
      title: job.input.title,
      requestText: job.input.request_text
    });
  }
  if (job.job_type === "creation.design") {
    return buildDesignArtifacts({
      title: job.input.title,
      requestText: job.input.request_text
    });
  }
  if (job.job_type === "creation.gcode-simulation") {
    return buildGcodeSimulationArtifacts({
      title: job.input.title,
      requestText: job.input.request_text
    });
  }
  if (job.job_type === "creation.automation") {
    return buildAutomationArtifacts({
      title: job.input.title,
      requestText: job.input.request_text
    });
  }
  const task = providerTask(job);
  if (!task) {
    throw Object.assign(new Error("The standalone worker does not support this job type"), {
      code: "unsupported_job_type"
    });
  }
  const result = await providers.execute(task.provider, task.operation, job.input, {
    approval: job.approval,
    idempotencyKey: job.idempotency_key
  });
  return {
    metadata: result.metadata || {},
    artifacts: [{
      ...result,
      kind: task.kind,
      metadata: result.metadata || {}
    }]
  };
};

const providerContext = (job) => ({
  approval: job.approval,
  idempotencyKey: job.idempotency_key
});

const lumaStep = async (job, providers, pollDelayMs, repository, workerId, assertLease) => {
  let providerJobId = String(job.input.provider_job_id || job.output?.luma_submission?.provider_job_id || "");
  let providerResult;
  if (!providerJobId) {
    if (job.output?.luma_submission?.phase === "submitting") throw Object.assign(new Error("Provider submission needs reconciliation"), { code: "provider_outcome_unknown" });
    await assertLease();
    await checkpointOutput(repository, job, workerId, { luma_submission: { phase: "submitting" } });
    providerResult = await providers.execute(
      "luma",
      "submit_video",
      job.input,
      providerContext(job)
    );
    providerJobId = String(providerResult.providerJobId || "");
    if (!providerJobId) {
      throw Object.assign(new Error("The managed video renderer returned no job ID"), {
        code: "luma_invalid_response"
      });
    }
    await assertLease();
    await checkpointOutput(repository, job, workerId, { luma_submission: { phase: "submitted", provider_job_id: providerJobId } });
  } else {
    providerResult = await providers.execute(
      "luma",
      "get_video",
      { ...job.input, provider_job_id: providerJobId },
      providerContext(job)
    );
  }

  if (providerResult.state === "failed") {
    throw Object.assign(
      new Error(providerResult.error || "The managed video renderer could not complete the job"),
      { code: "luma_generation_failed", retryable: false }
    );
  }

  if (providerResult.state === "succeeded" && providerResult.outputUrl) {
    const video = await providers.execute(
      "luma",
      "download_video",
      {
        ...job.input,
        provider_job_id: providerJobId,
        output_url: providerResult.outputUrl,
        filename: safeFilename(job.input.title, "JERICHO Video") + ".mp4"
      },
      providerContext(job)
    );
    return {
      deferred: false,
      result: {
        metadata: {
          provider_job_id: providerJobId,
          provider_state: "succeeded",
          poll_count: Number(job.input.provider_poll_count || 0)
        },
        artifacts: [{ ...video, kind: "video", metadata: video.metadata || {} }]
      }
    };
  }

  const pollCount = Number(job.input.provider_poll_count || 0) +
    (job.input.provider_job_id ? 1 : 0);
  if (pollCount >= 120) {
    throw Object.assign(new Error("The managed video renderer did not finish within the polling window"), {
      code: "luma_generation_timeout",
      retryable: false
    });
  }
  return {
    deferred: true,
    inputPatch: {
      provider_job_id: providerJobId,
      provider_poll_count: pollCount
    },
    outputPatch: {
      provider_job_id: providerJobId,
      provider_state: "processing",
      provider_poll_count: pollCount
    },
    availableAt: new Date(Date.now() + pollDelayMs).toISOString()
  };
};

const syncPlanStatus = async (repository, job, status) => {
  if (!job.input?.plan_id) return;
  try {
    const user = await repository.getUser(job.owner_id);
    if (!user) return;
    await repository.updateRecord("CreationPlan", job.input.plan_id, user, {
      status,
      execution_job_id: job.id
    });
  } catch {
    // Job/artifact/credit finalization is authoritative. A failed projection
    // update must never turn a committed success into another job attempt.
    console.error({ code: "creation_plan_status_sync_failed", job_id: job.id, plan_id: job.input.plan_id, status });
  }
};

export const runClaimedJob = async ({
  job,
  workerId,
  repository,
  storage,
  providers,
  config = {},
  assertLease = async () => {},
  pollDelayMs = 5000
}) => {
  try {
    if (job.attempts_exhausted) {
      throw Object.assign(new Error("Job retry budget exhausted"), { code: "job_attempts_exhausted" });
    }
    if (job.lease_recovered && job.job_type.startsWith("provider.") && !job.input?.provider_job_id && !job.output?.luma_submission?.provider_job_id && !job.output?.provider_result) {
      // A prior worker may have submitted the paid request before it crashed.
      // Never issue a second charge when the provider outcome is unknown.
      throw Object.assign(new Error("Provider submission needs reconciliation"), { code: "provider_outcome_unknown" });
    }
    await assertLease();
    let result;
    if (job.job_type === "creation.orchestrated") {
      const step = await orchestrationStep({ job, workerId, repository, storage, providers, config, assertLease });
      if (step.deferred) {
        await assertLease();
        const deferred = await repository.deferJob({ jobId: job.id, workerId, outputPatch: step.outputPatch, availableAt: step.availableAt });
        return { job: deferred, deferred: true, artifacts: [], released_credits: 0 };
      }
      if (step.result) result = step.result;
      else if (step.fallback) {
        // Attached-file integrity and intent constraints remain authoritative.
        if (job.input?.file_references?.length) {
          const user = await repository.getUser(job.owner_id);
          const sources = await readTextSources({ repository, storage, user, fileIds: job.input.file_references.map((file) => file.file_id), expectedReferences: job.input.file_references });
          result = buildSourceReviewArtifacts({ requestText: job.input.request_text, sources });
        } else result = await resultFor(internalFallbackJob(job), providers);
        result.metadata = { ...result.metadata, delivery_mode: "template_fallback", objective_completed: false, fallback_reason: step.reason,
          limitations: ["Responses orchestration did not complete. This is an internal template deliverable, not a verified completion of the full requested objective."] };
        for (const artifact of result.artifacts) artifact.metadata = { ...artifact.metadata, delivery_mode: "template_fallback", objective_completed: false };
      }
    } else if (job.input?.file_references?.length) {
      if (job.job_type !== "creation.document" || job.input.intent !== "document") {
        throw Object.assign(new Error("Attached sources require the source-review document workflow"), { code: "source_intent_unsupported" });
      }
      const user = await repository.getUser(job.owner_id);
      const sources = await readTextSources({
        repository, storage, user,
        fileIds: job.input.file_references.map((reference) => reference.file_id),
        expectedReferences: job.input.file_references
      });
      result = buildSourceReviewArtifacts({ requestText: job.input.request_text, sources });
    } else if (job.job_type === "provider.luma.video") {
      const step = await lumaStep(job, providers, pollDelayMs, repository, workerId, assertLease);
      if (step.deferred) {
        await assertLease();
        const deferred = await repository.deferJob({
          jobId: job.id,
          workerId,
          inputPatch: step.inputPatch,
          outputPatch: step.outputPatch,
          availableAt: step.availableAt
        });
        return {
          job: deferred,
          deferred: true,
          artifacts: [],
          released_credits: 0
        };
      }
      result = step.result;
    } else if (providerTask(job)) {
      if (job.output?.provider_result) {
        result = { ...job.output.provider_result, artifacts: job.output.provider_result.artifacts.map((item) => ({ ...item, bytes: Buffer.from(item.content_base64, "base64") })) };
      } else {
        if (job.output?.provider_dispatch === "submitting") throw Object.assign(new Error("Provider submission needs reconciliation"), { code: "provider_outcome_unknown" });
        await checkpointOutput(repository, job, workerId, { provider_dispatch: "submitting" });
        try { result = await resultFor(job, providers); }
        catch (error) {
          // An explicit rate limit rejects the request before generation. Other
          // uncertain POST outcomes retain the barrier against a second spend.
          if (/rate_limited$/.test(String(error.code || ""))) await checkpointOutput(repository, job, workerId, { provider_dispatch: "rate_limited" });
          throw error;
        }
        const resultBytes = result.artifacts.reduce((sum, item) => sum + item.bytes.length, 0);
        if (resultBytes <= 6_000_000) {
          const saved = { ...result, artifacts: result.artifacts.map(({ bytes, ...item }) => ({ ...item, content_base64: bytes.toString("base64") })) };
          await assertLease();
          await checkpointOutput(repository, job, workerId, { provider_result: saved, provider_dispatch: "completed" });
        }
      }
    } else {
      result = await resultFor(job, providers);
    }
    await assertLease();
    if (!Array.isArray(result?.artifacts) || !result.artifacts.length) {
      throw Object.assign(new Error("The job did not produce a durable artifact"), {
        code: "durable_output_required"
      });
    }

    const storedArtifacts = [];
    const manifest = [];
    for (const item of result.artifacts) {
      await assertLease();
      if (!Buffer.isBuffer(item.bytes) || !item.bytes.length) {
        throw Object.assign(new Error("A generated artifact was empty"), {
          code: "durable_output_required"
        });
      }
      const digest = createHash("sha256").update(item.bytes).digest("hex");
      const objectId = artifactObjectId(job.id, storedArtifacts.length, digest);
      let stored;
      try {
        stored = await storage.put({ ownerId: job.owner_id, objectId, bytes: item.bytes, contentType: item.contentType });
      } catch (error) {
        // A crashed worker may already have written this immutable object. The
        // deterministic key can be reused only after its exact bytes match.
        if (error?.code !== "EEXIST" || storage.kind !== "local" || !storage.read) throw error;
        stored = { storage_provider: storage.kind, storage_key: job.owner_id + "/" + objectId };
      }
      let readbackVerified = false;
      if (storage.read) {
        let readback;
        try { readback = await storage.read(stored.storage_key, { maxBytes: item.bytes.length }); }
        catch { throw Object.assign(new Error("Artifact could not be read after storage"), { code: "storage_verification_failed", retryable: true }); }
        if (!Buffer.isBuffer(readback) || readback.length !== item.bytes.length || createHash("sha256").update(readback).digest("hex") !== digest) {
          throw Object.assign(new Error("Artifact storage checksum did not match"), { code: "storage_verification_failed", retryable: true });
        }
        readbackVerified = true;
      } else {
        throw Object.assign(new Error("Private storage readback is required"), { code: "storage_readback_not_configured" });
      }
      const record = {
        id: objectId,
        ownerId: job.owner_id,
        storageProvider: stored.storage_provider,
        storageKey: stored.storage_key,
        originalName: safeFilename(item.filename, "iabt-artifact.bin"),
        contentType: item.contentType || "application/octet-stream",
        sizeBytes: item.bytes.length,
        sha256: digest
      };
      storedArtifacts.push(record);
      manifest.push({
        id: objectId,
        name: record.originalName,
        kind: item.kind || "other",
        mime_type: record.contentType,
        size_bytes: record.sizeBytes,
        sha256: record.sha256,
        metadata: { ...item.metadata, storage_readback_verified: readbackVerified }
      });
    }

    await assertLease();
    const completed = await repository.completeJob({
      jobId: job.id,
      workerId,
      output: {
        ...job.output,
        verified: true,
        plan_id: job.input.plan_id || "",
        conversation_id: job.input.conversation_id || "",
        project_id: job.input.project_id || "",
        intent: job.input.intent || "",
        artifact_manifest: manifest,
        provider_metadata: result.metadata || {}
      },
      artifacts: storedArtifacts
    });
    await syncPlanStatus(repository, job, "completed");
    await rememberOutcome(repository, completed.job);
    return completed;
  } catch (error) {
    if (error?.code === "job_lease_lost") throw error;
    const classification = classifyFailure(error);
    error.retryable = classification.retryable;
    const retryAt =
      error?.retryable && job.attempt_count < job.max_attempts
        ? new Date(Date.now() + Math.min(60000, 1000 * 2 ** job.attempt_count)).toISOString()
        : null;
    if (repository.checkpointJob) {
      const history = [...(job.output?.repair_history || []), { code: classification.code, attempt: job.attempt_count, recovery: retryAt ? "retry_with_backoff" : "escalate_and_release", at: new Date().toISOString() }].slice(-20);
      await assertLease();
      await repository.checkpointJob({ jobId: job.id, workerId, outputPatch: { repair_history: history } });
    }
    const failed = await repository.failJob({
      jobId: job.id,
      workerId,
      error: failureContract(error, { willRetry: Boolean(retryAt) }),
      retryAt
    });
    if (failed.job.status === "failed" || failed.job.status === "needs_setup") {
      await syncPlanStatus(repository, job, "failed");
      await rememberOutcome(repository, failed.job);
    }
    return failed;
  }
};
