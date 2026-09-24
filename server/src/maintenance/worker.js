import { createHash, randomUUID } from "node:crypto";
import { recordExecutionLesson } from "../learning/service.js";

const now = () => new Date().toISOString();
const transient = (error) => ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "40001", "40P01", "55P03"].includes(error?.code || error?.cause?.code) || ["TimeoutError", "AbortError"].includes(error?.name);
const safeCode = (error) => transient(error) ? "maintenance_transient_failure" : "maintenance_step_failed";
const leaseError = () => Object.assign(new Error("Maintenance lease changed"), { code: "maintenance_lease_lost" });
const jobCursor = (job) => job.maintenance_cursor || { completed_at: job.completed_date, job_id: job.id };
const validId = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export async function runMaintenancePass({ schedule, repository, storage, config, assertLease }) {
  const settings = config.maintenance;
  const started = Date.now();
  const checkpoint = structuredClone(schedule.checkpoint || {});
  const summary = {
    status: "running", jobs_checked: 0, plans_reconciled: 0, lessons_ensured: 0,
    artifacts_verified: 0, artifact_bytes_read: 0, artifact_reads: 0, pass_complete: false,
    findings: structuredClone(schedule.summary?.findings || []).slice(-50)
  };
  const lease = { ownerId: schedule.owner_id, leaseToken: schedule.lease_token };
  const account = { id: schedule.owner_id, role: "user" };
  const finding = (code, jobId = null, artifactId = null) => {
    summary.findings = summary.findings.filter((item) => !(item.code === code && item.job_id === jobId && item.artifact_id === artifactId));
    summary.findings.push({ code, job_id: jobId, artifact_id: artifactId, observed_at: now() });
    summary.findings = summary.findings.slice(-50);
  };
  const save = async () => {
    await assertLease();
    await repository.saveMaintenanceProgress({ ...lease, checkpoint, summary });
  };
  const finish = async ({ failed = false, retry = false } = {}) => {
    summary.status = retry ? "retry_pending" : failed || summary.findings.length ? "needs_attention" : "pass_finished";
    await assertLease();
    return repository.finishMaintenance({ ...lease, checkpoint, summary, failed,
      nextRunAt: new Date(Date.now() + (retry ? Math.min(schedule.interval_ms, 30000 * 2 ** Math.min(schedule.consecutive_failures, 4)) : schedule.interval_ms)).toISOString() });
  };
  try {
    while (summary.jobs_checked < settings.maxJobs && Date.now() - started < settings.maxPassMs) {
      await assertLease();
      let job;
      if (checkpoint.current_job) job = await repository.getJob(checkpoint.current_job.id, account);
      else {
        const [next] = await repository.listMaintenanceJobs({ ownerId: account.id, cursor: checkpoint.cursor || null, limit: 1 });
        job = next;
        if (job) checkpoint.current_job = { id: job.id, cursor: jobCursor(job), phase: "records", artifact_index: 0, read_attempts: 0 };
      }
      if (!job) {
        if (checkpoint.current_job) finding("maintenance_job_unavailable", checkpoint.current_job.id);
        checkpoint.cursor = checkpoint.current_job?.cursor || null;
        delete checkpoint.current_job;
        summary.pass_complete = true;
        if (!checkpoint.cursor) checkpoint.completed_sweeps = (checkpoint.completed_sweeps || 0) + 1;
        break;
      }
      if (job.owner_id !== account.id || !["succeeded", "failed", "needs_setup"].includes(job.status)) throw Object.assign(new Error("Invalid maintenance job scope"), { code: "maintenance_scope_invalid" });
      const current = checkpoint.current_job;
      if (current.phase === "records") {
        const beforeSummary = structuredClone(summary);
        try { await repository.withMaintenanceLease(lease, async (tx) => {
          const authoritative = await tx.getJob(job.id, account);
          if (!authoritative || authoritative.owner_id !== account.id || authoritative.status !== job.status) throw leaseError();
          if (job.input?.plan_id) {
            const plan = validId(job.input.plan_id) ? await tx.getRecord("CreationPlan", job.input.plan_id, account) : null;
            if (plan && plan.owner_id === account.id && plan.execution_job_id === job.id) {
              const desired = job.status === "succeeded" ? "completed" : "failed";
              if (plan.status !== desired) { await tx.updateRecord("CreationPlan", plan.id, account, { status: desired }); summary.plans_reconciled += 1; }
              summary.findings = summary.findings.filter((entry) => !(entry.job_id === job.id && entry.code === "plan_projection_binding_unverified"));
            } else finding("plan_projection_binding_unverified", job.id);
          }
          if (await recordExecutionLesson({ repository: tx, user: account, job })) summary.lessons_ensured += 1;
          current.phase = "artifacts";
          await tx.saveMaintenanceProgress({ ...lease, checkpoint, summary });
        }); } catch (error) {
          // A rollback must not advance the in-memory cursor that a later
          // failure checkpoint persists. Retrying repeats only idempotent work.
          current.phase = "records";
          Object.assign(summary, beforeSummary);
          throw error;
        }
      }
      const manifest = job.status === "succeeded" && Array.isArray(job.output?.artifact_manifest) ? job.output.artifact_manifest : [];
      if (job.status === "succeeded" && !manifest.length) finding("artifact_manifest_missing", job.id);
      if (manifest.length > 32) { finding("artifact_manifest_limit", job.id); current.artifact_index = manifest.length; }
      while (current.artifact_index < manifest.length) {
        if (Date.now() - started >= settings.maxPassMs) { await save(); return finish(); }
        const item = manifest[current.artifact_index];
        const id = validId(item?.id) ? item.id : null;
        const record = id ? await repository.getStoredObject(id, account) : null;
        if (!record || record.owner_id !== account.id || record.job_id !== job.id) finding("artifact_record_missing", job.id, id);
        else if (record.storage_provider !== storage?.kind) finding("artifact_storage_adapter_unavailable", job.id, id);
        else if (!Number.isSafeInteger(item.size_bytes) || item.size_bytes < 1 || record.sha256 !== item.sha256 || Number(record.size_bytes) !== item.size_bytes || !/^[a-f0-9]{64}$/.test(item.sha256)) finding("artifact_metadata_mismatch", job.id, id);
        else if (!storage?.read) finding("artifact_readback_unavailable", job.id, id);
        else if (!["local", "test"].includes(storage.kind) && settings.remoteReadbackEnabled !== true) finding("remote_readback_disabled_unverified", job.id, id);
        else if (item.size_bytes > Math.min(settings.maxArtifactBytes, settings.maxPassBytes)) finding("artifact_above_readback_limit", job.id, id);
        else if (current.read_attempts >= 3) finding("artifact_read_retry_exhausted", job.id, id);
        else {
          if (summary.artifact_bytes_read + item.size_bytes > settings.maxPassBytes || summary.artifact_reads >= 32) { await save(); return finish(); }
          await assertLease();
          current.read_attempts += 1;
          summary.artifact_reads += 1;
          await save();
          let bytes;
          // Admission is bounded by maxPassMs. One admitted storage read may
          // finish after that deadline, within the adapter's own timeout.
          try { bytes = await storage.read(record.storage_key, { maxBytes: item.size_bytes }); }
          catch (error) {
            summary.artifact_bytes_read += item.size_bytes;
            if (transient(error) && current.read_attempts < 3) { finding("artifact_read_retry_pending", job.id, id); await save(); return finish({ retry: true }); }
            finding(transient(error) ? "artifact_read_retry_exhausted" : "artifact_unavailable", job.id, id);
          }
          if (bytes) {
            summary.artifact_bytes_read += item.size_bytes;
            if (!Buffer.isBuffer(bytes) || bytes.length !== item.size_bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256) finding("artifact_integrity_mismatch", job.id, id);
            else {
              summary.artifacts_verified += 1;
              summary.findings = summary.findings.filter((entry) => !(entry.job_id === job.id && entry.artifact_id === id));
            }
          }
        }
        current.artifact_index += 1;
        current.read_attempts = 0;
        await save();
      }
      checkpoint.cursor = current.cursor;
      delete checkpoint.current_job;
      summary.findings = summary.findings.filter((entry) => !(entry.job_id === job.id && ["maintenance_step_failed", "maintenance_transient_failure"].includes(entry.code)));
      summary.jobs_checked += 1;
      await save();
    }
    return finish();
  } catch (error) {
    if (error.code === "maintenance_lease_lost") throw error;
    finding(safeCode(error), checkpoint.current_job?.id || null);
    // A known transient step can retain its checkpoint for at most three fast
    // retries. Unknown failures yield until the normal next bounded pass.
    return finish({ failed: true, retry: transient(error) && schedule.consecutive_failures < 2 });
  }
}

export const createMaintenanceWorker = ({ repository, storage, config, workerId = "iabt-maintenance-" + randomUUID(), log = (entry) => console.info(entry) }) => {
  let timer = null;
  let inFlight = null;
  let stopping = false;
  const execute = async () => {
    if (!config.maintenance?.enabled) return null;
    await repository.enrollVerifiedMaintenance({ intervalMs: config.maintenance.intervalMs, limit: 100 });
    const schedule = await repository.claimDueMaintenance({ workerId, leaseMs: config.maintenance.leaseMs });
    if (!schedule) return null;
    let lost = null;
    let renewing = null;
    const renew = () => {
      if (lost) return Promise.reject(lost);
      if (!renewing) renewing = repository.renewMaintenanceLease({ ownerId: schedule.owner_id, leaseToken: schedule.lease_token, leaseMs: config.maintenance.leaseMs })
        .catch(() => { lost = leaseError(); throw lost; }).finally(() => { renewing = null; });
      return renewing;
    };
    const heartbeat = setInterval(() => { void renew().catch(() => {}); }, Math.max(1000, Math.floor(config.maintenance.leaseMs / 3)));
    try {
      const result = await runMaintenancePass({ schedule, repository, storage, config, assertLease: renew });
      // Only a committed pass produces this operational signal. Project an
      // explicit field allowlist so account and artifact details stay private.
      if (result?.summary) {
        const summary = result.summary;
        const entry = {
          event: "jericho_maintenance_pass",
          status: ["pass_finished", "needs_attention", "retry_pending"].includes(summary.status) ? summary.status : "unknown",
          findings_count: Array.isArray(summary.findings) ? summary.findings.length : 0
        };
        for (const key of ["jobs_checked", "plans_reconciled", "lessons_ensured", "artifacts_verified", "artifact_bytes_read", "artifact_reads"]) {
          entry[key] = Number.isSafeInteger(summary[key]) && summary[key] >= 0 ? summary[key] : 0;
        }
        // Logging must never turn a committed pass into a retry.
        try { log(entry); } catch { /* best-effort operational signal */ }
      }
      return result;
    }
    finally { clearInterval(heartbeat); if (renewing) await renewing.catch(() => {}); }
  };
  const runOnce = () => {
    if (stopping) return Promise.resolve(null);
    if (!inFlight) inFlight = execute().finally(() => { inFlight = null; });
    return inFlight;
  };
  const tick = () => { if (!inFlight && !stopping) void runOnce().catch((error) => { if (error.code !== "maintenance_lease_lost") console.error({ code: "maintenance_tick_failed" }); }); };
  return {
    runOnce,
    start() { if (!timer && !stopping && config.maintenance?.enabled) { timer = setInterval(tick, config.maintenance.pollMs); tick(); } },
    async stop() { stopping = true; if (timer) clearInterval(timer); timer = null; if (inFlight) await inFlight.catch(() => {}); }
  };
};
