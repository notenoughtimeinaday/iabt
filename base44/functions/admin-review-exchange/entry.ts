import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  EXCHANGE_VERSION,
  auditExchange,
  enumValue,
  text,
} from "../../shared/exchange.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (user.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const action = text(body?.action, 80).toLowerCase();
    const service = base44.asServiceRole;
    const now = new Date().toISOString();

    if (action === "review_credential") {
      const claimId = text(body?.claim_id, 200);
      const decision = enumValue(body?.decision, ["verified", "rejected"], "rejected");
      const method = enumValue(body?.verification_method, ["document_review", "official_registry", "organization_confirmation", "manual_review"], "manual_review");
      const claim = await service.entities.CredentialClaim.get(claimId).catch(() => null);
      if (!claim) return Response.json({ error: "Credential claim not found." }, { status: 404 });
      const updated = await service.entities.CredentialClaim.update(claim.id, {
        verification_status: decision,
        verification_method: method,
        reviewed_by: user.email,
        verified_at: decision === "verified" ? now : "",
      });

      const verifiedClaims = await service.entities.CredentialClaim
        .filter({ user_id: claim.user_id, verification_status: "verified" }, "-verified_at", 50)
        .catch(() => []);
      const profiles = await service.entities.CollaborationProfile
        .filter({ user_id: claim.user_id }, "-updated_at", 1)
        .catch(() => []);
      if (profiles?.[0]?.id) {
        const nextLevel = verifiedClaims.length ? "credential_verified" : profiles[0].verification_level;
        await service.entities.CollaborationProfile.update(profiles[0].id, {
          verification_level: nextLevel,
          updated_at: now,
        });
      }

      await auditExchange(service, {
        actor_user_id: user.id,
        participant_a_user_id: claim.user_id,
        event_type: "credential_reviewed",
        entity_type: "CredentialClaim",
        entity_id: claim.id,
        summary: `A credential claim was ${decision}.`,
        metadata: { decision, verification_method: method },
      });
      return Response.json({ ok: true, exchange_version: EXCHANGE_VERSION, result: updated, charged: false });
    }

    if (action === "resolve_report") {
      const reportId = text(body?.report_id, 200);
      const decision = enumValue(body?.decision, ["reviewing", "action_taken", "dismissed", "resolved"], "resolved");
      const report = await service.entities.ExchangeSafetyReport.get(reportId).catch(() => null);
      if (!report) return Response.json({ error: "Safety report not found." }, { status: 404 });
      const updated = await service.entities.ExchangeSafetyReport.update(report.id, {
        status: decision,
        admin_notes: text(body?.admin_notes, 5000),
        resolved_at: ["action_taken", "dismissed", "resolved"].includes(decision) ? now : "",
      });
      if (body?.suspend_profile === true && report.reported_user_id) {
        const profiles = await service.entities.CollaborationProfile
          .filter({ user_id: report.reported_user_id }, "-updated_at", 1)
          .catch(() => []);
        if (profiles?.[0]?.id) {
          await service.entities.CollaborationProfile.update(profiles[0].id, {
            status: "suspended",
            visibility: "private",
            updated_at: now,
          });
        }
      }
      return Response.json({ ok: true, exchange_version: EXCHANGE_VERSION, result: updated, charged: false });
    }

    if (action === "set_profile_status") {
      const profileId = text(body?.profile_id, 200);
      const status = enumValue(body?.status, ["active", "paused", "suspended"], "paused");
      const profile = await service.entities.CollaborationProfile.get(profileId).catch(() => null);
      if (!profile) return Response.json({ error: "Collaboration profile not found." }, { status: 404 });
      const updated = await service.entities.CollaborationProfile.update(profile.id, {
        status,
        visibility: status === "suspended" ? "private" : profile.visibility,
        updated_at: now,
      });
      return Response.json({ ok: true, exchange_version: EXCHANGE_VERSION, result: updated, charged: false });
    }

    return Response.json({ error: "Unsupported administrator action." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
