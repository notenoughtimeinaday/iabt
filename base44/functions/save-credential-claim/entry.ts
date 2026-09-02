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
    const service = base44.asServiceRole;
    const claimId = text(body?.claim_id, 200);

    const existing = claimId
      ? await service.entities.CredentialClaim.get(claimId).catch(() => null)
      : null;
    if (existing && String(existing.user_id || "") !== String(user.id) && user.role !== "admin") {
      return Response.json({ error: "Credential claim not found or access denied." }, { status: 404 });
    }

    const record = {
      user_id: user.id,
      user_email: user.email,
      credential_type: text(body?.credential_type, 160, existing?.credential_type || ""),
      jurisdiction: text(body?.jurisdiction, 120, existing?.jurisdiction || ""),
      issuing_authority: text(body?.issuing_authority, 200, existing?.issuing_authority || ""),
      claim_summary: text(body?.claim_summary, 2000, existing?.claim_summary || ""),
      reference_url: text(body?.reference_url, 500, existing?.reference_url || ""),
      verification_status: "pending",
      verification_method: "manual_review",
      reviewed_by: "",
      submitted_at: existing?.submitted_at || new Date().toISOString(),
      verified_at: "",
      expires_at: text(body?.expires_at, 100, existing?.expires_at || ""),
    };
    if (!record.credential_type || !record.issuing_authority || !record.claim_summary) {
      return Response.json({ error: "Credential type, issuing authority, and claim summary are required." }, { status: 400 });
    }

    const saved = existing?.id
      ? await service.entities.CredentialClaim.update(existing.id, record)
      : await service.entities.CredentialClaim.create(record);

    await auditExchange(service, {
      actor_user_id: user.id,
      participant_a_user_id: user.id,
      event_type: "credential_submitted",
      entity_type: "CredentialClaim",
      entity_id: saved.id,
      summary: "A professional credential claim was submitted for review.",
      metadata: { credential_type: saved.credential_type, jurisdiction: saved.jurisdiction || "" },
    });

    return Response.json({
      ok: true,
      exchange_version: EXCHANGE_VERSION,
      claim: saved,
      verification_notice: "The claim is not verified until an administrator confirms it through an official registry, document review, or issuing organization.",
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
