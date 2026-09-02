import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  DISCLOSURE_FIELDS,
  EXCHANGE_VERSION,
  activeBlockExists,
  auditExchange,
  enumList,
  text,
} from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const introductionId = text(body?.introduction_id, 200);
    const action = text(body?.action, 40).toLowerCase();
    if (!introductionId) return Response.json({ error: "introduction_id is required." }, { status: 400 });
    if (!["accept", "decline", "withdraw"].includes(action)) {
      return Response.json({ error: "action must be accept, decline, or withdraw." }, { status: 400 });
    }

    const service = base44.asServiceRole;
    const intro = await service.entities.IntroductionRequest.get(introductionId).catch(() => null);
    if (!intro) return Response.json({ error: "Introduction not found." }, { status: 404 });

    const isRequester = String(intro.requester_user_id || "") === String(user.id);
    const isRecipient = String(intro.recipient_user_id || "") === String(user.id);
    if (!isRequester && !isRecipient && user.role !== "admin") {
      return Response.json({ error: "Access denied." }, { status: 403 });
    }
    if (action === "withdraw" && !isRequester && user.role !== "admin") {
      return Response.json({ error: "Only the requester can withdraw this introduction." }, { status: 403 });
    }
    if (["accept", "decline"].includes(action) && !isRecipient && user.role !== "admin") {
      return Response.json({ error: "Only the recipient can respond to this introduction." }, { status: 403 });
    }
    if (intro.status !== "pending") {
      return Response.json({ error: "This introduction has already been resolved." }, { status: 409 });
    }

    if (action === "withdraw") {
      const updated = await service.entities.IntroductionRequest.update(intro.id, {
        status: "withdrawn",
        withdrawn_at: new Date().toISOString(),
      });
      await service.entities.MatchRecord.update(intro.match_id, { status: "saved" }).catch(() => null);
      await auditExchange(service, {
        actor_user_id: user.id,
        participant_a_user_id: intro.requester_user_id,
        participant_b_user_id: intro.recipient_user_id,
        event_type: "introduction_withdrawn",
        entity_type: "IntroductionRequest",
        entity_id: intro.id,
        summary: "The introduction request was withdrawn.",
        metadata: {},
      });
      return Response.json({ ok: true, exchange_version: EXCHANGE_VERSION, introduction: updated, room: null, charged: false });
    }

    if (action === "decline") {
      const updated = await service.entities.IntroductionRequest.update(intro.id, {
        status: "declined",
        recipient_disclosure_consent: false,
        recipient_disclosure_fields: [],
        approved_disclosure_fields: [],
        responded_at: new Date().toISOString(),
      });
      await service.entities.MatchRecord.update(intro.match_id, { status: "dismissed" }).catch(() => null);
      await auditExchange(service, {
        actor_user_id: user.id,
        participant_a_user_id: intro.requester_user_id,
        participant_b_user_id: intro.recipient_user_id,
        event_type: "introduction_declined",
        entity_type: "IntroductionRequest",
        entity_id: intro.id,
        summary: "The introduction request was declined without disclosing contact information.",
        metadata: {},
      });
      return Response.json({ ok: true, exchange_version: EXCHANGE_VERSION, introduction: updated, room: null, contact_information_disclosed: false, charged: false });
    }

    if (await activeBlockExists(service, intro.requester_user_id, intro.recipient_user_id)) {
      return Response.json({ error: "This introduction can no longer be accepted." }, { status: 403 });
    }

    const [requesterProfiles, recipientProfiles, existingRooms] = await Promise.all([
      service.entities.CollaborationProfile.filter({ user_id: intro.requester_user_id }, "-updated_at", 1).catch(() => []),
      service.entities.CollaborationProfile.filter({ user_id: intro.recipient_user_id }, "-updated_at", 1).catch(() => []),
      service.entities.CollaborationRoom.filter({ introduction_request_id: intro.id }, "-created_at", 1).catch(() => []),
    ]);
    const requesterProfile = requesterProfiles?.[0] || null;
    const recipientProfile = recipientProfiles?.[0] || null;
    if (!requesterProfile || !recipientProfile) {
      return Response.json({ error: "One of the collaboration profiles is unavailable." }, { status: 409 });
    }

    const recipientAllowed = new Set(Array.isArray(recipientProfile.contact_disclosure_fields)
      ? recipientProfile.contact_disclosure_fields
      : []);
    const recipientFields = enumList(body?.disclosure_fields, DISCLOSURE_FIELDS, 10)
      .filter((field) => recipientAllowed.has(field));
    const requesterFields = enumList(intro.requester_disclosure_fields, DISCLOSURE_FIELDS, 10);
    const approvedFields = [...new Set([...requesterFields, ...recipientFields])];

    const updated = await service.entities.IntroductionRequest.update(intro.id, {
      status: "accepted",
      recipient_disclosure_consent: true,
      recipient_disclosure_fields: recipientFields,
      approved_disclosure_fields: approvedFields,
      responded_at: new Date().toISOString(),
    });

    const aliases: Record<string, string> = {
      [String(intro.requester_user_id)]: text(requesterProfile.public_alias, 80, "Project founder"),
      [String(intro.recipient_user_id)]: text(recipientProfile.public_alias, 80, "Collaborator"),
    };
    const room = existingRooms?.[0] || await service.entities.CollaborationRoom.create({
      introduction_request_id: intro.id,
      project_id: "",
      project_need_id: intro.project_need_id,
      member_a_user_id: intro.requester_user_id,
      member_b_user_id: intro.recipient_user_id,
      member_aliases: aliases,
      status: "active",
      created_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    });
    await service.entities.MatchRecord.update(intro.match_id, { status: "connected" }).catch(() => null);

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: intro.requester_user_id,
      participant_b_user_id: intro.recipient_user_id,
      event_type: "introduction_accepted",
      entity_type: "IntroductionRequest",
      entity_id: intro.id,
      summary: "The introduction was mutually accepted and a private collaboration room was created.",
      metadata: {
        room_id: room.id,
        requester_disclosure_fields: requesterFields,
        recipient_disclosure_fields: recipientFields,
      },
    });
    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: intro.requester_user_id,
      participant_b_user_id: intro.recipient_user_id,
      event_type: "room_created",
      entity_type: "CollaborationRoom",
      entity_id: room.id,
      summary: "A private IABT Exchange collaboration room was created.",
      metadata: { introduction_request_id: intro.id },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      introduction: updated,
      room: {
        id: room.id,
        status: room.status,
        project_need_id: room.project_need_id,
      },
      disclosure: {
        requester_fields: requesterFields,
        recipient_fields: recipientFields,
        contact_details_available_only_inside_room: true,
      },
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
