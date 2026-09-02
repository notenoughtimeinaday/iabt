import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BadgeDollarSign, FileLock2, LifeBuoy, Mail, Scale, ShieldAlert } from "lucide-react";

const CONTACTS = [
  { icon: LifeBuoy, title: "Product support", address: "support@insuredspending.org", description: "Account access, JERICHO Studio, projects, deliverables, and technical problems." },
  { icon: BadgeDollarSign, title: "Billing support", address: "billing@insuredspending.org", description: "Subscriptions, invoices, credits, cancellations, and payment questions." },
  { icon: FileLock2, title: "Privacy", address: "privacy@insuredspending.org", description: "Privacy requests, personal information, access, correction, export, or deletion." },
  { icon: Scale, title: "Legal", address: "legal@insuredspending.org", description: "Legal notices, contracts, intellectual property, and formal correspondence." },
  { icon: ShieldAlert, title: "Security", address: "security@insuredspending.org", description: "Suspected vulnerabilities, abuse, fraud, or security incidents." },
];

export default function Support() {
  return (
    <div className="iabt-support-page">
      <header className="iabt-support-header">
        <Link to="/" className="iabt-support-brand">
          <img src="/iabt-mark.svg" alt="" />
          <span><strong>Intelligent Application Building Tool</strong><small>Operated by Insured Spending, LLC</small></span>
        </Link>
        <Link to="/" className="iabt-support-back"><ArrowLeft /> Return to IABT</Link>
      </header>

      <main className="iabt-support-main">
        <section className="iabt-support-hero">
          <p className="iabt-eyebrow"><LifeBuoy /> Public support</p>
          <h1>How can we help?</h1>
          <p>Choose the address that best matches your request. Every address is monitored through the Insured Spending, LLC business mailbox.</p>
        </section>

        <section className="iabt-support-grid" aria-label="Support contacts">
          {CONTACTS.map(({ icon: Icon, title, address, description }) => (
            <article key={address}>
              <Icon />
              <div>
                <h2>{title}</h2>
                <p>{description}</p>
                <a href={"mailto:" + address}><Mail /> {address}</a>
              </div>
            </article>
          ))}
        </section>

        <section className="iabt-support-expectations">
          <div><strong>Expected response</strong><span>We aim to acknowledge ordinary requests within one business day.</span></div>
          <div><strong>Include</strong><span>Your account email, project or incident ID, and a short description of what happened.</span></div>
          <div><strong>Keep private</strong><span>Never send passwords, verification codes, API keys, full payment-card numbers, or private signing keys.</span></div>
        </section>

        <p className="iabt-support-footer">IABT and JERICHO Studio are software products operated by Insured Spending, LLC. For policy details, visit the <Link to="/legal">Trust &amp; Legal Center</Link>.</p>
      </main>
    </div>
  );
}
