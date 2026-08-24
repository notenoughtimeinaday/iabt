import React, { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { IABT_POLICY_VERSION } from "@/lib/legal";

export default function LegalAcceptanceGate() {
  const { user } = useAuth();
  const [state, setState] = useState("loading");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.id) return;
      try {
        const records = await base44.entities.PolicyAcceptance.filter(
          { user_id: user.id, policy_version: IABT_POLICY_VERSION },
          "-accepted_at",
          1,
        );
        if (!active) return;
        setState(records?.[0]?.terms_accepted && records?.[0]?.acceptable_use_accepted ? "accepted" : "required");
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message || "Could not verify policy acceptance.");
        setState("required");
      }
    }
    load();
    return () => { active = false; };
  }, [user?.id]);

  async function acceptPolicies() {
    if (!accepted || !user?.id) return;
    setState("saving");
    setError("");
    try {
      await base44.entities.PolicyAcceptance.create({
        user_id: user.id,
        user_email: user.email,
        policy_version: IABT_POLICY_VERSION,
        terms_accepted: true,
        privacy_acknowledged: true,
        acceptable_use_accepted: true,
        acceptance_text: "I agree to the IABT Terms of Use and Acceptable Use Policy and acknowledge the Privacy Notice and AI-generated content disclosures.",
        accepted_at: new Date().toISOString(),
        source: "in_app",
      });
      setState("accepted");
    } catch (saveError) {
      setError(saveError.message || "Could not record policy acceptance.");
      setState("required");
    }
  }

  if (state === "accepted") return <Outlet />;

  if (state === "loading" || state === "saving") {
    return (
      <div className="iabt-policy-gate is-loading">
        <Loader2 className="animate-spin" />
        <strong>{state === "saving" ? "Recording your agreement…" : "Checking account policies…"}</strong>
      </div>
    );
  }

  return (
    <div className="iabt-policy-gate">
      <div className="iabt-policy-gate-card">
        <div className="iabt-policy-gate-icon"><ShieldCheck /></div>
        <p className="iabt-eyebrow">Transparent autonomous creation</p>
        <h1>Review how IABT works before continuing</h1>
        <p>
          IABT can plan and perform authorized work, use approved third-party processors, and reserve IABT credits
          only after an exact approval. You remain responsible for reviewing generated results before relying on,
          publishing, or physically executing them.
        </p>
        <div className="iabt-policy-gate-points">
          <span><CheckCircle2 /> Paid supplier work requires an explicit quote and purchased production credits.</span>
          <span><CheckCircle2 /> Failed work restores reserved credits when no durable output is delivered.</span>
          <span><CheckCircle2 /> High-impact, regulated, destructive, or physical actions require additional controls.</span>
        </div>
        <label className="iabt-policy-check">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>
            I agree to the <Link to="/terms" target="_blank">Terms of Use</Link> and{" "}
            <Link to="/acceptable-use" target="_blank">Acceptable Use Policy</Link>, and acknowledge the{" "}
            <Link to="/privacy" target="_blank">Privacy Notice</Link> and AI disclosures.
          </span>
        </label>
        {error && <p className="iabt-policy-error">{error}</p>}
        <Button onClick={acceptPolicies} disabled={!accepted}>Agree and continue</Button>
        <small>Policy version {IABT_POLICY_VERSION}. Material updates will require renewed acceptance.</small>
      </div>
    </div>
  );
}
