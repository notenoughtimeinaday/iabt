import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  auditExchange,
  sanitizeProfileInput,
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

    const existingRows = await service.entities.CollaborationProfile
      .filter({ user_id: user.id }, "-updated_date", 1)
      .catch(() => []);
    const existing = existingRows?.[0] || null;
    const record = sanitizeProfileInput(body, user, existing);
    const saved = existing?.id
      ? await service.entities.CollaborationProfile.update(existing.id, record)
      : await service.entities.CollaborationProfile.create(record);

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: user.id,
      event_type: existing?.id ? "profile_updated" : "profile_created",
      entity_type: "CollaborationProfile",
      entity_id: saved.id,
      summary: existing?.id ? "Collaboration profile updated." : "Collaboration profile created.",
      metadata: {
        visibility: saved.visibility,
        status: saved.status,
        skill_count: Array.isArray(saved.skills) ? saved.skills.length : 0,
      },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      profile: saved,
      disclosure_rule: "Private identity and contact fields are not shown in match results. They are disclosed only through a mutually accepted introduction.",
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
