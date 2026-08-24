import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function Status({ ready, children }) {
  return <span className={ready ? "iabt-control-status is-ready" : "iabt-control-status is-blocked"}>{ready ? <CheckCircle2 /> : <AlertTriangle />}{children}</span>;
}

export default function AdminCompliance() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await base44.functions.invoke("get-commercial-control", {});
      const payload = response?.data || response;
      if (payload?.error) throw new Error(payload.error);
      setData(payload);
      setState("ready");
    } catch (loadError) {
      setError(loadError.response?.data?.error || loadError.message || "Could not load commercial controls.");
      setState("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (user?.role !== "admin") {
    return <div className="iabt-control-denied"><ShieldCheck /><h1>Administrator access required</h1><p>This dashboard contains confidential supplier terms and internal unit economics.</p><Link to="/">Return to IABT</Link></div>;
  }

  if (state === "loading") {
    return <div className="iabt-control-denied"><Loader2 className="animate-spin" /><h1>Loading commercial controls…</h1></div>;
  }

  if (state === "error") {
    return <div className="iabt-control-denied"><AlertTriangle /><h1>Control Center unavailable</h1><p>{error}</p><Button onClick={load}>Try again</Button></div>;
  }

  const policy = data?.commercial?.default_policy || {};
  const agreements = data?.commercial?.agreements || [];
  const spend = data?.commercial?.spend || {};
  const readiness = data?.readiness || {};

  return (
    <div className="iabt-control-page">
      <header className="iabt-control-header">
        <div><p className="iabt-eyebrow"><ShieldCheck /> Owner-only operations</p><h1>Profit & Compliance Control Center</h1><span>Supplier admission, margin floors, spending limits, billing readiness, and launch gates.</span></div>
        <div><Link to="/"><ArrowLeft /> Dashboard</Link><Link to="/legal"><FileCheck2 /> Legal Center</Link><Button variant="outline" onClick={load}><RefreshCw /> Refresh</Button></div>
      </header>

      <main className="iabt-control-main">
        <section className="iabt-control-grid">
          <article><CircleDollarSign /><span>Target production margin</span><strong>{Math.round(Number(policy.target_margin_bps || 0) / 100)}%</strong><small>{Math.round(Number(policy.minimum_margin_bps || 0) / 100)}% hard floor</small></article>
          <article><Gauge /><span>Daily supplier ceiling</span><strong>{money(policy.daily_spend_limit_cents)}</strong><small>{money(spend.daily_committed_cents)} committed today</small></article>
          <article><Gauge /><span>Monthly supplier ceiling</span><strong>{money(policy.monthly_spend_limit_cents)}</strong><small>{money(spend.monthly_committed_cents)} committed in {spend.month_key}</small></article>
          <article><ShieldCheck /><span>Approved agreements</span><strong>{readiness.approved_provider_agreements || 0}</strong><small>{readiness.pending_provider_agreements || 0} awaiting review</small></article>
        </section>

        <section className="iabt-control-panel">
          <div className="iabt-control-panel-title"><div><h2>Launch gates</h2><p>No single switch can bypass these commercial safeguards.</p></div><Status ready={readiness.production_launch_ready}>{readiness.production_launch_ready ? "Production ready" : "Paid launch blocked"}</Status></div>
          <div className="iabt-control-gates">
            <div><Status ready={readiness.legal_center_built}>Legal Center built</Status><span>Final counsel and verified contact details remain external launch requirements.</span></div>
            <div><Status ready={readiness.policy_acceptance_gate_built}>Policy acceptance gate</Status><span>{data?.acceptance?.recorded_count || 0} acceptance records for policy {data?.acceptance?.policy_version}.</span></div>
            <div><Status ready={readiness.stripe_live_ready}>Stripe live readiness</Status><span>Mode: {data?.billing?.mode || "test"} · configuration {data?.billing?.ready ? "complete" : "incomplete"}.</span></div>
            <div><Status ready={readiness.paid_media_commercial_gate_approved}>Paid-media commercial approval</Status><span>The production secret remains disabled until a matching supplier agreement is approved.</span></div>
          </div>
        </section>

        <section className="iabt-control-panel">
          <div className="iabt-control-panel-title"><div><h2>Supplier agreements</h2><p>Only approved suppliers with embedded use, output rights, privacy terms, and white-label permission may execute paid work.</p></div><Unplug /></div>
          {agreements.length ? (
            <div className="iabt-control-table">
              <div className="iabt-control-row is-head"><span>Supplier</span><span>Status</span><span>Billing</span><span>Rights</span><span>Review</span></div>
              {agreements.map((agreement) => (
                <div className="iabt-control-row" key={agreement.id}>
                  <span><strong>{agreement.display_name}</strong><small>{agreement.service_category}</small></span>
                  <span><Status ready={["standard_terms_approved", "contract_approved"].includes(agreement.status)}>{String(agreement.status || "").replaceAll("_", " ")}</Status></span>
                  <span>{String(agreement.billing_mode || "unknown").replaceAll("_", " ")}</span>
                  <span>{agreement.embedded_use_allowed && agreement.white_label_allowed && agreement.commercial_output_allowed ? "Documented" : "Incomplete"}</span>
                  <span>{agreement.next_review_at ? new Date(agreement.next_review_at).toLocaleDateString() : "Not scheduled"}</span>
                </div>
              ))}
            </div>
          ) : <div className="iabt-control-empty"><AlertTriangle /><strong>No supplier has been admitted.</strong><span>Paid third-party production remains blocked.</span></div>}
        </section>

        <section className="iabt-control-panel">
          <div className="iabt-control-panel-title"><div><h2>Default commercial policy</h2><p>Customer prices are expressed in IABT credits. Wholesale supplier economics stay private.</p></div><span className="iabt-control-version">{data?.commercial?.policy_version}</span></div>
          <div className="iabt-control-policy">
            <div><span>Production credit retail value</span><strong>{money(policy.retail_credit_value_cents)} / credit</strong></div>
            <div><span>Maximum supplier cost represented</span><strong>{money(policy.provider_cost_per_credit_cents)} / credit</strong></div>
            <div><span>Maximum ordinary job cost</span><strong>{money(policy.maximum_job_cost_cents)}</strong></div>
            <div><span>Production funding source</span><strong>{policy.purchased_credits_required ? "Purchased credits only" : "Paid-plan allowance + purchased overage"}</strong></div>
          </div>
        </section>

        <section className="iabt-control-panel">
          <div className="iabt-control-panel-title"><div><h2>Required owner actions</h2><p>AI can prepare, monitor, compare, and administer these tasks; binding legal or financial approval stays with the owner.</p></div></div>
          <ol className="iabt-control-actions">{(data?.required_owner_actions || []).map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol>
        </section>
      </main>
    </div>
  );
}
