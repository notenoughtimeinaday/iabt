import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  auditExchange,
  text,
} from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const targetUserId = text(body?.target_user_id, 200);
    const action = text(body?.action, 20, "block").toLowerCase();
    const reason = text(body?.reason, 500);
    if (!targetUserId) return Response.json({ error: "target_user_id is required." }, { status: 400 });
    if (targetUserId === String(user.id)) return Response.json({ error: "You cannot block your own account." }, { status: 400 });
    if (!new Set(["block", "unblock"]).has(action)) return Response.json({ error: "action must be block or unblock." }, { status: 400 });

    const service = base44.asServiceRole;
    const existingRows = await service.entities.ExchangeBlock
      .filter({ blocker_user_id: user.id, blocked_user_id: targetUserId }, "-created_at", 1)
      .catch(() => []);
    const existing = existingRows?.[0] || null;
    const now = new Date().toISOString();

    let saved;
    if (action === "unblock") {
      if (!existing?.id) return Response.json({ ok: true, status: "not_blocked", charged: false });
      saved = await service.entities.ExchangeBlock.update(existing.id, {
        status: "removed",
        removed_at: now,
      });
      return Response.json({ ok: true, exchange_version: EXCHANGE_VERSION, block: saved, charged: false });
    }

    saved = existing?.id
      ? await service.entities.ExchangeBlock.update(existing.id, {
          reason,
          status: "active",
          created_at: existing.created_at || now,
          removed_at: "",
        })
      : await service.entities.ExchangeBlock.create({
          blocker_user_id: user.id,
          blocked_user_id: targetUserId,
          reason,
          status: "active",
          created_at: now,
        });

    const [outgoing, incoming, roomsForward, roomsReverse] = await Promise.all([
      service.entities.IntroductionRequest.filter({ requester_user_id: user.id, recipient_user_id: targetUserId, status: "pending" }, "-requested_at", 100).catch(() => []),
      service.entities.IntroductionRequest.filter({ requester_user_id: targetUserId, recipient_user_id: user.id, status: "pending" }, "-requested_at", 100).catch(() => []),
      service.entities.CollaborationRoom.filter({ member_a_user_id: user.id, member_b_user_id: targetUserId, status: "active" }, "-created_at", 100).catch(() => []),
      service.entities.CollaborationRoom.filter({ member_a_user_id: targetUserId, member_b_user_id: user.id, status: "active" }, "-created_at", 100).catch(() => []),
    ]);
    for (const intro of [...(outgoing || []), ...(incoming || [])]) {
      await service.entities.IntroductionRequest.update(intro.id, {
        status: "blocked",
        responded_at: now,
        recipient_disclosure_consent: false,
        recipient_disclosure_fields: [],
        approved_disclosure_fields: [],
      }).catch(() => null);
    }
    for (const room of [...(roomsForward || []), ...(roomsReverse || [])]) {
      await service.entities.CollaborationRoom.update(room.id, { status: "suspended" }).catch(() => null);
    }

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: user.id,
      participant_b_user_id: targetUserId,
      event_type: "user_blocked",
      entity_type: "ExchangeBlock",
      entity_id: saved.id,
      summary: "An IABT Exchange account was blocked by another member.",
      metadata: {
        pending_introductions_closed: (outgoing || []).length + (incoming || []).length,
        rooms_suspended: (roomsForward || []).length + (roomsReverse || []).length,
      },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      block: {
        id: saved.id,
        blocked_user_id: saved.blocked_user_id,
        status: saved.status,
        created_at: saved.created_at,
      },
      pending_introductions_closed: (outgoing || []).length + (incoming || []).length,
      rooms_suspended: (roomsForward || []).length + (roomsReverse || []).length,
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
