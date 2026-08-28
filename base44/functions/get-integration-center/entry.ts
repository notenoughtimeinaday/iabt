import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { requireUser } from "../../shared/creation.ts";

function configured(name: string) {
  return Boolean(String(secrets.get(name) || "").trim());
}

function enabled(name: string) {
  return /^(1|true|yes|on)$/i.test(String(secrets.get(name) || "").trim());
}

const CATALOG = [
  {
    id: "github",
    name: "GitHub",
    category: "Development",
    description: "Repositories, commits, branches, pull requests, releases, and deployment handoff.",
    auth_method: "oauth",
    customer_cost: "Your GitHub account",
    managed_supported: false,
    setup_prompt: "Connect my GitHub account to this IABT project with the minimum repository permissions required.",
  },
  {
    id: "stripe_commerce",
    name: "Stripe for project commerce",
    category: "Payments",
    description: "Let a generated store accept payments into the project owner's Stripe account.",
    auth_method: "oauth",
    customer_cost: "Your Stripe processing fees",
    managed_supported: false,
    setup_prompt: "Connect my own Stripe account to this project for customer checkout. Keep IABT subscription billing separate.",
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "Intelligence",
    description: "Reasoning and tool-enabled AI for generated projects through a server-side credential.",
    auth_method: "api_key",
    customer_cost: "Your OpenAI API usage",
    managed_supported: true,
    setup_prompt: "Configure OpenAI for this project using my provider account and keep the API key server-side.",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "Audio",
    description: "Playable voice and music generation when the connected account and selected model support it.",
    auth_method: "api_key",
    customer_cost: "Your ElevenLabs credits",
    managed_supported: true,
    setup_prompt: "Configure ElevenLabs for this project using my account, verify the subscription supports the requested audio, and run a preflight before quoting.",
  },
  {
    id: "luma",
    name: "Luma",
    category: "Video",
    description: "Video generation through a funded provider account with a verified production preflight.",
    auth_method: "api_key",
    customer_cost: "Your Luma provider balance",
    managed_supported: true,
    setup_prompt: "Configure Luma for this project using my account and verify authentication, balance readiness, and output requirements before quoting.",
  },
  {
    id: "dns",
    name: "Domains and DNS",
    category: "Publishing",
    description: "Guided domain connection and DNS changes through a scoped provider authorization.",
    auth_method: "scoped_token",
    customer_cost: "Your registrar or DNS provider",
    managed_supported: false,
    setup_prompt: "Help me connect a domain to this project using the safest scoped DNS authorization available. Show the exact records before any change.",
  },
];

function managedStatus(provider: string) {
  if (provider === "openai") {
    return configured("OPENAI_API_KEY") ? "available" : "setup_required";
  }
  if (provider === "elevenlabs") {
    const ready = configured("ELEVENLABS_API_KEY") &&
      enabled("IABT_ENABLE_PAID_AUDIO") &&
      enabled("IABT_AUDIO_BILLING_READY");
    return ready ? "available" : "setup_required";
  }
  if (provider === "luma") {
    const ready = configured("LUMA_AGENTS_API_KEY") &&
      enabled("IABT_ENABLE_PAID_MEDIA") &&
      enabled("IABT_MEDIA_BILLING_READY");
    return ready ? "available" : "setup_required";
  }
  return "not_supported";
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    const rows = await base44.asServiceRole.entities.IntegrationConnection
      .filter({ user_id: user.id }, "-updated_date", 50)
      .catch(() => []);
    const byProvider = new Map((Array.isArray(rows) ? rows : []).map((row: any) => [row.provider, row]));

    const providers = CATALOG.map((item) => {
      const row: any = byProvider.get(item.id);
      const preference = row?.connection_mode || "not_selected";
      const managed = managedStatus(item.id);
      const selectedStatus = preference === "iabt_managed"
        ? managed === "available" ? "ready" : "setup_required"
        : preference === "customer_account"
          ? row?.status || "setup_required"
          : "not_selected";

      return {
        ...item,
        preference,
        status: selectedStatus,
        connection_status: row?.status || "not_connected",
        cost_owner: preference === "iabt_managed" ? "iabt" : preference === "customer_account" ? "customer" : "not_selected",
        managed_status: managed,
        external_account_label: row?.external_account_label || "",
        scopes: Array.isArray(row?.scopes) ? row.scopes : [],
        last_health_at: row?.last_health_at || null,
        setup_requires_user_authorization: true,
      };
    });

    const stripeBillingReady = configured("STRIPE_SECRET_KEY") &&
      configured("STRIPE_WEBHOOK_SECRET");

    return Response.json({
      ok: true,
      providers,
      iabt_billing: {
        name: "IABT plans and credits",
        merchant: "Insured Spending, LLC",
        provider: "Stripe",
        status: stripeBillingReady ? "configured" : "setup_required",
        separation_rule: "This account collects IABT subscription and credit revenue. It is never copied into a generated project.",
      },
      security: {
        credentials_in_prompts: false,
        credentials_in_frontend: false,
        credentials_in_artifacts: false,
        external_authorization_required: true,
        note: "JERICHO may plan and verify a connection, but OAuth consent, identity checks, provider terms, spending approval, and DNS changes remain deliberate user actions.",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
