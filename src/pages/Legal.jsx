import React, { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Bot, Database, Scale, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
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

  useEffect(() => {
    window.requestAnimationFrame(() => {
      document.getElementById(initial)?.scrollIntoView({ block: "start" });
    });
  }, [initial]);

  return (
    <div className="iabt-legal-page">
      <header className="iabt-legal-header">
        <Link to="/" className="iabt-legal-brand"><img src="/iabt-mark.svg" alt="" /><span><strong>Intelligent Application Building Tool</strong><small>IABT · Trust & Legal Center</small></span></Link>
        <Link to="/" className="iabt-legal-back"><ArrowLeft /> Return to IABT</Link>
      </header>
      <main className="iabt-legal-shell">
        <aside className="iabt-legal-nav" aria-label="Legal documents">
          <a className={initial === "overview" ? "is-active" : ""} href="#overview"><ShieldCheck /> Overview</a>
          <a className={initial === "privacy" ? "is-active" : ""} href="#privacy"><Database /> Privacy</a>
          <a className={initial === "terms" ? "is-active" : ""} href="#terms"><Scale /> Terms</a>
          <a className={initial === "acceptable-use" ? "is-active" : ""} href="#acceptable-use"><AlertTriangle /> Acceptable use</a>
          <a href="#exchange"><UsersRound /> IABT Exchange</a>
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
              <span>These operational policies are built into IABT and verified business contact channels are published. Paid public launch remains gated on final review by licensed counsel and completion of the remaining payment and supplier controls.</span>
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
            <h3>IABT Exchange data</h3>
            <p>IABT Exchange is an opt-in professional collaboration feature. It processes collaboration profiles, project-need descriptions, match scores, introduction requests, consent records, credential claims, private-room messages, blocks, safety reports, and audit events needed to operate and secure the service. Match results use limited, match-safe profile fields. Full identity, contact information, confidential project notes, and private-room content are not placed in a public directory.</p>
            <p>Contact fields are disclosed to another member only after a mutually accepted introduction and only to the extent each member has affirmatively selected. A member may still collaborate through an IABT room without sharing external contact details. Safety, legal, security, retention, and administrator-review obligations may require limited access to relevant records.</p>
          </Section>

          <Section id="terms" title="Terms of Use">
            <p>These terms govern access to IABT. By creating or using an account, you confirm that you are legally able to enter this agreement and will use IABT only for lawful, authorized purposes.</p>
            <h3>Service and autonomy</h3>
            <p>IABT plans, recommends, and performs work within configured permissions. “Autonomous” does not mean unrestricted: IABT may pause for credentials, consent, identity verification, payment approval, safety review, regulated activity, publication, destructive changes, or other owner decisions.</p>
            <h3>Your projects and generated output</h3>
            <p>You retain your rights in content you submit. Subject to applicable supplier terms and law, you may use delivered output under the commercial rights included in your plan. AI output can be incomplete, inaccurate, non-unique, or unsuitable. You must review it before publication, professional reliance, deployment, financial use, or physical execution.</p>
            <h3>Third-party services</h3>
            <p>IABT may use approved suppliers to complete requested work. Their service availability and lawful processing restrictions still apply. IABT may change or replace suppliers without changing the customer objective, provided the replacement passes IABT's technical, legal, privacy, quality, and cost controls.</p>
            <h3>IABT Exchange</h3>
            <p>Exchange helps opted-in members identify possible collaborators through structured profiles, project needs, deterministic compatibility scoring, mutual-consent introductions, and private collaboration rooms. A match score, AI explanation, credential claim, or verification badge is informational and does not guarantee identity, competence, licensing, suitability, funding, lawful operation, or a successful working relationship. Members must conduct their own diligence and use qualified professional review where appropriate.</p>
            <p>IABT Exchange is not a public contact directory, employment agency, broker-dealer, investment marketplace, bank, insurer, escrow agent, money transmitter, or guarantor. IABT does not promise funding, employment, investment, banking access, licensing, regulatory approval, or project success. Separate agreements, payments, equity, professional services, or regulated activity between members remain their responsibility and may require independent contracts, licensed intermediaries, disclosures, and compliance.</p>
            <h3>Availability and warranties</h3>
            <p>The service is provided subject to applicable law and the purchased plan. No uninterrupted or error-free operation is promised. Preview, experimental, simulation, and preproduction outputs must not be represented as completed production artifacts.</p>
          </Section>

          <Section id="acceptable-use" title="Acceptable Use Policy">
            <p>You may not use IABT to violate law or another person's rights; gain unauthorized access; evade security or payment controls; distribute malware; facilitate fraud, exploitation, trafficking, abuse, stalking, non-consensual surveillance, or deceptive impersonation; or create instructions intended to cause unlawful injury or destructive physical operation.</p>
            <p>Sexual content involving minors, age ambiguity, coercion, exploitation, incest, trafficking, or non-consensual intimate imagery is prohibited. Lawful adult material may be processed only when the selected provider, distribution channel, verification process, and applicable law permit it. IABT does not promise that every provider will accept every lawful category.</p>
            <p>High-impact financial, legal, medical, employment, housing, insurance, weapons, industrial, and machine-control workflows require qualified review and additional safeguards. Generated G-code and physical instructions are simulation-first and are never machine-ready by default.</p>
            <p>Exchange members may not scrape profiles; send spam or repeated unwanted introductions; misrepresent identity, credentials, licenses, employment, funding, authority, or project status; evade blocks; pressure another member to disclose private information; use the service for unlawful discrimination, harassment, stalking, deceptive recruiting, unregistered securities solicitation, fraudulent fundraising, money laundering, or prohibited financial activity.</p>
            <p>IABT may refuse, suspend, or restrict a workflow, Exchange profile, introduction, room, or account when authorization, safety, legality, contractual permission, provider capability, payment capacity, identity, credentials, or conduct cannot be adequately verified.</p>
          </Section>

          <Section id="exchange" title="IABT Exchange collaboration terms">
            <p>Participation is voluntary and profile visibility is controlled by the member. The default Exchange experience is match-only rather than a public directory. IABT may use structured rules and AI-assisted analysis to normalize project requirements and explain potential fit, but the final ranking is produced by a disclosed deterministic scoring model rather than random selection.</p>
            <p>Introduction requests do not reveal private contact information. An accepted introduction creates a private collaboration room and makes available only the contact fields each participant authorized. Declining or withdrawing an introduction does not disclose contact information. Blocking a member prevents future matching between those accounts and may suspend active rooms.</p>
            <p>Credential claims are self-reported until explicitly marked verified. Verification reflects only the evidence and method recorded at the time of review; it is not a warranty, endorsement, background check, or continuing-license guarantee. Users should independently confirm professional qualifications and standing through applicable official sources.</p>
            <p>Exchange does not process pooled member funds, arrange investments, or provide regulated banking, insurance, legal, accounting, employment, or brokerage services. Any collaboration involving compensation, equity, fundraising, regulated services, intellectual property, confidentiality, or customer funds should be governed by appropriate independent agreements and qualified professional advice.</p>
          </Section>

          <Section id="credits" title="Plans, production credits, cancellations, and refunds">
            <p>Builder, Pro, and Agency subscriptions may use their included IABT credits for eligible paid third-party production. Free-plan paid production and usage beyond a paid plan's remaining included allowance require purchased credits. Before execution, IABT presents the exact credit amount, records approval, reserves that amount, and does not make a separate card charge during the job.</p>
            <p>Reserved credits are captured only after durable output is verified. If no durable output is produced, the reservation is restored when the failure qualifies under IABT's credit policy. Restoration of IABT credits is not automatically a cash refund. Subscription changes and cancellations are managed through the billing portal and remain subject to the checkout terms and applicable consumer law.</p>
            <p>IABT credits are service units, not currency, deposits, securities, stored value, or ownership in IABT. They cannot be transferred or redeemed for cash except where required by law.</p>
          </Section>

          <Section id="ai" title="AI-generated content disclosure">
            <p>IABT uses artificial intelligence to plan, generate, transform, and evaluate content. Generated material must be identified as AI-generated where required by law, contract, platform policy, or context. Users may not falsely represent AI-generated work as exclusively human-created when disclosure is required.</p>
            <p>IABT records the capability, approval, pricing version, and verification status used for important creations. A successful response is not considered delivered until the promised artifact exists and passes its verification contract.</p>
          </Section>

          <Section id="contact" title="Contact and complaints">
            <p>IABT and JERICHO Studio are software products operated by Insured Spending, LLC. Public business contacts are monitored through the company's verified domain mailbox.</p>
            <ul>
              <li>Product and account support: <a href="mailto:support@insuredspending.org">support@insuredspending.org</a></li>
              <li>Billing: <a href="mailto:billing@insuredspending.org">billing@insuredspending.org</a></li>
              <li>Privacy requests: <a href="mailto:privacy@insuredspending.org">privacy@insuredspending.org</a></li>
              <li>Legal notices: <a href="mailto:legal@insuredspending.org">legal@insuredspending.org</a></li>
              <li>Security and abuse: <a href="mailto:security@insuredspending.org">security@insuredspending.org</a></li>
            </ul>
            <p>For response expectations and safe-reporting guidance, visit the <Link to="/support">Public Support Center</Link>.</p>
          </Section>
        </article>
      </main>
    </div>
  );
}
