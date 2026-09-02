import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import { EXCHANGE_VERSION, profileCard, text } from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (user.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
    const service = base44.asServiceRole;

    const [profiles, needs, claims, reports, blocks, intros, rooms, audits] = await Promise.all([
      service.entities.CollaborationProfile.list("-updated_at", 500).catch(() => []),
      service.entities.ProjectNeed.list("-updated_at", 500).catch(() => []),
      service.entities.CredentialClaim.list("-submitted_at", 500).catch(() => []),
      service.entities.ExchangeSafetyReport.list("-created_at", 500).catch(() => []),
      service.entities.ExchangeBlock.filter({ status: "active" }, "-created_at", 500).catch(() => []),
      service.entities.IntroductionRequest.list("-requested_at", 500).catch(() => []),
      service.entities.CollaborationRoom.list("-last_message_at", 500).catch(() => []),
      service.entities.ExchangeAuditEvent.list("-created_at", 200).catch(() => []),
    ]);
    const profilesByUser = new Map((profiles || []).map((profile: any) => [String(profile.user_id || ""), profile]));

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      generated_at: new Date().toISOString(),
      counts: {
        profiles_total: (profiles || []).length,
        profiles_active: (profiles || []).filter((item: any) => item.status === "active").length,
        needs_active: (needs || []).filter((item: any) => item.status === "active").length,
        credentials_pending: (claims || []).filter((item: any) => item.verification_status === "pending").length,
        safety_reports_open: (reports || []).filter((item: any) => ["submitted", "reviewing"].includes(item.status)).length,
        active_blocks: (blocks || []).length,
        introductions_pending: (intros || []).filter((item: any) => item.status === "pending").length,
        rooms_active: (rooms || []).filter((item: any) => item.status === "active").length,
      },
      pending_credentials: (claims || [])
        .filter((item: any) => item.verification_status === "pending")
        .map((claim: any) => ({
          ...claim,
          profile: profilesByUser.get(String(claim.user_id || ""))
            ? profileCard(profilesByUser.get(String(claim.user_id || "")), [])
            : null,
        })),
      open_reports: (reports || [])
        .filter((item: any) => ["submitted", "reviewing"].includes(item.status))
        .map((report: any) => ({
          id: report.id,
          reporter_user_id: report.reporter_user_id,
          reported_user_id: report.reported_user_id,
          room_id: report.room_id || "",
          reason: report.reason,
          description: text(report.description, 5000),
          status: report.status,
          admin_notes: text(report.admin_notes, 5000),
          created_at: report.created_at || report.created_date || null,
          reported_profile: profilesByUser.get(String(report.reported_user_id || ""))
            ? profileCard(profilesByUser.get(String(report.reported_user_id || "")), [])
            : null,
        })),
      recent_audit: (audits || []).slice(0, 100).map((event: any) => ({
        id: event.id,
        event_type: event.event_type,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        summary: text(event.summary, 1000),
        actor_user_id: event.actor_user_id,
        participant_a_user_id: event.participant_a_user_id || "",
        participant_b_user_id: event.participant_b_user_id || "",
        created_at: event.created_at || event.created_date || null,
      })),
      privacy_boundary: "This dashboard is owner-only. Match-safe profiles remain separate from private profile/contact records.",
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
