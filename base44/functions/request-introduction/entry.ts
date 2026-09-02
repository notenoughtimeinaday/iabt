import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  DISCLOSURE_FIELDS,
  EXCHANGE_VERSION,
  activeBlockExists,
  auditExchange,
  enumList,
  profileCard,
  sanitizeMessage,
  text,
} from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const matchId = text(body?.match_id, 200);
    if (!matchId) return Response.json({ error: "match_id is required." }, { status: 400 });

    const service = base44.asServiceRole;
    const match = await service.entities.MatchRecord.get(matchId).catch(() => null);
    if (!match || (String(match.owner_user_id || "") !== String(user.id) && user.role !== "admin")) {
      return Response.json({ error: "Match not found or access denied." }, { status: 404 });
    }
    if (!["suggested", "saved"].includes(match.status)) {
      return Response.json({ error: "This match cannot receive a new introduction request in its current state." }, { status: 400 });
    }

    const [need, requesterProfiles, recipientProfile] = await Promise.all([
      service.entities.ProjectNeed.get(match.project_need_id).catch(() => null),
      service.entities.CollaborationProfile.filter({ user_id: user.id }, "-updated_at", 1).catch(() => []),
      service.entities.CollaborationProfile.get(match.candidate_profile_id).catch(() => null),
    ]);
    const requesterProfile = requesterProfiles?.[0] || null;
    if (!need || !requesterProfile || !recipientProfile) {
      return Response.json({ error: "The project need or one of the collaboration profiles is unavailable." }, { status: 409 });
    }
    if (recipientProfile.status !== "active") {
      return Response.json({ error: "This collaborator is no longer available for introductions." }, { status: 409 });
    }
    if (await activeBlockExists(service, user.id, recipientProfile.user_id)) {
      return Response.json({ error: "An introduction is unavailable between these accounts." }, { status: 403 });
    }

    const existing = await service.entities.IntroductionRequest
      .filter({ match_id: match.id }, "-requested_at", 10)
      .catch(() => []);
    if ((existing || []).some((item: any) => ["pending", "accepted"].includes(item.status))) {
      return Response.json({ error: "An active introduction already exists for this match." }, { status: 409 });
    }

    const permittedRequesterFields = new Set(Array.isArray(requesterProfile.contact_disclosure_fields)
      ? requesterProfile.contact_disclosure_fields
      : []);
    const requestedFields = enumList(
      body?.disclosure_fields,
      [...DISCLOSURE_FIELDS, "private_project_summary"],
      10,
    ).filter((field) => field === "private_project_summary" || permittedRequesterFields.has(field));
    const requesterClaims = await service.entities.CredentialClaim
      .filter({ user_id: user.id }, "-submitted_at", 50)
      .catch(() => []);
    const recipientClaims = await service.entities.CredentialClaim
      .filter({ user_id: recipientProfile.user_id }, "-submitted_at", 50)
      .catch(() => []);

    const record = {
      match_id: match.id,
      project_need_id: match.project_need_id,
      requester_user_id: user.id,
      recipient_user_id: recipientProfile.user_id,
      request_message: sanitizeMessage(body?.request_message),
      status: "pending",
      requester_disclosure_consent: true,
      recipient_disclosure_consent: false,
      requester_disclosure_fields: requestedFields,
      recipient_disclosure_fields: [],
      approved_disclosure_fields: [],
      requester_snapshot: profileCard(requesterProfile, requesterClaims),
      recipient_snapshot: profileCard(recipientProfile, recipientClaims),
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const saved = await service.entities.IntroductionRequest.create(record);
    await service.entities.MatchRecord.update(match.id, { status: "introduction_requested" });

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: user.id,
      participant_b_user_id: recipientProfile.user_id,
      event_type: "introduction_requested",
      entity_type: "IntroductionRequest",
      entity_id: saved.id,
      summary: "A mutual-consent introduction was requested.",
      metadata: {
        match_id: match.id,
        project_need_id: match.project_need_id,
        disclosure_field_count: requestedFields.length,
      },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      introduction: {
        id: saved.id,
        status: saved.status,
        request_message: saved.request_message,
        requester_disclosure_fields: saved.requester_disclosure_fields,
        requested_at: saved.requested_at,
        recipient: saved.recipient_snapshot,
        project_need: { id: need.id, title: text(need.title, 160) },
      },
      contact_information_disclosed: false,
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
