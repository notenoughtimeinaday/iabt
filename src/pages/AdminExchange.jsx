import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/iabtClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import "@/exchange.css";

function payload(response) {
  return response?.data || response;
}

function errorMessage(error) {
  return error?.response?.data?.error || error?.data?.error || error?.message || "The administrator request failed.";
}

function readable(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AdminExchange() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("get-exchange-admin", {});
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Exchange Safety Center is unavailable.");
      setData(next);
    } catch (error) {
      toast({ title: "Safety Center could not load", description: errorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function reviewCredential(claim, decision) {
    const method = decision === "verified"
      ? window.prompt("Verification method: official_registry, document_review, organization_confirmation, or manual_review", "official_registry")
      : "manual_review";
    if (!method) return;
    setWorking("credential:" + claim.id);
    try {
      const response = await base44.functions.invoke("admin-review-exchange", {
        action: "review_credential",
        claim_id: claim.id,
        decision,
        verification_method: method,
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Credential review failed.");
      toast({ title: `Credential ${decision}` });
      await load();
    } catch (error) {
      toast({ title: "Credential review failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function resolveReport(report, decision, suspendProfile = false) {
    const notes = window.prompt("Administrator notes for the audit record:", report.admin_notes || "");
    if (notes == null) return;
    setWorking("report:" + report.id);
    try {
      const response = await base44.functions.invoke("admin-review-exchange", {
        action: "resolve_report",
        report_id: report.id,
        decision,
        admin_notes: notes,
        suspend_profile: suspendProfile,
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Report review failed.");
      toast({ title: suspendProfile ? "Report resolved and profile suspended" : "Safety report updated" });
      await load();
    } catch (error) {
      toast({ title: "Safety review failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  if (user?.role !== "admin") {
    return <div className="exchange-loading"><ShieldCheck /><h1>Administrator access required</h1><p>The Exchange Safety Center contains protected moderation and credential-review information.</p><Link to="/exchange">Return to Exchange</Link></div>;
  }

  if (loading && !data) {
    return <div className="exchange-loading"><Loader2 className="animate-spin" /><h1>Loading Exchange controls…</h1></div>;
  }

  return (
    <div className="exchange-page">
      <header className="exchange-header">
        <Link to="/exchange" className="exchange-brand"><img src="/iabt-mark.svg" alt="" /><span><strong>Exchange Safety Center</strong><small>Owner-only trust, verification, and moderation controls</small></span></Link>
        <nav><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</Button><Button variant="ghost" asChild><Link to="/exchange"><ArrowLeft /> Exchange</Link></Button></nav>
      </header>

      <main className="exchange-admin-main">
        <section className="exchange-admin-hero"><div><p className="exchange-eyebrow"><ShieldCheck /> Owner-only operations</p><h1>Trust without silent disclosure.</h1><p>Review credential claims, investigate safety reports, and audit sensitive Exchange actions. A match score never substitutes for professional verification.</p></div><article><AlertTriangle /><span><strong>Beta boundary</strong><small>No public directory, investment marketplace, pooled funds, or automatic credential approval.</small></span></article></section>

        <section className="exchange-stat-grid">
          <article><UsersRound /><span>Active profiles</span><strong>{data?.counts?.profiles_active || 0}</strong><small>{data?.counts?.profiles_total || 0} total</small></article>
          <article><BadgeCheck /><span>Credentials pending</span><strong>{data?.counts?.credentials_pending || 0}</strong></article>
          <article><AlertTriangle /><span>Open safety reports</span><strong>{data?.counts?.safety_reports_open || 0}</strong></article>
          <article><Inbox /><span>Pending introductions</span><strong>{data?.counts?.introductions_pending || 0}</strong></article>
          <article><MessageSquare /><span>Active rooms</span><strong>{data?.counts?.rooms_active || 0}</strong></article>
          <article><Ban /><span>Active blocks</span><strong>{data?.counts?.active_blocks || 0}</strong></article>
        </section>

        <section className="exchange-panel">
          <div className="exchange-panel-title"><div><p className="exchange-eyebrow">Verification queue</p><h2>Pending credential claims</h2><p>Verify only from sufficient evidence. A profile's reputation score changes after verified claims exist.</p></div><ClipboardCheck /></div>
          {(data?.pending_credentials || []).length ? <div className="exchange-admin-list">{data.pending_credentials.map((claim) => <article key={claim.id}><div><span className="exchange-status is-pending">Pending</span><h3>{claim.credential_type}</h3><p>{claim.claim_summary}</p><small>{claim.issuing_authority}{claim.jurisdiction ? " · " + claim.jurisdiction : ""}</small>{claim.reference_url && <a href={claim.reference_url} target="_blank" rel="noreferrer">Open official reference</a>}<em>Submitted by {claim.profile?.public_alias || claim.user_id}</em></div><div className="exchange-card-actions"><Button onClick={() => reviewCredential(claim, "verified")} disabled={working === "credential:" + claim.id}><CheckCircle2 /> Verify</Button><Button variant="outline" onClick={() => reviewCredential(claim, "rejected")} disabled={working === "credential:" + claim.id}>Reject</Button></div></article>)}</div> : <div className="exchange-admin-empty"><BadgeCheck /><strong>No credential claims are waiting.</strong></div>}
        </section>

        <section className="exchange-panel">
          <div className="exchange-panel-title"><div><p className="exchange-eyebrow">Safety queue</p><h2>Open reports</h2><p>Review context before suspending a profile. Reports are allegations, not findings.</p></div><ShieldCheck /></div>
          {(data?.open_reports || []).length ? <div className="exchange-admin-list">{data.open_reports.map((report) => <article key={report.id}><div><span className={"exchange-status is-" + report.status}>{readable(report.status)}</span><h3>{readable(report.reason)}</h3><p>{report.description}</p><small>Reported profile: {report.reported_profile?.public_alias || report.reported_user_id}</small>{report.room_id && <em>Room: {report.room_id}</em>}</div><div className="exchange-card-actions"><Button variant="outline" onClick={() => resolveReport(report, "reviewing")} disabled={working === "report:" + report.id}>Mark reviewing</Button><Button onClick={() => resolveReport(report, "resolved")} disabled={working === "report:" + report.id}><CheckCircle2 /> Resolve</Button><Button variant="destructive" onClick={() => resolveReport(report, "action_taken", true)} disabled={working === "report:" + report.id}><Ban /> Suspend profile</Button></div></article>)}</div> : <div className="exchange-admin-empty"><ShieldCheck /><strong>No safety reports are waiting.</strong></div>}
        </section>

        <section className="exchange-panel">
          <div className="exchange-panel-title"><div><p className="exchange-eyebrow">Disclosure audit</p><h2>Recent Exchange events</h2><p>Chronological evidence of profile, matching, introduction, room, message, block, and review actions.</p></div></div>
          <div className="exchange-audit-list">{(data?.recent_audit || []).map((event) => <article key={event.id}><i /><div><strong>{readable(event.event_type)}</strong><p>{event.summary}</p><small>{event.entity_type} · {event.created_at ? new Date(event.created_at).toLocaleString() : ""}</small></div></article>)}</div>
        </section>
      </main>
    </div>
  );
}
