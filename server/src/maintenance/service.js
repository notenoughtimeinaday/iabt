const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const actorFor = (user) => {
  if (!user?.id || user.email_verified !== true) fail("verified_account_required", "A verified account is required", 403);
  return { id: user.id, role: "user" };
};
const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const code = (value) => typeof value === "string" && /^[a-z0-9_-]{1,100}$/i.test(value) ? value : "maintenance_finding";

export const publicMaintenanceStatus = (row, config) => ({
  schema_version: 1,
  enrolled: Boolean(row),
  enabled: Boolean(row?.enabled),
  runtime_enabled: config?.maintenance?.enabled === true,
  remote_readback_enabled: config?.maintenance?.remoteReadbackEnabled === true,
  status: !row ? "not_enrolled" : !row.enabled ? "paused" : config?.maintenance?.enabled !== true ? "runtime_disabled" :
    row.lease_token && Date.parse(row.lease_expires_at) > Date.now() ? "running" : row.summary?.status === "retry_pending" ? "retry_pending" : "scheduled",
  interval_minutes: (row?.interval_ms || config?.maintenance?.intervalMs || 900000) / 60000,
  next_run_at: row?.enabled ? date(row.next_run_at) : null,
  last_started_at: date(row?.last_started_at),
  last_completed_at: date(row?.last_completed_at),
  consecutive_failures: count(row?.consecutive_failures),
  progress: { checkpoint_saved: Boolean(row?.checkpoint?.cursor || row?.checkpoint?.current_job), current_job_id: row?.checkpoint?.current_job?.id || null },
  summary: {
    status: code(row?.summary?.status || "awaiting_first_pass"),
    jobs_checked: count(row?.summary?.jobs_checked),
    plans_reconciled: count(row?.summary?.plans_reconciled),
    lessons_ensured: count(row?.summary?.lessons_ensured),
    artifacts_verified: count(row?.summary?.artifacts_verified),
    artifact_bytes_read: count(row?.summary?.artifact_bytes_read),
    artifact_reads: count(row?.summary?.artifact_reads),
    pass_complete: row?.summary?.pass_complete === true,
    findings: (row?.summary?.findings || []).slice(-50).map((item) => ({ code: code(item.code), job_id: item.job_id || null, artifact_id: item.artifact_id || null, observed_at: date(item.observed_at) }))
  },
  permitted_actions: ["reconcile_terminal_plan_status", "backfill_execution_observations", "verify_private_artifact_integrity"],
  limitations: ["Runs only while an IABT worker is available; free hosting can suspend.", "Remote storage readback is off unless the operator explicitly enables its metered requests; per-pass read and byte bounds are not dollar billing caps.", "Uses existing hosting and private storage; does not enable paid generation or purchase services.", "Does not edit application code, deploy, delete files, modify credits, replay completed jobs, or certify launch readiness."]
});

export async function ensureMaintenanceSchedule({ repository, user, config }) {
  const actor = actorFor(user);
  const row = await repository.ensureMaintenance({ ownerId: actor.id, intervalMs: config?.maintenance?.intervalMs || 900000 });
  return publicMaintenanceStatus(row, config);
}

export async function readMaintenanceStatus({ repository, user, config }) {
  const actor = actorFor(user);
  return publicMaintenanceStatus(await repository.getMaintenance(actor.id), config);
}

export async function configureMaintenance({ repository, user, config, enabled, intervalMinutes }) {
  const actor = actorFor(user);
  if (typeof enabled !== "boolean") fail("maintenance_enabled_required", "Specify whether maintenance is enabled");
  if (intervalMinutes !== undefined && (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440)) fail("invalid_maintenance_interval", "Choose an interval from 5 to 1440 whole minutes");
  await repository.ensureMaintenance({ ownerId: actor.id, intervalMs: config?.maintenance?.intervalMs || 900000 });
  const existing = await repository.getMaintenance(actor.id);
  const row = await repository.configureMaintenance({ ownerId: actor.id, enabled, intervalMs: intervalMinutes === undefined ? existing.interval_ms : intervalMinutes * 60000 });
  return publicMaintenanceStatus(row, config);
}
