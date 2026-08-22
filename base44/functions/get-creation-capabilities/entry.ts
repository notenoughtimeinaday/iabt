import { createClientFromRequest } from "npm:@base44/sdk";
import {
  CREATION_PRICING_VERSION,
  getCreationCapabilities,
  getMediaReadiness,
  publicCapability,
  requireUser,
} from "../../shared/creation.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    await requireUser(base44);

    return Response.json({
      ok: true,
      pricing_version: CREATION_PRICING_VERSION,
      capabilities: getCreationCapabilities().map(publicCapability),
      media: getMediaReadiness(),
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
