import { useRef, useState } from "react";
import { iabtClient } from "@/api/iabtClient";
import { Button } from "@/components/ui/button";

const labels = { not_enrolled: "Awaiting enrollment", paused: "Paused", runtime_disabled: "Server maintenance is disabled", running: "Checking your records", retry_pending: "Retry scheduled", scheduled: "Scheduled" };
const when = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded yet";
const findingLabels = {
  artifact_record_missing: "An artifact record is missing",
  artifact_integrity_mismatch: "A saved file failed its integrity check",
  artifact_metadata_mismatch: "File records disagree",
  artifact_unavailable: "A saved file could not be read",
  artifact_read_retry_pending: "A temporary file access problem will be retried",
  artifact_read_retry_exhausted: "File access still needs investigation",
  artifact_above_readback_limit: "A larger file needs a separate integrity check",
  artifact_storage_adapter_unavailable: "The file's storage service is unavailable",
  artifact_readback_unavailable: "Storage verification is unavailable",
  remote_readback_disabled_unverified: "Remote file bytes need a separately enabled integrity check",
  plan_projection_binding_unverified: "A job could not be matched to its plan",
  maintenance_transient_failure: "A temporary maintenance problem was recorded",
  maintenance_step_failed: "A maintenance step needs investigation"
};

export default function JerichoMaintenancePanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const update = async (enabled) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await iabtClient.functions.invoke(typeof enabled === "boolean" ? "configure-jericho-maintenance" : "get-jericho-maintenance", typeof enabled === "boolean" ? { enabled } : {});
      setSnapshot(result.data);
    } catch (failure) {
      setError(failure?.message || "Maintenance status could not be loaded. Refresh before changing its settings again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-slate-100" onToggle={(event) => {
    if (event.currentTarget.open && !snapshot) void update();
  }}>
    <summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">Jericho maintenance</summary>
    <div className="mt-4 space-y-4" aria-busy={busy}>
      <p className="text-sm text-slate-300">Jericho checks your completed work, repairs mismatched plan status, retains missing outcome lessons and checks saved files. Its schedule and progress survive closing Studio and server restarts.</p>
      <p className="text-sm text-slate-400">Checks require a running server. This uses your existing hosting and storage, consumes no IABT credits and starts no paid generation. Code changes, deployment and launch acceptance still require separate work.</p>
      <p role="status" aria-live="polite" className="text-sm text-cyan-200">{busy ? "Updating maintenance status…" : snapshot ? labels[snapshot.status] || "Status unavailable" : "Open this panel to load your schedule."}</p>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void update()}>Refresh maintenance</Button>
        {snapshot && <Button type="button" variant="outline" disabled={busy} onClick={() => void update(!snapshot.enabled)}>{snapshot.enabled ? "Pause maintenance" : "Resume maintenance"}</Button>}
      </div>
      {snapshot && <>
        {!snapshot.remote_readback_enabled && <p className="text-xs text-slate-400">Remote file byte checks require the operator to enable metered storage reads. Record reconciliation and lesson retention can still run.</p>}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-400">Check interval</dt><dd>{snapshot.interval_minutes} minutes while the worker is available</dd></div>
          <div><dt className="text-slate-400">Next scheduled check</dt><dd>{snapshot.enabled ? when(snapshot.next_run_at) : "Paused"}</dd></div>
          <div><dt className="text-slate-400">Last started</dt><dd>{when(snapshot.last_started_at)}</dd></div>
          <div><dt className="text-slate-400">Last finished</dt><dd>{when(snapshot.last_completed_at)}</dd></div>
        </dl>
        <p className="text-sm text-slate-300">Latest pass: {snapshot.summary.jobs_checked} job(s) checked, {snapshot.summary.plans_reconciled} plan status repair(s), {snapshot.summary.lessons_ensured} outcome lesson(s) retained and {snapshot.summary.artifacts_verified} file integrity check(s) passed.</p>
        {snapshot.progress.checkpoint_saved && <p className="text-xs text-slate-400">Progress is saved for the next pass. A finished pass does not mean every file or launch requirement has been verified.</p>}
        <section aria-label="Maintenance findings" className="border-t border-slate-800 pt-3">
          <h3 className="font-medium">Findings to follow up</h3>
          {!snapshot.summary.findings.length ? <p className="mt-2 text-sm text-slate-400">No unresolved findings are recorded in this bounded check history.</p> : <ul className="mt-2 space-y-3 text-sm">
            {snapshot.summary.findings.map((finding, index) => <li key={`${finding.code}:${finding.job_id}:${finding.artifact_id}:${index}`}>
              <p>{findingLabels[finding.code] || "A recorded check needs investigation"}</p>
              <p className="text-xs text-slate-400">{finding.job_id ? `Job ${finding.job_id.slice(0, 8)} · ` : ""}{finding.artifact_id ? `File ${finding.artifact_id.slice(0, 8)} · ` : ""}{when(finding.observed_at)} · {finding.code}</p>
            </li>)}
          </ul>}
          {!!snapshot.summary.findings.length && <p className="mt-3 text-xs text-slate-400">Share the finding and job reference with support. Existing files and paid jobs are preserved for investigation.</p>}
        </section>
      </>}
    </div>
  </details>;
}
