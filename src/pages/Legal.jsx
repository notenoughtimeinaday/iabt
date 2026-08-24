import React from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Bot, Database, Scale, ShieldCheck, WalletCards } from "lucide-react";
import { IABT_LEGAL_NAME, IABT_POLICY_UPDATED, IABT_POLICY_VERSION } from "@/lib/legal";

const PROVIDERS = [
  ["Base44", "Hosting, authentication, database, backend functions, storage, and managed platform services."],
  ["Stripe", "Subscription, credit-pack, billing-portal, fraud-prevention, and payment processing."],
  ["OpenAI and approved model providers", "Planning, language, code, and structured-output generation when configured and permitted."],
  ["Approved media-production suppliers", "Image, video, or audio processing only when the user requests that capability and IABT's commercial and privacy gates pass."],
];

function Section({ id, title, children }) {
  return <section id={id} className="iabt-legal-section"><h2>{title}</h2>{children}</section>;
}

export default function Legal() {
  const { pathname } = useLocation();
  const initial = pathname.includes("privacy") ? "privacy" : pathname.includes("acceptable") ? "acceptable-use" : pathname.includes("terms") ? "terms" : "overview";

  return (
    <div className="iabt-legal-page">
      <header className="iabt-legal-header">
        <Link to="/" className="iabt-legal-brand"><img src="/iabt-mark.svg" alt="" /><span><strong>IABT–JERICHO</strong><small>Trust & Legal Center</small></span></Link>
        <Link to="/" className="iabt-legal-back"><ArrowLeft /> Return to IABT</Link>
      </header>
      <main className="iabt-legal-shell">
        <aside className="iabt-legal-nav" aria-label="Legal documents">
          <a className={initial === "overview" ? "is-active" : ""} href="#overview"><ShieldCheck /> Overview</a>
          <a className={initial === "privacy" ? "is-active" : ""} href="#privacy"><Database /> Privacy</a>
          <a className={initial === "terms" ? "is-active" : ""} href="#terms"><Scale /> Terms</a>
          <a className={initial === "acceptable-use" ? "is-active" : ""} href="#acceptable-use"><AlertTriangle /> Acceptable use</a>
          <a href="#credits"><WalletCards /> Credits & refunds</a>
          <a href="#ai"><Bot /> AI disclosure</a>
        </aside>

        <article className="iabt-legal-document">
          <div className="iabt-legal-title" id="overview">
            <p className="iabt-eyebrow"><ShieldCheck /> Policy version {IABT_POLICY_VERSION}</p>
            <h1>IABT Trust & Legal Center</h1>
            <p>Last updated {IABT_POLICY_UPDATED}</p>
            <div className="iabt-legal-launch-note">
              <strong>Prelaunch policy set.</strong>
              <span>These operational policies are built into IABT, but paid public launch remains gated on final review by licensed counsel and publication of verified privacy and support contact details.</span>
            </div>
          </div>

          <Section id="privacy" title="Privacy Notice">
            <p>{IABT_LEGAL_NAME} processes account information, project content, prompts, uploaded files, generated artifacts, usage records, approvals, security logs, and billing identifiers needed to provide and secure the service. IABT does not need or store full payment-card numbers; payment information is handled by the payment processor.</p>
            <h3>How information is used</h3>
            <ul>
              <li>Authenticate accounts and provide requested creation, storage, export, integration, and automation features.</li>
              <li>Generate quotes, enforce credit and spending limits, prevent duplicate charges, restore eligible credits, and maintain audit records.</li>
              <li>Detect fraud, abuse, security incidents, prohibited activity, and failures.</li>
              <li>Improve reliability using operational measurements that are separated from private project content where practical.</li>
            </ul>
            <h3>Service providers and subprocessors</h3>
            <p>IABT shares only the information reasonably required to perform an authorized task. Suppliers are processors or service providers, not advertisers inside IABT. Current categories include:</p>
            <div className="iabt-subprocessor-list">
              {PROVIDERS.map(([name, purpose]) => <div key={name}><strong>{name}</strong><span>{purpose}</span></div>)}
            </div>
            <p>A production supplier is not activated merely because an adapter exists. IABT requires technical readiness, appropriate contractual permission, privacy review, cost controls, and an authorized user request.</p>
            <h3>Retention, security, and rights</h3>
            <p>IABT retains records only as reasonably necessary for service delivery, security, legal obligations, billing reconciliation, dispute handling, and recovery. Access is limited through authentication, owner-scoped records, administrative controls, private storage, and server-side credentials. Rights to access, correct, export, or delete personal information depend on applicable law and operational retention obligations.</p>
            <p>IABT is not intended for children. Accounts and adult-content workflows are restricted to adults, and any sexual exploitation, sexual content involving minors, or harm to children is prohibited.</p>
          </Section>

          <Section id="terms" title="Terms of Use">
            <p>These terms govern access to IABT. By creating or using an account, you confirm that you are legally able to enter this agreement and will use IABT only for lawful, authorized purposes.</p>
            <h3>Service and autonomy</h3>
            <p>IABT plans, recommends, and performs work within configured permissions. “Autonomous” does not mean unrestricted: IABT may pause for credentials, consent, identity verification, payment approval, safety review, regulated activity, publication, destructive changes, or other owner decisions.</p>
            <h3>Your projects and generated output</h3>
            <p>You retain your rights in content you submit. Subject to applicable supplier terms and law, you may use delivered output under the commercial rights included in your plan. AI output can be incomplete, inaccurate, non-unique, or unsuitable. You must review it before publication, professional reliance, deployment, financial use, or physical execution.</p>
            <h3>Third-party services</h3>
            <p>IABT may use approved suppliers to complete requested work. Their service availability and lawful processing restrictions still apply. IABT may change or replace suppliers without changing the customer objective, provided the replacement passes IABT's technical, legal, privacy, quality, and cost controls.</p>
            <h3>Availability and warranties</h3>
            <p>The service is provided subject to applicable law and the purchased plan. No uninterrupted or error-free operation is promised. Preview, experimental, simulation, and preproduction outputs must not be represented as completed production artifacts.</p>
          </Section>

          <Section id="acceptable-use" title="Acceptable Use Policy">
            <p>You may not use IABT to violate law or another person's rights; gain unauthorized access; evade security or payment controls; distribute malware; facilitate fraud, exploitation, trafficking, abuse, stalking, non-consensual surveillance, or deceptive impersonation; or create instructions intended to cause unlawful injury or destructive physical operation.</p>
            <p>Sexual content involving minors, age ambiguity, coercion, exploitation, incest, trafficking, or non-consensual intimate imagery is prohibited. Lawful adult material may be processed only when the selected provider, distribution channel, verification process, and applicable law permit it. IABT does not promise that every provider will accept every lawful category.</p>
            <p>High-impact financial, legal, medical, employment, housing, insurance, weapons, industrial, and machine-control workflows require qualified review and additional safeguards. Generated G-code and physical instructions are simulation-first and are never machine-ready by default.</p>
            <p>IABT may refuse, suspend, or restrict a workflow when authorization, safety, legality, contractual permission, provider capability, or payment capacity cannot be verified.</p>
          </Section>

          <Section id="credits" title="Plans, production credits, cancellations, and refunds">
            <p>Monthly plan credits support planning and ordinary IABT creation. Paid third-party production requires purchased production credits unless a future plan expressly states otherwise. Before execution, IABT presents the exact credit amount, records approval, reserves that amount, and does not make a separate card charge during the job.</p>
            <p>Reserved credits are captured only after durable output is verified. If no durable output is produced, the reservation is restored when the failure qualifies under IABT's credit policy. Restoration of IABT credits is not automatically a cash refund. Subscription changes and cancellations are managed through the billing portal and remain subject to the checkout terms and applicable consumer law.</p>
            <p>IABT credits are service units, not currency, deposits, securities, stored value, or ownership in IABT. They cannot be transferred or redeemed for cash except where required by law.</p>
          </Section>

          <Section id="ai" title="AI-generated content disclosure">
            <p>IABT uses artificial intelligence to plan, generate, transform, and evaluate content. Generated material must be identified as AI-generated where required by law, contract, platform policy, or context. Users may not falsely represent AI-generated work as exclusively human-created when disclosure is required.</p>
            <p>IABT records the capability, approval, pricing version, and verification status used for important creations. A successful response is not considered delivered until the promised artifact exists and passes its verification contract.</p>
          </Section>

          <Section id="contact" title="Contact and complaints">
            <p>Users may report privacy, safety, copyright, billing, or abuse concerns through the authenticated IABT support channel. Dedicated privacy, legal, and support addresses and the final operating-entity details must be verified and published before paid public launch.</p>
          </Section>
        </article>
      </main>
    </div>
  );
}
