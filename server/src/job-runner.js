import { createHash } from "node:crypto";
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
    return { provider: "openai", operation: "response" };
  }
  if (job.job_type === "provider.elevenlabs.music") {
    return { provider: "elevenlabs", operation: "compose_music" };
  }
  return null;
};

export const runClaimedJob = async ({
  job,
  workerId,
  repository,
  storage,
  providers
}) => {
  try {
    let result;
    if (job.job_type === "artifact.echo") {
      const bytes = Buffer.from(String(job.input.content || ""), "utf8");
      result = {
        durable: true,
        bytes,
        contentType: job.input.content_type || "text/plain; charset=utf-8",
        filename: safeFilename(job.input.filename, "iabt-artifact.txt"),
        metadata: { deterministic: true }
      };
    } else {
      const task = providerTask(job);
      if (!task) {
        throw Object.assign(new Error("The standalone worker does not support this job type"), {
          code: "unsupported_job_type"
        });
      }
      result = await providers.execute(task.provider, task.operation, job.input, {
        approval: job.approval,
        idempotencyKey: job.idempotency_key
      });
    }

    if (!result?.durable || !Buffer.isBuffer(result.bytes) || !result.bytes.length) {
      throw Object.assign(new Error("The job did not produce a durable artifact"), {
        code: "durable_output_required"
      });
    }

    const objectId = createId();
    const stored = await storage.put({
      ownerId: job.owner_id,
      objectId,
      bytes: result.bytes,
      contentType: result.contentType
    });
    const artifact = {
      id: objectId,
      ownerId: job.owner_id,
      storageProvider: stored.storage_provider,
      storageKey: stored.storage_key,
      originalName: safeFilename(result.filename, "iabt-artifact.bin"),
      contentType: result.contentType || "application/octet-stream",
      sizeBytes: result.bytes.length,
      sha256: createHash("sha256").update(result.bytes).digest("hex")
    };
    return repository.completeJob({
      jobId: job.id,
      workerId,
      output: {
        verified: true,
        provider_metadata: result.metadata || {}
      },
      artifact
    });
  } catch (error) {
    const retryAt =
      error?.retryable && job.attempt_count < job.max_attempts
        ? new Date(Date.now() + Math.min(60000, 1000 * 2 ** job.attempt_count)).toISOString()
        : null;
    return repository.failJob({
      jobId: job.id,
      workerId,
      error: failureContract(error),
      retryAt
    });
  }
};