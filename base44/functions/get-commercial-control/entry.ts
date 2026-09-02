import { createClientFromRequest } from "npm:@base44/sdk";
import { getMediaReadiness, requireUser } from "../../shared/creation.ts";
import { commercialControlSnapshot } from "../../shared/commercial-governance.ts";
import { getStripeReadiness } from "../../shared/stripe.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (user.role !== "admin") {
      return Response.json({ error: "Administrator access required." }, { status: 403 });
    }

    const [commercial, policyAcceptances] = await Promise.all([
      commercialControlSnapshot(base44),
      base44.asServiceRole.entities.PolicyAcceptance.list("-accepted_at", 1000),
    ]);
    const billing = getStripeReadiness();
    const media = getMediaReadiness();
    const approvedAgreements = (commercial.agreements || []).filter((item: any) =>
      ["standard_terms_approved", "contract_approved"].includes(String(item.status || ""))
    );
    const pendingAgreements = (commercial.agreements || []).filter((item: any) =>
      String(item.status || "") === "pending_review"
    );

    return Response.json({
      ok: true,
      generated_at: new Date().toISOString(),
      billing,
      media,
      commercial,
      acceptance: {
        policy_version: "2026-09-01.1",
        recorded_count: policyAcceptances.length,
      },
      readiness: {
        legal_center_built: true,
        policy_acceptance_gate_built: true,
        stripe_code_ready: true,
        stripe_live_ready: billing.mode === "live" && billing.ready,
        paid_media_commercial_gate_approved: media.commercial_approved,
        approved_provider_agreements: approvedAgreements.length,
        pending_provider_agreements: pendingAgreements.length,
        production_launch_ready:
          billing.mode === "live" &&
          billing.ready &&
          approvedAgreements.length > 0 &&
          media.commercial_approved,
      },
      required_owner_actions: [
        "Have licensed counsel review the launch policy set and supply the final legal entity, address, governing law, and privacy/support contacts.",
        "Keep Stripe in test mode until test checkout, webhook, cancellation, refund, tax, and credit-restoration scenarios pass.",
        "Approve a supplier only after embedded use, white-label rights, commercial output rights, privacy/DPA, billing, failure treatment, and spend limits are documented.",
        "Set the supplier commercial-approval secret only after the matching ProviderAgreement record is approved.",
        "Do not enable broad paid production until the dashboard reports all launch gates ready.",
      ],
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Could not load commercial controls.";
    return Response.json({ error: message }, { status: 500 });
  }
});
