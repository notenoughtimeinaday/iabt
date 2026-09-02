import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Handshake,
  Inbox,
  KeyRound,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import "@/exchange.css";

const RELATIONSHIPS = ["cofounder", "advisor", "paid_contractor", "employee", "equity_collaborator", "institutional_partner", "open_to_discussion"];
const COMPENSATION = ["paid", "equity", "paid_plus_equity", "advisory", "volunteer", "open_to_discussion"];
const STAGES = ["idea", "prototype", "beta", "revenue", "growth", "regulated_pilot"];
const DISCLOSURE = ["full_name", "email", "phone", "organization", "calendar_link", "linkedin", "website"];
const INTRO_DISCLOSURE = [...DISCLOSURE, "private_project_summary"];
const TABS = [
  ["overview", "Overview", Network],
  ["profile", "My profile", CircleUserRound],
  ["needs", "Project needs", BriefcaseBusiness],
  ["matches", "Matches", Search],
  ["introductions", "Introductions", Inbox],
  ["rooms", "Rooms", MessageSquare],
  ["credentials", "Credentials", BadgeCheck],
  ["safety", "Safety", ShieldCheck],
];

const EMPTY_PROFILE = {
  public_alias: "",
  headline: "",
  summary: "",
  organization: "",
  phone: "",
  calendar_link: "",
  linkedin: "",
  website: "",
  skills: "",
  industries: "",
  jurisdictions: "",
  relationship_types: ["open_to_discussion"],
  compensation_preferences: ["open_to_discussion"],
  availability: "project_based",
  project_stage_preferences: ["idea", "prototype"],
  visibility: "match_only",
  contact_disclosure_fields: ["email"],
  status: "draft",
};

const EMPTY_NEED = {
  need_id: "",
  project_id: "",
  title: "",
  public_summary: "",
  private_summary: "",
  required_capabilities: "",
  mandatory_credentials: "",
  industry: "",
  jurisdictions: "",
  project_stage: "idea",
  relationship_requested: ["open_to_discussion"],
  compensation_model: ["open_to_discussion"],
  time_commitment: "",
  visibility: "match_only",
  status: "draft",
};

function readable(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function splitList(value = "") {
  return String(value).split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
}

function joinList(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function errorMessage(error) {
  return error?.response?.data?.error || error?.data?.error || error?.message || "The Exchange request could not be completed.";
}

function payload(response) {
  return response?.data || response;
}

function ToggleGroup({ label, values, selected, onChange }) {
  return (
    <fieldset className="exchange-fieldset">
      <legend>{label}</legend>
      <div className="exchange-chip-grid">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              className={"exchange-choice" + (active ? " is-selected" : "")}
              aria-pressed={active}
              onClick={() => onChange(active ? selected.filter((item) => item !== value) : [...selected, value])}
            >
              {active && <CheckCircle2 />}{readable(value)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Empty({ icon: Icon = UsersRound, title, children }) {
  return (
    <div className="exchange-empty">
      <Icon />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function ScoreBar({ label, value, max }) {
  const percent = Math.max(0, Math.min(100, (Number(value || 0) / Number(max || 1)) * 100));
  return (
    <div className="exchange-score-row">
      <span>{readable(label)}</span>
      <div><i style={{ width: `${percent}%` }} /></div>
      <strong>{Number(value || 0)}/{max}</strong>
    </div>
  );
}

export default function Exchange() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [tab, setTab] = useState("overview");
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [needForm, setNeedForm] = useState(EMPTY_NEED);
  const [analysis, setAnalysis] = useState(null);
  const [introTarget, setIntroTarget] = useState(null);
  const [introMessage, setIntroMessage] = useState("");
  const [introFields, setIntroFields] = useState(["email"]);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("other");
  const [reportText, setReportText] = useState("");
  const [credentialForm, setCredentialForm] = useState({ credential_type: "", jurisdiction: "", issuing_authority: "", claim_summary: "", reference_url: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("get-exchange-dashboard", {});
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "IABT Exchange is unavailable.");
      setData(next);
      if (next.profile) {
        setProfileForm({
          ...EMPTY_PROFILE,
          ...next.profile,
          skills: joinList(next.profile.skills),
          industries: joinList(next.profile.industries),
          jurisdictions: joinList(next.profile.jurisdictions),
        });
      }
    } catch (error) {
      toast({ title: "Exchange could not load", description: errorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const needById = useMemo(() => new Map((data?.needs || []).map((need) => [need.id, need])), [data?.needs]);

  async function saveProfile(event) {
    event.preventDefault();
    setWorking("profile");
    try {
      const response = await base44.functions.invoke("save-exchange-profile", {
        ...profileForm,
        skills: splitList(profileForm.skills),
        industries: splitList(profileForm.industries),
        jurisdictions: splitList(profileForm.jurisdictions),
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Profile was not saved.");
      toast({ title: "Collaboration profile saved", description: next.profile.status === "active" ? "Your match-safe profile can now be considered for relevant project needs." : "Activate it when you are ready to appear in matching." });
      await load();
    } catch (error) {
      toast({ title: "Profile not saved", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function saveNeed(event) {
    event.preventDefault();
    setWorking("need");
    try {
      const response = await base44.functions.invoke("save-project-need", {
        ...needForm,
        required_capabilities: splitList(needForm.required_capabilities),
        mandatory_credentials: splitList(needForm.mandatory_credentials),
        jurisdictions: splitList(needForm.jurisdictions),
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Project need was not saved.");
      toast({ title: needForm.need_id ? "Project need updated" : "Project need created", description: next.matching_ready ? "This need is active and ready for matching." : "Save it as active after the requirements are complete." });
      setNeedForm(EMPTY_NEED);
      setAnalysis(null);
      await load();
    } catch (error) {
      toast({ title: "Project need not saved", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  function editNeed(need) {
    setNeedForm({
      ...EMPTY_NEED,
      ...need,
      need_id: need.id,
      required_capabilities: joinList(need.required_capabilities),
      mandatory_credentials: joinList(need.mandatory_credentials),
      jurisdictions: joinList(need.jurisdictions),
    });
    setAnalysis(null);
    setTab("needs");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function analyzeNeed() {
    setWorking("analyze");
    try {
      const response = await base44.functions.invoke("analyze-project-needs", {
        project_id: needForm.project_id,
        title: needForm.title,
        industry: needForm.industry,
        description: needForm.public_summary,
        founder_notes: needForm.private_summary,
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Capability analysis failed.");
      setAnalysis(next.analysis);
      setNeedForm((current) => ({
        ...current,
        public_summary: current.public_summary || next.analysis.suggested_public_summary || "",
        private_summary: current.private_summary || next.analysis.suggested_private_summary || "",
        required_capabilities: next.analysis.missing_capabilities.map((item) => item.capability).join(", "),
        mandatory_credentials: next.analysis.missing_capabilities.map((item) => item.credential_or_jurisdiction).filter(Boolean).join(", "),
        industry: current.industry || next.analysis.industry || "",
        project_stage: next.analysis.project_stage || current.project_stage,
        relationship_requested: [...new Set(next.analysis.missing_capabilities.map((item) => item.relationship).filter(Boolean))],
        compensation_model: next.analysis.suggested_compensation.length ? next.analysis.suggested_compensation : current.compensation_model,
      }));
      toast({ title: "Capability gap mapped", description: "Review and edit JERICHO's suggestions before activating matching." });
    } catch (error) {
      toast({ title: "Analysis failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function findMatches(need) {
    setWorking("match:" + need.id);
    try {
      const response = await base44.functions.invoke("find-collaboration-matches", { project_need_id: need.id });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Matching failed.");
      toast({ title: `${next.match_count} eligible match${next.match_count === 1 ? "" : "es"} found`, description: next.match_count ? "Contact details remain hidden until an introduction is mutually accepted." : "The network may not yet contain a profile meeting every required filter." });
      await load();
      setTab("matches");
    } catch (error) {
      toast({ title: "Matching failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function requestIntroduction() {
    if (!introTarget) return;
    setWorking("intro");
    try {
      const response = await base44.functions.invoke("request-introduction", {
        match_id: introTarget.id,
        request_message: introMessage,
        disclosure_fields: introFields,
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Introduction was not requested.");
      toast({ title: "Introduction requested", description: "The collaborator can accept or decline. No contact details have been disclosed yet." });
      setIntroTarget(null);
      setIntroMessage("");
      await load();
      setTab("introductions");
    } catch (error) {
      toast({ title: "Introduction not requested", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function respondToIntroduction(item, action) {
    const fields = action === "accept" ? (data?.profile?.contact_disclosure_fields || []) : [];
    if (action === "accept" && !window.confirm(`Accept this introduction and share your selected profile contact fields (${fields.map(readable).join(", ") || "none"})?`)) return;
    setWorking("response:" + item.id);
    try {
      const response = await base44.functions.invoke("respond-to-introduction", {
        introduction_id: item.id,
        action,
        disclosure_fields: fields,
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Introduction response failed.");
      toast({ title: action === "accept" ? "Introduction accepted" : action === "decline" ? "Introduction declined" : "Introduction withdrawn", description: next.room?.id ? "A private collaboration room is ready." : "No contact details were disclosed." });
      await load();
      if (next.room?.id) navigate("/exchange/rooms/" + next.room.id);
    } catch (error) {
      toast({ title: "Could not update introduction", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function submitCredential(event) {
    event.preventDefault();
    setWorking("credential");
    try {
      const response = await base44.functions.invoke("save-credential-claim", credentialForm);
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Credential claim was not saved.");
      toast({ title: "Credential submitted", description: next.verification_notice });
      setCredentialForm({ credential_type: "", jurisdiction: "", issuing_authority: "", claim_summary: "", reference_url: "" });
      await load();
    } catch (error) {
      toast({ title: "Credential not submitted", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function submitSafetyReport() {
    if (!reportTarget) return;
    setWorking("report");
    try {
      const response = await base44.functions.invoke("report-exchange-user", {
        reported_user_id: reportTarget.userId,
        room_id: reportTarget.roomId || "",
        reason: reportReason,
        description: reportText,
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Safety report was not submitted.");
      toast({ title: "Safety report submitted", description: next.next_action });
      setReportTarget(null);
      setReportText("");
      await load();
    } catch (error) {
      toast({ title: "Report not submitted", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function blockUser(userId) {
    if (!window.confirm("Block this member? Pending introductions will close and active rooms may be suspended.")) return;
    setWorking("block:" + userId);
    try {
      const response = await base44.functions.invoke("block-exchange-user", { target_user_id: userId, action: "block", reason: "Blocked from Exchange interface" });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Member was not blocked.");
      toast({ title: "Member blocked", description: "This account will be excluded from your future matching." });
      await load();
    } catch (error) {
      toast({ title: "Block failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  async function unblockUser(userId) {
    setWorking("unblock:" + userId);
    try {
      const response = await base44.functions.invoke("block-exchange-user", {
        target_user_id: userId,
        action: "unblock",
      });
      const next = payload(response);
      if (!next?.ok) throw new Error(next?.error || "Member was not unblocked.");
      toast({ title: "Block removed", description: "Future matching may include this member again when all other requirements are met." });
      await load();
    } catch (error) {
      toast({ title: "Unblock failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setWorking("");
    }
  }

  if (loading && !data) {
    return <div className="exchange-loading"><Loader2 className="animate-spin" /><h1>Opening IABT Exchange…</h1><p>Loading your private collaboration workspace.</p></div>;
  }

  const profileActive = data?.profile?.status === "active";
  return (
    <div className="exchange-page">
      <header className="exchange-header">
        <Link to="/" className="exchange-brand"><img src="/iabt-mark.svg" alt="" /><span><strong>IABT Exchange</strong><small>Find the missing capability. Form the right team.</small></span></Link>
        <nav>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</Button>
          {user?.role === "admin" && <Button variant="outline" onClick={() => navigate("/admin/exchange")}><ShieldCheck /> Safety center</Button>}
          <Button variant="ghost" onClick={() => navigate("/")}><ArrowLeft /> Projects</Button>
        </nav>
      </header>

      <main className="exchange-main">
        <section className="exchange-hero">
          <div><p><UsersRound /> Opt-in professional matching</p><h1>Build the team your objective requires.</h1><span>JERICHO maps capability gaps, IABT ranks compatible collaborators, and private identity stays hidden until both people accept an introduction.</span></div>
          <article><ShieldCheck /><div><strong>Mutual consent by design</strong><p>No public contact directory. No automatic identity disclosure. No real-money pooling or investment solicitation.</p></div></article>
        </section>

        <div className="exchange-shell">
          <aside className="exchange-nav">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} type="button" className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><Icon /><span>{label}</span>{id === "introductions" && data?.counts?.incoming_introductions > 0 && <b>{data.counts.incoming_introductions}</b>}</button>
            ))}
            <div className="exchange-profile-state"><i className={profileActive ? "is-ready" : ""} /><span><strong>{profileActive ? "Profile active" : "Profile not active"}</strong><small>{profileActive ? "Eligible for relevant matching" : "Complete and activate your profile"}</small></span></div>
          </aside>

          <section className="exchange-content">
            {tab === "overview" && (
              <>
                <div className="exchange-section-head"><div><p className="exchange-eyebrow">Workspace status</p><h2>Your collaboration command center</h2></div><Button onClick={() => setTab(profileActive ? "needs" : "profile")}><Plus /> {profileActive ? "Create project need" : "Complete profile"}</Button></div>
                <div className="exchange-stat-grid">
                  <article><BriefcaseBusiness /><span>Active needs</span><strong>{data?.counts?.active_needs || 0}</strong></article>
                  <article><Search /><span>Suggested matches</span><strong>{data?.counts?.suggested_matches || 0}</strong></article>
                  <article><Inbox /><span>Incoming requests</span><strong>{data?.counts?.incoming_introductions || 0}</strong></article>
                  <article><MessageSquare /><span>Active rooms</span><strong>{data?.counts?.active_rooms || 0}</strong></article>
                </div>
                <section className="exchange-panel"><div className="exchange-panel-title"><div><h3>How Exchange works</h3><p>From an objective to a mutually approved working relationship.</p></div></div><div className="exchange-steps"><article><span>01</span><strong>Describe what you can do</strong><p>Create a match-safe profile and privately choose which contact fields you may later share.</p></article><article><span>02</span><strong>Define what the project lacks</strong><p>Use JERICHO's gap analysis or enter capabilities, credentials, jurisdiction, stage, and working terms manually.</p></article><article><span>03</span><strong>Review deterministic matches</strong><p>See the score breakdown. Request an introduction only when the fit makes sense.</p></article><article><span>04</span><strong>Connect by mutual consent</strong><p>A private room opens only after acceptance. Each member controls their own contact disclosure.</p></article></div></section>
              </>
            )}

            {tab === "profile" && (
              <form className="exchange-panel exchange-form" onSubmit={saveProfile}>
                <div className="exchange-panel-title"><div><p className="exchange-eyebrow">Match-safe identity</p><h2>Collaboration profile</h2><p>Contact fields remain private. Only alias, expertise, availability, preferences, and verified credential summaries can appear in matches.</p></div><span className={"exchange-status is-" + profileForm.status}>{readable(profileForm.status)}</span></div>
                <div className="exchange-form-grid"><label>Public alias<input value={profileForm.public_alias} onChange={(e) => setProfileForm({ ...profileForm, public_alias: e.target.value })} required /></label><label>Professional headline<input value={profileForm.headline} onChange={(e) => setProfileForm({ ...profileForm, headline: e.target.value })} required /></label><label className="is-wide">Match-safe summary<textarea value={profileForm.summary} onChange={(e) => setProfileForm({ ...profileForm, summary: e.target.value })} rows={4} /></label><label>Organization<input value={profileForm.organization} onChange={(e) => setProfileForm({ ...profileForm, organization: e.target.value })} /></label><label>Phone<input value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} /></label><label>Calendar link<input value={profileForm.calendar_link} onChange={(e) => setProfileForm({ ...profileForm, calendar_link: e.target.value })} placeholder="https://…" /></label><label>LinkedIn<input value={profileForm.linkedin} onChange={(e) => setProfileForm({ ...profileForm, linkedin: e.target.value })} placeholder="https://…" /></label><label>Website<input value={profileForm.website} onChange={(e) => setProfileForm({ ...profileForm, website: e.target.value })} placeholder="https://…" /></label><label>Skills, comma separated<input value={profileForm.skills} onChange={(e) => setProfileForm({ ...profileForm, skills: e.target.value })} placeholder="Bank partnerships, React, compliance" /></label><label>Industries<input value={profileForm.industries} onChange={(e) => setProfileForm({ ...profileForm, industries: e.target.value })} placeholder="Fintech, oilfield, SaaS" /></label><label>Jurisdictions<input value={profileForm.jurisdictions} onChange={(e) => setProfileForm({ ...profileForm, jurisdictions: e.target.value })} placeholder="Texas, United States" /></label><label>Availability<select value={profileForm.availability} onChange={(e) => setProfileForm({ ...profileForm, availability: e.target.value })}><option value="unavailable">Unavailable</option><option value="limited">Limited</option><option value="part_time">Part time</option><option value="full_time">Full time</option><option value="project_based">Project based</option></select></label><label>Visibility<select value={profileForm.visibility} onChange={(e) => setProfileForm({ ...profileForm, visibility: e.target.value })}><option value="private">Private</option><option value="match_only">Match only</option><option value="discoverable">Discoverable</option></select></label><label>Profile status<select value={profileForm.status} onChange={(e) => setProfileForm({ ...profileForm, status: e.target.value })}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></label></div>
                <ToggleGroup label="Working relationships" values={RELATIONSHIPS} selected={profileForm.relationship_types} onChange={(value) => setProfileForm({ ...profileForm, relationship_types: value })} />
                <ToggleGroup label="Compensation preferences" values={COMPENSATION} selected={profileForm.compensation_preferences} onChange={(value) => setProfileForm({ ...profileForm, compensation_preferences: value })} />
                <ToggleGroup label="Preferred project stages" values={STAGES} selected={profileForm.project_stage_preferences} onChange={(value) => setProfileForm({ ...profileForm, project_stage_preferences: value })} />
                <ToggleGroup label="Contact fields you may share after accepting an introduction" values={DISCLOSURE} selected={profileForm.contact_disclosure_fields} onChange={(value) => setProfileForm({ ...profileForm, contact_disclosure_fields: value })} />
                <div className="exchange-form-actions"><Button type="submit" disabled={working === "profile"}>{working === "profile" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save profile</Button></div>
              </form>
            )}

            {tab === "needs" && (
              <>
                <form className="exchange-panel exchange-form" onSubmit={saveNeed}>
                  <div className="exchange-panel-title"><div><p className="exchange-eyebrow">Capability requirements</p><h2>{needForm.need_id ? "Edit project need" : "Create a project need"}</h2><p>Use only enough public information for someone to assess fit. Keep confidential mechanics in the private summary.</p></div>{needForm.need_id && <Button type="button" variant="outline" onClick={() => { setNeedForm(EMPTY_NEED); setAnalysis(null); }}><X /> New need</Button>}</div>
                  <div className="exchange-form-grid"><label>Related IABT project<select value={needForm.project_id} onChange={(e) => setNeedForm({ ...needForm, project_id: e.target.value })}><option value="">Standalone concept</option>{(data?.projects || []).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label>Need title<input value={needForm.title} onChange={(e) => setNeedForm({ ...needForm, title: e.target.value })} placeholder="Bank-partnership advisor" required /></label><label className="is-wide">Public project summary<textarea value={needForm.public_summary} onChange={(e) => setNeedForm({ ...needForm, public_summary: e.target.value })} rows={4} required /></label><label className="is-wide">Private founder notes<textarea value={needForm.private_summary} onChange={(e) => setNeedForm({ ...needForm, private_summary: e.target.value })} rows={4} placeholder="Used only for your workspace and optional JERICHO analysis." /></label><label>Required capabilities<input value={needForm.required_capabilities} onChange={(e) => setNeedForm({ ...needForm, required_capabilities: e.target.value })} placeholder="Sponsor bank relationships, BaaS diligence" /></label><label>Mandatory credentials<input value={needForm.mandatory_credentials} onChange={(e) => setNeedForm({ ...needForm, mandatory_credentials: e.target.value })} placeholder="Only use when truly mandatory" /></label><label>Industry<input value={needForm.industry} onChange={(e) => setNeedForm({ ...needForm, industry: e.target.value })} placeholder="Fintech" /></label><label>Jurisdictions<input value={needForm.jurisdictions} onChange={(e) => setNeedForm({ ...needForm, jurisdictions: e.target.value })} placeholder="Texas, United States" /></label><label>Project stage<select value={needForm.project_stage} onChange={(e) => setNeedForm({ ...needForm, project_stage: e.target.value })}>{STAGES.map((stage) => <option key={stage} value={stage}>{readable(stage)}</option>)}</select></label><label>Time commitment<input value={needForm.time_commitment} onChange={(e) => setNeedForm({ ...needForm, time_commitment: e.target.value })} placeholder="2–4 hours per week" /></label><label>Visibility<select value={needForm.visibility} onChange={(e) => setNeedForm({ ...needForm, visibility: e.target.value })}><option value="private">Private</option><option value="match_only">Match only</option><option value="discoverable">Discoverable</option></select></label><label>Status<select value={needForm.status} onChange={(e) => setNeedForm({ ...needForm, status: e.target.value })}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="filled">Filled</option><option value="closed">Closed</option></select></label></div>
                  <ToggleGroup label="Relationship requested" values={RELATIONSHIPS} selected={needForm.relationship_requested} onChange={(value) => setNeedForm({ ...needForm, relationship_requested: value })} />
                  <ToggleGroup label="Compensation model" values={COMPENSATION} selected={needForm.compensation_model} onChange={(value) => setNeedForm({ ...needForm, compensation_model: value })} />
                  <div className="exchange-form-actions"><Button type="button" variant="outline" onClick={analyzeNeed} disabled={working === "analyze"}>{working === "analyze" ? <Loader2 className="animate-spin" /> : <Sparkles />} Analyze gaps with JERICHO</Button><Button type="submit" disabled={working === "need"}>{working === "need" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save need</Button></div>
                </form>
                {analysis && <section className="exchange-panel exchange-analysis"><div className="exchange-panel-title"><div><h3>JERICHO capability map</h3><p>Advisory suggestions only. Edit before activating.</p></div><span className="exchange-status is-draft">{readable(analysis.project_stage)}</span></div><div className="exchange-gap-list">{analysis.missing_capabilities.map((item, index) => <article key={index}><b>{readable(item.priority)}</b><strong>{item.capability}</strong><p>{item.reason}</p><small>{readable(item.relationship)}{item.credential_or_jurisdiction ? " · " + item.credential_or_jurisdiction : ""}</small></article>)}</div>{analysis.questions.length > 0 && <div className="exchange-questions"><strong>Questions to resolve</strong><ul>{analysis.questions.map((question) => <li key={question}>{question}</li>)}</ul></div>}</section>}
                <section className="exchange-panel"><div className="exchange-panel-title"><div><h3>Your project needs</h3><p>Only active needs can run matching.</p></div></div>{(data?.needs || []).length ? <div className="exchange-card-list">{data.needs.map((need) => <article key={need.id} className="exchange-need-card"><div><span className={"exchange-status is-" + need.status}>{readable(need.status)}</span><h3>{need.title}</h3><p>{need.public_summary}</p><div className="exchange-tags">{need.required_capabilities.map((item) => <span key={item}>{item}</span>)}</div></div><div className="exchange-card-actions"><Button variant="outline" onClick={() => editNeed(need)}>Edit</Button><Button onClick={() => findMatches(need)} disabled={need.status !== "active" || working === "match:" + need.id}>{working === "match:" + need.id ? <Loader2 className="animate-spin" /> : <Search />} Find matches</Button></div></article>)}</div> : <Empty icon={BriefcaseBusiness} title="No project needs yet">Create one above or let JERICHO map the capabilities your project is missing.</Empty>}</section>
              </>
            )}

            {tab === "matches" && <section className="exchange-panel"><div className="exchange-panel-title"><div><p className="exchange-eyebrow">Explainable matching</p><h2>Suggested collaborators</h2><p>Scores are deterministic. No random ranking and no private contact information.</p></div></div>{(data?.matches || []).length ? <div className="exchange-match-grid">{data.matches.map((match) => <article key={match.id} className="exchange-match-card"><div className="exchange-match-score"><strong>{match.total_score}</strong><span>match</span></div><div className="exchange-match-copy"><span className="exchange-status is-active">{readable(match.candidate.verification_level)}</span><h3>{match.candidate.public_alias}</h3><h4>{match.candidate.headline}</h4><p>{match.candidate.summary}</p><div className="exchange-tags">{match.candidate.skills.slice(0, 8).map((skill) => <span key={skill}>{skill}</span>)}</div><small>{match.ai_explanation}</small></div><details className="exchange-score-details"><summary>Score breakdown</summary><ScoreBar label="Capability fit" value={match.score_breakdown.capability_fit} max={35} /><ScoreBar label="Jurisdiction credentials" value={match.score_breakdown.jurisdiction_credentials} max={20} /><ScoreBar label="Availability" value={match.score_breakdown.availability} max={15} /><ScoreBar label="Project stage" value={match.score_breakdown.project_stage} max={15} /><ScoreBar label="Relationship compensation" value={match.score_breakdown.relationship_compensation} max={10} /><ScoreBar label="Reputation" value={match.score_breakdown.reputation} max={5} /></details><div className="exchange-card-actions"><Button onClick={() => { setIntroTarget(match); setIntroMessage(`I would like to discuss ${needById.get(match.project_need_id)?.title || "this project need"} and learn whether our goals align.`); setIntroFields(data?.profile?.contact_disclosure_fields || ["email"]); }} disabled={!profileActive || !["suggested", "saved"].includes(match.status)}><Handshake /> Request introduction</Button><Button variant="ghost" onClick={() => setReportTarget({ userId: match.candidate_user_id, alias: match.candidate.public_alias })}>Report</Button><Button variant="ghost" onClick={() => blockUser(match.candidate_user_id)} disabled={working === "block:" + match.candidate_user_id}><Ban /> Block</Button></div></article>)}</div> : <Empty icon={Search} title="No suggested matches">Activate a project need and run matching. Results will appear here when another opted-in profile meets every required filter.</Empty>}</section>}

            {tab === "introductions" && <section className="exchange-panel"><div className="exchange-panel-title"><div><p className="exchange-eyebrow">Mutual approval</p><h2>Introduction requests</h2><p>Neither side receives private contact information until the request is accepted.</p></div></div>{(data?.introductions || []).length ? <div className="exchange-card-list">{data.introductions.map((item) => { const other = item.direction === "incoming" ? item.requester_snapshot : item.recipient_snapshot; return <article key={item.id} className="exchange-intro-card"><div><span className={"exchange-status is-" + item.status}>{readable(item.status)} · {item.direction}</span><h3>{other?.public_alias || "Exchange member"}</h3><h4>{other?.headline || "Collaborator"}</h4><p>{item.request_message}</p>{item.need && <small>Regarding: {item.need.title}</small>}</div><div className="exchange-card-actions">{item.direction === "incoming" && item.status === "pending" && <><Button onClick={() => respondToIntroduction(item, "accept")} disabled={working === "response:" + item.id}><CheckCircle2 /> Accept</Button><Button variant="outline" onClick={() => respondToIntroduction(item, "decline")} disabled={working === "response:" + item.id}><X /> Decline</Button></>}{item.direction === "outgoing" && item.status === "pending" && <Button variant="outline" onClick={() => respondToIntroduction(item, "withdraw")} disabled={working === "response:" + item.id}>Withdraw</Button>}</div></article>; })}</div> : <Empty icon={Inbox} title="No introduction requests">Request an introduction from a suggested match. The recipient will see a match-safe project and profile summary.</Empty>}</section>}

            {tab === "rooms" && <section className="exchange-panel"><div className="exchange-panel-title"><div><p className="exchange-eyebrow">Private collaboration</p><h2>Your rooms</h2><p>Rooms open only after a mutually accepted introduction.</p></div></div>{(data?.rooms || []).length ? <div className="exchange-room-grid">{data.rooms.map((room) => <button key={room.id} type="button" className="exchange-room-card" onClick={() => navigate("/exchange/rooms/" + room.id)}><MessageSquare /><span><small>{readable(room.status)}</small><strong>{room.other_alias}</strong><p>{room.need?.title || "Collaboration room"}</p></span><ChevronRight /></button>)}</div> : <Empty icon={MessageSquare} title="No collaboration rooms">A room will appear here after an introduction is accepted.</Empty>}</section>}

            {tab === "credentials" && <><form className="exchange-panel exchange-form" onSubmit={submitCredential}><div className="exchange-panel-title"><div><p className="exchange-eyebrow">Trust signals</p><h2>Submit a credential claim</h2><p>Claims remain unverified until reviewed through an official registry, issuing organization, or supporting document.</p></div></div><div className="exchange-form-grid"><label>Credential type<input value={credentialForm.credential_type} onChange={(e) => setCredentialForm({ ...credentialForm, credential_type: e.target.value })} required /></label><label>Jurisdiction<input value={credentialForm.jurisdiction} onChange={(e) => setCredentialForm({ ...credentialForm, jurisdiction: e.target.value })} /></label><label>Issuing authority<input value={credentialForm.issuing_authority} onChange={(e) => setCredentialForm({ ...credentialForm, issuing_authority: e.target.value })} required /></label><label>Official reference URL<input value={credentialForm.reference_url} onChange={(e) => setCredentialForm({ ...credentialForm, reference_url: e.target.value })} placeholder="https://…" /></label><label className="is-wide">Claim summary<textarea value={credentialForm.claim_summary} onChange={(e) => setCredentialForm({ ...credentialForm, claim_summary: e.target.value })} rows={4} required /></label></div><div className="exchange-form-actions"><Button type="submit" disabled={working === "credential"}>{working === "credential" ? <Loader2 className="animate-spin" /> : <KeyRound />} Submit for review</Button></div></form><section className="exchange-panel"><div className="exchange-panel-title"><div><h3>Your claims</h3><p>Only verified claims contribute to mandatory-credential matching.</p></div></div>{(data?.credentials || []).length ? <div className="exchange-card-list">{data.credentials.map((claim) => <article key={claim.id} className="exchange-credential-card"><BadgeCheck /><div><span className={"exchange-status is-" + claim.verification_status}>{readable(claim.verification_status)}</span><h3>{claim.credential_type}</h3><p>{claim.issuing_authority}{claim.jurisdiction ? " · " + claim.jurisdiction : ""}</p></div></article>)}</div> : <Empty icon={BadgeCheck} title="No credential claims">Add only credentials that are relevant to the work you want to perform.</Empty>}</section></>}
          </section>
        </div>
      </main>

      {introTarget && <div className="exchange-modal-backdrop" role="presentation" onMouseDown={() => setIntroTarget(null)}><section className="exchange-modal" role="dialog" aria-modal="true" aria-labelledby="intro-title" onMouseDown={(e) => e.stopPropagation()}><button type="button" className="exchange-modal-close" onClick={() => setIntroTarget(null)}><X /></button><p className="exchange-eyebrow"><Handshake /> Mutual-consent introduction</p><h2 id="intro-title">Contact {introTarget.candidate.public_alias}</h2><p>Your message and match-safe profile will be shown. Selected contact fields remain concealed unless the recipient accepts.</p><label>Introduction message<textarea rows={5} value={introMessage} onChange={(e) => setIntroMessage(e.target.value)} /></label><ToggleGroup label="Information you agree to share after acceptance" values={INTRO_DISCLOSURE} selected={introFields} onChange={setIntroFields} /><div className="exchange-form-actions"><Button variant="outline" onClick={() => setIntroTarget(null)}>Cancel</Button><Button onClick={requestIntroduction} disabled={working === "intro"}>{working === "intro" ? <Loader2 className="animate-spin" /> : <Handshake />} Send request</Button></div></section></div>}

      {reportTarget && <div className="exchange-modal-backdrop" role="presentation" onMouseDown={() => setReportTarget(null)}><section className="exchange-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(e) => e.stopPropagation()}><button type="button" className="exchange-modal-close" onClick={() => setReportTarget(null)}><X /></button><p className="exchange-eyebrow"><ShieldCheck /> Safety report</p><h2 id="report-title">Report {reportTarget.alias || "member"}</h2><label>Reason<select value={reportReason} onChange={(e) => setReportReason(e.target.value)}><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="misrepresentation">Misrepresentation</option><option value="credential_concern">Credential concern</option><option value="conflict_of_interest">Conflict of interest</option><option value="privacy_concern">Privacy concern</option><option value="fraud_concern">Fraud concern</option><option value="other">Other</option></select></label><label>Description<textarea rows={5} value={reportText} onChange={(e) => setReportText(e.target.value)} /></label><div className="exchange-form-actions"><Button variant="outline" onClick={() => setReportTarget(null)}>Cancel</Button><Button onClick={submitSafetyReport} disabled={working === "report"}>{working === "report" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Submit report</Button></div></section></div>}
    </div>
  );
}
