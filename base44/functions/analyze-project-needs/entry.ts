import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  COMPENSATION_TYPES,
  PROJECT_STAGES,
  RELATIONSHIP_TYPES,
  enumList,
  enumValue,
  list,
  ownsProject,
  text,
} from "../../shared/exchange.ts";

function parseJson(value: unknown) {
  if (value && typeof value === "object") return value as any;
  const raw = String(value || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JERICHO returned no structured capability map.");
  return JSON.parse(candidate.slice(start, end + 1));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const projectId = text(body?.project_id, 200);
    const suppliedDescription = text(body?.description, 5000);
    const service = base44.asServiceRole;

    let project: any = null;
    if (projectId) {
      project = await service.entities.Project.get(projectId).catch(() => null);
      if (!ownsProject(user, project)) {
        return Response.json({ error: "Project not found or access denied." }, { status: 404 });
      }
    }

    const definition = project?.app_definition && typeof project.app_definition === "object"
      ? project.app_definition
      : {};
    const pages = Array.isArray(definition?.pages) ? definition.pages : [];
    const dataModels = Array.isArray(definition?.data) ? definition.data : [];
    const context = {
      title: text(project?.title || body?.title, 160, "New project"),
      description: suppliedDescription || text(project?.description, 1000),
      category: text(project?.category || body?.industry, 100),
      page_names: pages.map((page: any) => text(page?.name, 100)).filter(Boolean).slice(0, 20),
      data_model_names: dataModels.map((model: any) => text(model?.name, 100)).filter(Boolean).slice(0, 20),
      founder_notes: text(body?.founder_notes, 3000),
    };
    if (!context.description && !context.founder_notes) {
      return Response.json({ error: "Add a project description or founder notes before analysis." }, { status: 400 });
    }

    const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt:
        "You are JERICHO's capability-gap analyst for an opt-in professional collaboration network. " +
        "Identify the people, credentials, institutional relationships, and operating capabilities this project is missing. " +
        "Do not provide legal, financial, medical, or credential verification. Do not recommend bypassing regulation. " +
        "Return exactly one JSON object with this shape and no markdown: " +
        '{"project_stage":"idea|prototype|beta|revenue|growth|regulated_pilot","industry":"...","existing_capabilities":["..."],"missing_capabilities":[{"capability":"...","priority":"critical|high|medium|low","relationship":"cofounder|advisor|paid_contractor|employee|equity_collaborator|institutional_partner|open_to_discussion","reason":"...","credential_or_jurisdiction":"..."}],"suggested_public_summary":"...","suggested_private_summary":"...","suggested_compensation":["paid|equity|paid_plus_equity|advisory|volunteer|open_to_discussion"],"questions":["..."]}. ' +
        "Keep every statement grounded in the supplied project context.\n\nPROJECT CONTEXT:\n" +
        JSON.stringify(context),
    });

    const generated: any = parseJson(raw);
    const missing = Array.isArray(generated?.missing_capabilities)
      ? generated.missing_capabilities.slice(0, 20).map((item: any) => ({
          capability: text(item?.capability, 160),
          priority: enumValue(item?.priority, ["critical", "high", "medium", "low"], "medium"),
          relationship: enumValue(item?.relationship, RELATIONSHIP_TYPES, "open_to_discussion"),
          reason: text(item?.reason, 800),
          credential_or_jurisdiction: text(item?.credential_or_jurisdiction, 240),
        })).filter((item: any) => item.capability)
      : [];

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      analysis: {
        project_stage: enumValue(generated?.project_stage, PROJECT_STAGES, "idea"),
        industry: text(generated?.industry, 100, context.category || "Other"),
        existing_capabilities: list(generated?.existing_capabilities, 20, 160),
        missing_capabilities: missing,
        suggested_public_summary: text(generated?.suggested_public_summary, 2000, context.description),
        suggested_private_summary: text(generated?.suggested_private_summary, 5000, context.founder_notes),
        suggested_compensation: enumList(generated?.suggested_compensation, COMPENSATION_TYPES, 10),
        questions: list(generated?.questions, 12, 500),
      },
      project: project ? { id: project.id, title: text(project.title, 100) } : null,
      advisory_only: true,
      credential_verification_performed: false,
      regulatory_classification_performed: false,
      may_use_integration_credits: true,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
