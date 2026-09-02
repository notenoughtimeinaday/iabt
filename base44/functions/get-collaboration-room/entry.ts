import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  disclosedContact,
  text,
} from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const roomId = text(body?.room_id, 200);
    if (!roomId) return Response.json({ error: "room_id is required." }, { status: 400 });

    const service = base44.asServiceRole;
    const room = await service.entities.CollaborationRoom.get(roomId).catch(() => null);
    if (!room) return Response.json({ error: "Collaboration room not found." }, { status: 404 });
    const isMemberA = String(room.member_a_user_id || "") === String(user.id);
    const isMemberB = String(room.member_b_user_id || "") === String(user.id);
    if (!isMemberA && !isMemberB && user.role !== "admin") {
      return Response.json({ error: "Access denied." }, { status: 403 });
    }

    const otherUserId = isMemberA ? room.member_b_user_id : room.member_a_user_id;
    const [intro, need, messages, ownProfiles, otherProfiles, otherUser] = await Promise.all([
      service.entities.IntroductionRequest.get(room.introduction_request_id).catch(() => null),
      service.entities.ProjectNeed.get(room.project_need_id).catch(() => null),
      service.entities.RoomMessage.filter({ room_id: room.id }, "created_at", 500).catch(() => []),
      service.entities.CollaborationProfile.filter({ user_id: user.id }, "-updated_at", 1).catch(() => []),
      service.entities.CollaborationProfile.filter({ user_id: otherUserId }, "-updated_at", 1).catch(() => []),
      service.entities.User.get(otherUserId).catch(() => null),
    ]);
    if (!intro || intro.status !== "accepted") {
      return Response.json({ error: "This room does not have an accepted introduction." }, { status: 409 });
    }

    const otherProfile = otherProfiles?.[0] || null;
    const ownProfile = ownProfiles?.[0] || null;
    const otherIsRequester = String(intro.requester_user_id || "") === String(otherUserId);
    const otherFields = otherIsRequester
      ? (Array.isArray(intro.requester_disclosure_fields) ? intro.requester_disclosure_fields : [])
      : (Array.isArray(intro.recipient_disclosure_fields) ? intro.recipient_disclosure_fields : []);
    const canSeePrivateSummary = otherIsRequester &&
      Array.isArray(intro.requester_disclosure_fields) &&
      intro.requester_disclosure_fields.includes("private_project_summary");
    const aliases = room.member_aliases || {};

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      room: {
        id: room.id,
        status: room.status,
        project_id: room.project_id || "",
        project_need_id: room.project_need_id,
        created_at: room.created_at || room.created_date || null,
        last_message_at: room.last_message_at || null,
        current_user_alias: aliases[String(user.id)] || ownProfile?.public_alias || "You",
        other_user_id: String(otherUserId || ""),
        other_alias: aliases[String(otherUserId)] || otherProfile?.public_alias || "Collaborator",
      },
      project_need: need ? {
        id: need.id,
        title: text(need.title, 160),
        public_summary: text(need.public_summary, 2000),
        private_summary: canSeePrivateSummary ? text(need.private_summary, 5000) : "",
        required_capabilities: Array.isArray(need.required_capabilities) ? need.required_capabilities : [],
        industry: text(need.industry, 100),
      } : null,
      other_contact: disclosedContact(otherProfile, otherUser, otherFields),
      messages: (messages || []).map((message: any) => ({
        id: message.id,
        sender_user_id: message.sender_user_id,
        sender_alias: text(message.sender_alias, 80, "Member"),
        message: text(message.message, 5000),
        attachment_ids: Array.isArray(message.attachment_ids) ? message.attachment_ids : [],
        created_at: message.created_at || message.created_date || null,
        edited_at: message.edited_at || null,
        status: message.status,
        mine: String(message.sender_user_id || "") === String(user.id),
      })),
      privacy: {
        contact_fields_disclosed_by_other_member: otherFields,
        disclosure_is_mutual_consent_based: true,
      },
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
