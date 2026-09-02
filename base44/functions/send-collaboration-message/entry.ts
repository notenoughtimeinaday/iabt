import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  activeBlockExists,
  auditExchange,
  sanitizeMessage,
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
    if (room.status !== "active") return Response.json({ error: "This collaboration room is not active." }, { status: 409 });

    const isMemberA = String(room.member_a_user_id || "") === String(user.id);
    const isMemberB = String(room.member_b_user_id || "") === String(user.id);
    if (!isMemberA && !isMemberB && user.role !== "admin") {
      return Response.json({ error: "Access denied." }, { status: 403 });
    }
    const recipientUserId = isMemberA ? room.member_b_user_id : room.member_a_user_id;
    if (await activeBlockExists(service, user.id, recipientUserId)) {
      return Response.json({ error: "Messaging is unavailable between these accounts." }, { status: 403 });
    }

    const profiles = await service.entities.CollaborationProfile
      .filter({ user_id: user.id }, "-updated_at", 1)
      .catch(() => []);
    const profile = profiles?.[0] || null;
    const messageText = sanitizeMessage(body?.message);
    const attachmentIds = Array.isArray(body?.attachment_ids)
      ? body.attachment_ids.map((item: unknown) => text(item, 200)).filter(Boolean).slice(0, 10)
      : [];
    const now = new Date().toISOString();

    const saved = await service.entities.RoomMessage.create({
      room_id: room.id,
      sender_user_id: user.id,
      sender_alias: text(profile?.public_alias, 80, user.full_name || "Member"),
      recipient_user_id: recipientUserId,
      message: messageText,
      attachment_ids: attachmentIds,
      created_at: now,
      status: "sent",
    });
    await service.entities.CollaborationRoom.update(room.id, { last_message_at: now });
    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: room.member_a_user_id,
      participant_b_user_id: room.member_b_user_id,
      event_type: "message_sent",
      entity_type: "RoomMessage",
      entity_id: saved.id,
      summary: "A message was sent in a private collaboration room.",
      metadata: { room_id: room.id, attachment_count: attachmentIds.length },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      message: {
        id: saved.id,
        sender_user_id: saved.sender_user_id,
        sender_alias: saved.sender_alias,
        message: saved.message,
        attachment_ids: saved.attachment_ids || [],
        created_at: saved.created_at,
        status: saved.status,
        mine: true,
      },
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
