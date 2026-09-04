import { createHash } from "node:crypto";
import {
  buildDocumentArtifacts,
  buildInteractiveArtifacts
} from "./creation/app-packager.js";
import { createId } from "./security.js";

const safeFilename = (value, fallback) => {
  const cleaned = String(value || "")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
};

const failureContract = (error) => {
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
      configuration
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

const syncPlanStatus = async (repository, job, status) => {
  if (!job.input?.plan_id) return;
  const user = await repository.getUser(job.owner_id);
  if (!user) return;
  await repository.updateRecord("CreationPlan", job.input.plan_id, user, {
    status,
    execution_job_id: job.id
  });
};

export const runClaimedJob = async ({
  job,
  workerId,
  repository,
  storage,
  providers
}) => {
  try {
    const result = await resultFor(job, providers);
    if (!Array.isArray(result?.artifacts) || !result.artifacts.length) {
      throw Object.assign(new Error("The job did not produce a durable artifact"), {
        code: "durable_output_required"
      });
    }

    const storedArtifacts = [];
    const manifest = [];
    for (const item of result.artifacts) {
      if (!Buffer.isBuffer(item.bytes) || !item.bytes.length) {
        throw Object.assign(new Error("A generated artifact was empty"), {
          code: "durable_output_required"
        });
      }
      const objectId = createId();
      const stored = await storage.put({
        ownerId: job.owner_id,
        objectId,
        bytes: item.bytes,
        contentType: item.contentType
      });
      const record = {
        id: objectId,
        ownerId: job.owner_id,
        storageProvider: stored.storage_provider,
        storageKey: stored.storage_key,
        originalName: safeFilename(item.filename, "iabt-artifact.bin"),
        contentType: item.contentType || "application/octet-stream",
        sizeBytes: item.bytes.length,
        sha256: createHash("sha256").update(item.bytes).digest("hex")
      };
      storedArtifacts.push(record);
      manifest.push({
        id: objectId,
        name: record.originalName,
        kind: item.kind || "other",
        mime_type: record.contentType,
        size_bytes: record.sizeBytes,
        sha256: record.sha256,
        metadata: item.metadata || {}
      });
    }

    const completed = await repository.completeJob({
      jobId: job.id,
      workerId,
      output: {
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
    return completed;
  } catch (error) {
    const retryAt =
      error?.retryable && job.attempt_count < job.max_attempts
        ? new Date(Date.now() + Math.min(60000, 1000 * 2 ** job.attempt_count)).toISOString()
        : null;
    const failed = await repository.failJob({
      jobId: job.id,
      workerId,
      error: failureContract(error),
      retryAt
    });
    if (failed.job.status === "failed" || failed.job.status === "needs_setup") {
      await syncPlanStatus(repository, job, "failed");
    }
    return failed;
  }
};