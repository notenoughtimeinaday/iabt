import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  auditExchange,
  ownsProject,
  sanitizeNeedInput,
  text,
} from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const service = base44.asServiceRole;
    const needId = text(body?.need_id, 200);

    const existing = needId
      ? await service.entities.ProjectNeed.get(needId).catch(() => null)
      : null;
    if (existing && String(existing.owner_user_id || "") !== String(user.id) && user.role !== "admin") {
      return Response.json({ error: "Project need not found or access denied." }, { status: 404 });
    }

    const record = sanitizeNeedInput(body, user, existing);
    if (record.project_id) {
      const project = await service.entities.Project.get(record.project_id).catch(() => null);
      if (!ownsProject(user, project)) {
        return Response.json({ error: "The selected IABT project was not found or is not owned by this account." }, { status: 404 });
      }
    }

    const saved = existing?.id
      ? await service.entities.ProjectNeed.update(existing.id, record)
      : await service.entities.ProjectNeed.create(record);

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: user.id,
      event_type: existing?.id ? "need_updated" : "need_created",
      entity_type: "ProjectNeed",
      entity_id: saved.id,
      summary: existing?.id ? "Collaboration need updated." : "Collaboration need created.",
      metadata: {
        project_id: saved.project_id || "",
        status: saved.status,
        visibility: saved.visibility,
        capability_count: Array.isArray(saved.required_capabilities) ? saved.required_capabilities.length : 0,
      },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      need: saved,
      matching_ready: saved.status === "active" && Array.isArray(saved.required_capabilities) && saved.required_capabilities.length > 0,
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
