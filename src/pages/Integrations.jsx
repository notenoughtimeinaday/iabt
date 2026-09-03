import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/iabtClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  CloudCog,
  CreditCard,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  Music2,
  Network,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";

const ICONS = {
  github: Github,
  stripe_commerce: CreditCard,
  openai: Sparkles,
  elevenlabs: Music2,
  luma: Video,
  dns: Network,
};

function readable(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function errorMessage(error) {
  return error?.response?.data?.error || error?.data?.error || error?.message || "The integration preference could not be saved.";
}

function statusCopy(provider) {
  if (provider.status === "ready") return "Ready through the selected route";
  if (provider.status === "setup_required") return "Setup required";
  if (provider.status === "connected") return "Connected";
  if (provider.status === "degraded") return "Connection needs attention";
  return "Choose how this project should connect";
}

export default function Integrations() {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("get-integration-center", {});
      const payload = response?.data || response;
      if (!payload?.ok) throw new Error(payload?.error || "Integration Center is unavailable.");
      setData(payload);
    } catch (error) {
      toast({ title: "Integration Center could not load", description: errorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setPreference(provider, connectionMode) {
    const key = provider.id + ":" + connectionMode;
    setSaving(key);
    try {
      const response = await base44.functions.invoke("set-integration-preference", {
        provider: provider.id,
        connection_mode: connectionMode,
      });
      const payload = response?.data || response;
      if (!payload?.ok) throw new Error(payload?.error || "The connection route was not saved.");
      toast({
        title: connectionMode === "customer_account" ? "Your account selected" : "IABT managed route selected",
        description: payload.next_action,
      });
      await load();
    } catch (error) {
      toast({ title: "Connection route not saved", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving("");
    }
  }

  if (loading && !data) {
    return (
      <div className="integration-loading">
        <Loader2 className="animate-spin" />
        <strong>Checking your integrations</strong>
        <span>No provider is contacted and no credits are used during this check.</span>
      </div>
    );
  }

  return (
    <div className="integration-page">
      <header className="integration-header">
        <Link to="/" className="integration-brand">
          <img src="/iabt-mark.svg" alt="" />
          <span><strong>IABT Integration Center</strong><small>Connections for projects built by JERICHO</small></span>
        </Link>
        <nav>
          <Link to="/studio"><Sparkles /> JERICHO Studio</Link>
          <Link to="/"><ArrowLeft /> Projects</Link>
        </nav>
      </header>

      <main className="integration-main">
        <section className="integration-hero">
          <div>
            <p><PlugZap /> Connect only what the objective needs</p>
            <h1>Your tools, your accounts, clear costs.</h1>
            <span>
              JERICHO can infer the required services from your prompt. Choose whether a supported provider uses
              your account or an available IABT-managed route, then authorize it only when the project needs it.
            </span>
          </div>
          <article>
            <ShieldCheck />
            <div>
              <strong>Credentials stay out of JERICHO</strong>
              <p>Secrets never belong in prompts, generated source, browser storage, deliverables, or logs.</p>
            </div>
          </article>
        </section>

        <section className="integration-billing-separation">
          <CircleDollarSign />
          <div>
            <strong>{data?.iabt_billing?.name || "IABT plans and credits"}</strong>
            <p>{data?.iabt_billing?.merchant || "Insured Spending, LLC"} uses Stripe for IABT revenue.</p>
            <small>{data?.iabt_billing?.separation_rule}</small>
          </div>
          <span className={"integration-status is-" + (data?.iabt_billing?.status || "setup_required")}>
            {readable(data?.iabt_billing?.status || "setup_required")}
          </span>
        </section>

        <section className="integration-grid" aria-label="Available integrations">
          {(data?.providers || []).map((provider) => {
            const Icon = ICONS[provider.id] || CloudCog;
            const selectedCustomer = provider.preference === "customer_account";
            const selectedManaged = provider.preference === "iabt_managed";
            const setupHref = "/studio?setup=" + encodeURIComponent(provider.id);
            return (
              <article key={provider.id} className="integration-card">
                <div className="integration-card-head">
                  <span><Icon /></span>
                  <div>
                    <small>{provider.category}</small>
                    <h2>{provider.name}</h2>
                  </div>
                  <i className={"integration-dot is-" + provider.status} />
                </div>
                <p>{provider.description}</p>
                <dl>
                  <div><dt>Authorization</dt><dd>{readable(provider.auth_method)}</dd></div>
                  <div><dt>Provider cost</dt><dd>{provider.customer_cost}</dd></div>
                  <div><dt>Current state</dt><dd>{statusCopy(provider)}</dd></div>
                </dl>

                <div className="integration-route-buttons">
                  <Button
                    type="button"
                    variant={selectedCustomer ? "default" : "outline"}
                    disabled={Boolean(saving)}
                    onClick={() => setPreference(provider, "customer_account")}
                  >
                    {saving === provider.id + ":customer_account" ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    Use my account
                  </Button>
                  {provider.managed_supported && (
                    <Button
                      type="button"
                      variant={selectedManaged ? "default" : "outline"}
                      disabled={Boolean(saving) || provider.managed_status === "not_supported"}
                      onClick={() => setPreference(provider, "iabt_managed")}
                    >
                      {saving === provider.id + ":iabt_managed" ? <Loader2 className="animate-spin" /> : <CloudCog />}
                      Use IABT managed
                    </Button>
                  )}
                </div>

                <Link className="integration-setup-link" to={setupHref}>
                  <Bot /> Let JERICHO guide setup <ExternalLink />
                </Link>

                <small className="integration-card-note">
                  {provider.preference === "customer_account"
                    ? "Your selection is saved. Provider authorization is still required before JERICHO can act."
                    : provider.preference === "iabt_managed"
                      ? provider.managed_status === "available"
                        ? "The managed route is configured; every paid action still requires an exact quote and approval."
                        : "The managed route needs administrator setup before it can be used."
                      : "No connection or cost commitment has been made."}
                </small>
              </article>
            );
          })}
        </section>

        <section className="integration-boundary">
          <CheckCircle2 />
          <div>
            <strong>What JERICHO handles</strong>
            <p>Intent detection, requirements, least-privilege scopes, preflight checks, cost ownership, verification, recovery, and setup guidance.</p>
          </div>
          <div>
            <strong>What remains yours</strong>
            <p>OAuth consent, identity checks, provider terms, 2FA, purchases, spending approval, domain ownership, and destructive changes.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
