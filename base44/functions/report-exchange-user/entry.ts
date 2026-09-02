import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  auditExchange,
  enumValue,
  text,
} from "../../shared/exchange.ts";

const REASONS = [
  "spam",
  "harassment",
  "misrepresentation",
  "credential_concern",
  "conflict_of_interest",
  "privacy_concern",
  "fraud_concern",
  "other",
] as const;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const reportedUserId = text(body?.reported_user_id, 200);
    const description = text(body?.description, 5000);
    const roomId = text(body?.room_id, 200);
    const reason = enumValue(body?.reason, REASONS, "other");
    if (!reportedUserId) return Response.json({ error: "reported_user_id is required." }, { status: 400 });
    if (reportedUserId === String(user.id)) return Response.json({ error: "You cannot report your own account." }, { status: 400 });
    if (description.length < 10) return Response.json({ error: "Describe the concern in at least 10 characters." }, { status: 400 });

    const service = base44.asServiceRole;
    if (roomId) {
      const room = await service.entities.CollaborationRoom.get(roomId).catch(() => null);
      const isMember = room && [room.member_a_user_id, room.member_b_user_id].map(String).includes(String(user.id));
      if (!isMember && user.role !== "admin") {
        return Response.json({ error: "The referenced collaboration room was not found or access was denied." }, { status: 404 });
      }
    }

    const saved = await service.entities.ExchangeSafetyReport.create({
      reporter_user_id: user.id,
      reporter_email: user.email,
      reported_user_id: reportedUserId,
      room_id: roomId,
      reason,
      description,
      status: "submitted",
      admin_notes: "",
      created_at: new Date().toISOString(),
    });

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: user.id,
      participant_b_user_id: reportedUserId,
      event_type: "safety_reported",
      entity_type: "ExchangeSafetyReport",
      entity_id: saved.id,
      summary: "An IABT Exchange safety report was submitted for administrator review.",
      metadata: { reason, room_id: roomId },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      report: {
        id: saved.id,
        reason: saved.reason,
        status: saved.status,
        created_at: saved.created_at,
      },
      next_action: "The report is queued for administrator review. Use Block if you also want to stop new introductions and suspend active rooms with this account.",
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
