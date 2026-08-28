import { createClientFromRequest } from "npm:@base44/sdk";
import {
  SELF_HEALING_VERSION,
  classifySystemFailure,
  recordSystemIncident,
} from "../../shared/self-healing.ts";

function safeIncident(row: any, admin: boolean) {
  return {
    id: String(row?.id || ""),
    source: String(row?.source || ""),
    category: String(row?.category || "unknown"),
    severity: String(row?.severity || "error"),
    status: String(row?.status || "detected"),
    error_code: String(row?.error_code || ""),
    safe_message: String(row?.safe_message || ""),
    retryable: row?.retryable === true,
    retry_count: Number(row?.retry_count || 0),
    max_retry_count: Number(row?.max_retry_count || 0),
    recovery_action: String(row?.recovery_action || "none"),
    recovery_result: String(row?.recovery_result || ""),
    credits_protected: row?.credits_protected === true,
    occurrence_count: Number(row?.occurrence_count || 1),
    plan_id: String(row?.plan_id || ""),
    job_id: String(row?.job_id || ""),
    conversation_id: String(row?.conversation_id || ""),
    first_seen_at: row?.first_seen_at || null,
    last_seen_at: row?.last_seen_at || null,
    resolved_at: row?.resolved_at || null,
    ...(admin ? { technical_summary: String(row?.technical_summary || "") } : {}),
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.id || !user?.email) return Response.json({ error: "Authentication required." }, { status: 401 });
    const service = base44.asServiceRole;
    const [jobs, existingIncidents] = await Promise.all([
      service.entities.GenerationJob.filter({ user_id: user.id }, "-created_date", 100),
      service.entities.SystemIncident.filter({ user_id: user.id }, "-last_seen_at", 100),
    ]);

    const incidents = [...(existingIncidents || [])];
    const byJob = new Map((jobs || []).map((job: any) => [String(job.id), job]));
    for (const incident of incidents) {
      const job: any = byJob.get(String(incident.job_id || ""));
      if (!job || ["recovered", "resolved"].includes(String(incident.status))) continue;
      if (job.status === "succeeded") {
        const updated = await service.entities.SystemIncident.update(incident.id, {
          status: "recovered",
          recovery_result: "The linked generation job completed with a durable artifact.",
          credits_protected: job.usage_state === "captured" || job.usage_state === "released",
          resolved_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        });
        Object.assign(incident, updated);
      } else if (["failed", "canceled", "needs_setup"].includes(String(job.status)) && job.usage_state === "released" && incident.credits_protected !== true) {
        const updated = await service.entities.SystemIncident.update(incident.id, {
          credits_protected: true,
          recovery_result: "The job did not complete and its reserved IABT credits were restored.",
          last_seen_at: new Date().toISOString(),
        });
        Object.assign(incident, updated);
      }
    }

    const knownJobIds = new Set(incidents.map((incident: any) => String(incident.job_id || "")).filter(Boolean));
    for (const job of jobs || []) {
      if (!["failed", "needs_setup"].includes(String(job.status)) || knownJobIds.has(String(job.id))) continue;
      const diagnosis = classifySystemFailure(
        { code: job.status === "needs_setup" ? "managed_renderer_unavailable" : "", message: job.error_message },
        "The generation job did not complete.",
      );
      const created = await recordSystemIncident(service, {
        user_id: user.id,
        user_email: user.email,
        plan_id: job.plan_id,
        job_id: job.id,
        conversation_id: job.conversation_id,
        source: "generation_job_reconciliation",
        diagnosis,
        status: job.status === "needs_setup" ? "needs_setup" : "needs_review",
        recovery_action: job.usage_state === "released" ? "credit_release" : diagnosis.recovery_action,
        recovery_result: job.usage_state === "released" ? "Reserved IABT credits were restored." : "",
        credits_protected: job.usage_state === "released",
        evidence: { job_status: job.status, usage_state: job.usage_state },
      });
      if (created) incidents.push(created);
    }

    incidents.sort((left: any, right: any) => Date.parse(String(right.last_seen_at || 0)) - Date.parse(String(left.last_seen_at || 0)));
    const open = incidents.filter((incident: any) => !["recovered", "resolved"].includes(String(incident.status)));
    const critical = open.filter((incident: any) => incident.severity === "critical");
    const releaseFailures = (jobs || []).filter((job: any) => job.usage_state === "release_failed");
    const counts = (jobs || []).reduce((summary: Record<string, number>, job: any) => {
      const status = String(job.status || "unknown");
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, {});

    const health = critical.length || releaseFailures.length
      ? "attention_required"
      : open.length
        ? "degraded"
        : "healthy";

    return Response.json({
      ok: true,
      health,
      self_healing_version: SELF_HEALING_VERSION,
      checked_at: new Date().toISOString(),
      job_summary: {
        sampled: (jobs || []).length,
        by_status: counts,
        credit_release_failures: releaseFailures.length,
      },
      incident_summary: {
        sampled: incidents.length,
        open: open.length,
        critical: critical.length,
        recovered: incidents.filter((incident: any) => incident.status === "recovered").length,
      },
      automatic_actions: [
        "Retry safe internal transient generation steps within the configured retry limit.",
        "Reject invalid artifacts before completion.",
        "Restore reserved IABT credits when no durable result exists.",
        "Resume tracking when a paid provider accepted a job but the callback path failed.",
        "Reconcile durable artifacts and incident state.",
      ],
      approval_boundaries: [
        "Paid provider resubmission",
        "Charges, refunds, or subscription changes",
        "Credential or access changes",
        "Destructive data changes",
        "External representation or publishing",
        "Live machine control",
      ],
      incidents: incidents.slice(0, 20).map((incident: any) => safeIncident(incident, user.role === "admin")),
    });
  } catch (error) {
    console.error("system health diagnostic failed:", error);
    return Response.json({
      error: "IABT could not complete its system-health diagnostic.",
      code: "system_health_check_failed",
    }, { status: 500 });
  }
});
