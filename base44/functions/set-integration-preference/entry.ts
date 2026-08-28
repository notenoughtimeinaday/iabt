import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";

const PROVIDERS = new Set([
  "github",
  "stripe_commerce",
  "openai",
  "elevenlabs",
  "luma",
  "dns",
]);
const MODES = new Set(["customer_account", "iabt_managed", "not_selected"]);
const MANAGED = new Set(["openai", "elevenlabs", "luma"]);

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const provider = String(body?.provider || "").trim().toLowerCase();
    const connectionMode = String(body?.connection_mode || "").trim().toLowerCase();

    if (!PROVIDERS.has(provider)) {
      return Response.json({ error: "Unsupported integration provider." }, { status: 400 });
    }
    if (!MODES.has(connectionMode)) {
      return Response.json({ error: "Unsupported connection mode." }, { status: 400 });
    }
    if (connectionMode === "iabt_managed" && !MANAGED.has(provider)) {
      return Response.json({ error: "This integration requires the project owner's account." }, { status: 400 });
    }

    const existing = await base44.asServiceRole.entities.IntegrationConnection
      .filter({ user_id: user.id, provider }, "-updated_date", 1)
      .catch(() => []);
    const authMethod = provider === "github" || provider === "stripe_commerce"
      ? "oauth"
      : provider === "dns"
        ? "scoped_token"
        : connectionMode === "iabt_managed"
          ? "platform_managed"
          : "api_key";
    const status = connectionMode === "not_selected"
      ? "not_connected"
      : connectionMode === "iabt_managed"
        ? "connected"
        : "setup_required";
    const record = {
      user_id: user.id,
      user_email: user.email,
      provider,
      connection_mode: connectionMode,
      status,
      auth_method: authMethod,
      cost_owner: connectionMode === "iabt_managed" ? "iabt" : "customer",
      metadata: {
        credential_stored: false,
        selection_only: true,
        updated_from: "integration_center",
      },
    };

    const saved = existing?.[0]?.id
      ? await base44.asServiceRole.entities.IntegrationConnection.update(existing[0].id, record)
      : await base44.asServiceRole.entities.IntegrationConnection.create(record);

    return Response.json({
      ok: true,
      connection: {
        id: saved.id,
        provider: saved.provider,
        connection_mode: saved.connection_mode,
        status: saved.status,
        auth_method: saved.auth_method,
        cost_owner: saved.cost_owner,
      },
      next_action: connectionMode === "customer_account"
        ? "Start the provider-specific authorization from the Integration Center or ask JERICHO to guide the setup."
        : connectionMode === "iabt_managed"
          ? "JERICHO will use the IABT-managed route only when its readiness, cost, commercial, and approval gates pass."
          : "No provider route is selected.",
      credentials_changed: false,
      charged: false,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
