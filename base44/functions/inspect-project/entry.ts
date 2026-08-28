import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";

function text(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function owns(user: any, row: any) {
  return Boolean(row && (
    user.role === "admin" ||
    String(row.user_id || "") === String(user.id) ||
    String(row.created_by || "") === String(user.email)
  ));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const projectId = text(body?.project_id, 200);
    if (!projectId) {
      return Response.json({ error: "project_id is required." }, { status: 400 });
    }

    const project = await base44.entities.Project.get(projectId).catch(() => null);
    if (!owns(user, project)) {
      return Response.json({ error: "Project not found or access denied." }, { status: 404 });
    }

    const service = base44.asServiceRole;
    const [plans, artifacts] = await Promise.all([
      service.entities.CreationPlan.filter({ project_id: projectId }, "-created_date", 25).catch(() => []),
      service.entities.CreationArtifact.filter({ project_id: projectId }, "-created_date", 100).catch(() => []),
    ]);
    const planIds = new Set((plans || []).map((row: any) => row.id));
    const allJobs = await service.entities.GenerationJob
      .filter({ user_id: user.id }, "-created_date", 200)
      .catch(() => []);
    const jobs = (allJobs || []).filter((row: any) =>
      String(row.project_id || "") === projectId || planIds.has(row.plan_id)
    );
    const jobIds = new Set(jobs.map((row: any) => row.id));
    const allIncidents = await service.entities.SystemIncident
      .filter({ user_id: user.id }, "-last_seen_at", 200)
      .catch(() => []);
    const incidents = (allIncidents || []).filter((row: any) =>
      planIds.has(row.plan_id) || jobIds.has(row.job_id)
    );

    const definition = project.app_definition && typeof project.app_definition === "object"
      ? project.app_definition
      : {};
    const pages = Array.isArray(definition.pages) ? definition.pages : [];
    const files = definition.files && typeof definition.files === "object" ? definition.files : {};
    const sourceArtifacts = (artifacts || []).filter((row: any) =>
      /zip|source|app_definition/i.test([row.kind, row.name, row.mime_type].join(" "))
    );
    const buildReports = (artifacts || []).filter((row: any) =>
      /build[_ -]?report|build readiness/i.test([row.kind, row.name].join(" "))
    );
    const failedJobs = jobs.filter((row: any) => ["failed", "needs_setup"].includes(row.status));
    const activeJobs = jobs.filter((row: any) => ["queued", "running", "waiting_provider"].includes(row.status));
    const unresolvedIncidents = incidents.filter((row: any) =>
      !["resolved", "recovered"].includes(row.status)
    );

    const checks = [
      {
        id: "definition_present",
        label: "Project definition exists",
        passed: Object.keys(definition).length > 0,
      },
      {
        id: "pages_present",
        label: "At least one generated page exists",
        passed: pages.length > 0,
      },
      {
        id: "source_or_files_present",
        label: "Source files or a source package exists",
        passed: Object.keys(files).length > 0 || sourceArtifacts.length > 0,
      },
      {
        id: "build_report_present",
        label: "A build-readiness report exists",
        passed: buildReports.length > 0,
      },
      {
        id: "no_active_failure",
        label: "No unresolved project failure is recorded",
        passed: failedJobs.length === 0 && unresolvedIncidents.length === 0,
      },
    ];
    const failedChecks = checks.filter((check) => !check.passed);
    const health = activeJobs.length
      ? "working"
      : failedChecks.length === 0
        ? "healthy"
        : failedJobs.length || unresolvedIncidents.length
          ? "needs_repair"
          : "incomplete";

    return Response.json({
      ok: true,
      project: {
        id: project.id,
        title: text(project.title, 100),
        description: text(project.description, 500),
        status: project.status,
        schema_version: project.schema_version,
        page_count: pages.length,
        file_count: Object.keys(files).length,
      },
      health,
      checks,
      evidence: {
        plan_count: plans.length,
        job_count: jobs.length,
        active_job_count: activeJobs.length,
        failed_job_count: failedJobs.length,
        artifact_count: artifacts.length,
        source_artifact_count: sourceArtifacts.length,
        build_report_count: buildReports.length,
        unresolved_incident_count: unresolvedIncidents.length,
      },
      recent_failures: failedJobs.slice(0, 5).map((job: any) => ({
        job_id: job.id,
        status: job.status,
        stage: text(job.stage),
        error_message: text(job.error_message, 500),
      })),
      incidents: unresolvedIncidents.slice(0, 5).map((incident: any) => ({
        incident_id: incident.id,
        category: incident.category,
        status: incident.status,
        safe_message: text(incident.safe_message, 500),
        recovery_action: incident.recovery_action,
        credits_protected: incident.credits_protected === true,
      })),
      recommended_next_action: health === "healthy"
        ? "The project passed its stored definition, source-package, build-report, and incident checks. Use a new revision plan for requested changes."
        : health === "working"
          ? "Wait for the active job to finish, then inspect the project again before creating another revision."
          : "Create a revision plan against this exact project_id that addresses the failed checks and recent incident evidence, then verify the replacement artifacts.",
      inspection_only: true,
      charged: false,
      permissions_changed: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
