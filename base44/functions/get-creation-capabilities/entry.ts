import { createClientFromRequest } from "npm:@base44/sdk";
import {
  CREATION_PRICING_VERSION,
  getAudioReadiness,
  getCreationCapabilities,
  getMediaReadiness,
  publicCapability,
  requireUser,
  verifyElevenLabsAuthentication,
} from "../../shared/creation.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const ownerDemoRequested = user.role === "admin";

    const media = getMediaReadiness();
    const audio = getAudioReadiness();
    const audioProvider = audio.audio_technical_ready
      ? await verifyElevenLabsAuthentication()
      : { checked: false, authenticated: false, status: 0, error_code: "audio_technical_setup_incomplete" };
    const audioAuthenticated = audioProvider.authenticated === true;
    return Response.json({
      ok: true,
      pricing_version: CREATION_PRICING_VERSION,
      capabilities: getCreationCapabilities({
        ownerDemo: ownerDemoRequested,
        audioAuthenticated,
      }).map(publicCapability),
      media: {
        renderer_connection_configured: media.luma_key_configured,
        paid_production_enabled: media.paid_media_enabled,
        billing_ready: media.media_billing_ready,
        commercial_approved: media.commercial_approved,
        technical_ready: media.luma_technical_ready,
        commercial_ready: media.luma_commercial_ready,
        owner_demo_ready: ownerDemoRequested && media.luma_technical_ready,
        render_ready: media.luma_ready || (ownerDemoRequested && media.luma_technical_ready),
        blocker_codes: media.blocker_codes,
      },
      audio: {
        renderer_connection_configured: audio.api_key_configured,
        paid_production_enabled: audio.paid_audio_enabled,
        billing_ready: audio.billing_ready,
        commercial_approved: audio.commercial_approved,
        cost_policy_configured: audio.cost_policy_configured,
        technical_ready: audio.audio_technical_ready && audioAuthenticated,
        commercial_ready: audio.audio_commercial_ready && audioAuthenticated,
        owner_demo_ready: ownerDemoRequested && audio.audio_technical_ready && audioAuthenticated,
        render_ready: audioAuthenticated && (audio.audio_ready || (ownerDemoRequested && audio.audio_technical_ready)),
        provider_authentication_checked: audioProvider.checked,
        provider_authenticated: audioAuthenticated,
        provider_status: audioProvider.status,
        blocker_codes: Array.from(new Set([
          ...audio.blocker_codes,
          ...(audioProvider.error_code ? [audioProvider.error_code] : []),
        ])),
      },
      billing: {
        card_charged: false,
        credits_deducted: false,
        action: "none",
        note: "Capability discovery and planning never charge a card or deduct IABT credits.",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
