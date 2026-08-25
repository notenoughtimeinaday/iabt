# Intelligent Application Building Tool (IABT) — JERICHO Studio

The Intelligent Application Building Tool (IABT) is an autonomous creation and project-operations platform running on Base44. JERICHO Studio is the single creation front door: it preserves context, plans and quotes work, routes to authorized providers, requires explicit approval, and verifies delivery. Generated app projects are preserved as reviewable project records and deliverable artifacts. The former Visual App Builder is retired from the customer-facing product.

- Production: https://insuredspending.org
- Base44 fallback: https://crazy-creator-flow-hub.base44.app

## What works

- Authenticated Base44 project dashboard
- Cloud load, save, rename, duplicate, delete, import, and search
- Recovery of unsaved local drafts
- User-controlled migration of legacy `iabt.projectsIndex` projects without deleting local originals
- Generated app project records with AppDefinition metadata, files, manifests, and delivery history
- A permanent Deliverable Library independent of conversation history
- Download recovery for inline documents, code, G-code, and preproduction packages
- Private signed-link retrieval for stored media artifacts
- The former Visual App Builder is retained only as unreachable historical source and is not part of the customer experience
- AI AppDefinition creation through JERICHO Studio's authenticated plan, quote, approval, and verification workflow
- Account entitlements for Free, Builder, Pro, and Agency
- Monthly IABT credit allowances, hourly safety limits, and one-time credit packs
- Plan-enforced cloud-project and export access
- Professional dark-neon JERICHO interface based on the canonical launch artwork
- Professional Plans & Billing interface with visible IABT credit balances and private supplier economics
- Secure Stripe subscription/credit Checkout, Customer Portal, and idempotent signed webhooks with explicit test/live mode separation
- Owner-only Profit & Compliance Control Center with supplier-admission, margin, spending, billing, and launch gates
- Public Trust & Legal Center plus versioned in-app Terms, Privacy, and Acceptable Use acceptance
- JSON import/export
- Standalone HTML, static multi-page HTML ZIP, React source, and runnable Vite/React ZIP exports
- Browser-generated ZIPs with no temporary server filesystem
- Responsive desktop/mobile editor

## Architecture

- React + Vite frontend
- Base44 SDK and Vite plugin
- Base44 authentication
- Owner-scoped `Project` and `AiUsage` entities
- User-readable, administrator-managed `AccountEntitlement` entity
- AI function at `base44/functions/generate-app/entry.ts`
- Stripe functions under `base44/functions/stripe-*`
- Shared Stripe mode/readiness guard at `base44/shared/stripe.ts`
- AppDefinition schema version 1.0
- Local draft recovery plus Base44 cloud persistence

The AI functions use `OPENAI_API_KEY` and the OpenAI Responses API when that secret is configured. Without it, app generation falls back to Base44 managed AI. Every creation reserves authenticated-user IABT credits atomically, captures them only after durable output is verified, and restores them when work fails before a durable result. Usage is tracked in hourly safety and UTC monthly buckets. Paid subscriptions use eligible included credits first; Free-plan paid production and paid-plan overages use purchased credits.

## Local development

1. Install dependencies: `npm install`
2. Run the Base44 development environment: `npx base44 dev`
3. Or run the frontend against the hosted backend: `npm run dev`

For frontend-only development, create `.env.local`:

```
VITE_BASE44_APP_ID=6a849bcd3e04d068553b4af7
VITE_BASE44_APP_BASE_URL=https://crazy-creator-flow-hub.base44.app
```

Never place an OpenAI or Stripe key in a `VITE_*` variable or frontend file.

## Verification

Run:

```
npm run verify
```

This runs lint, JavaScript project validation, and the production Vite build. Export verification should also generate both ZIP targets and build the exported React project.

## Base44 setup

- Authentication is enabled for email/password, Google, Microsoft, Facebook, and Apple.
- Optional: add `OPENAI_API_KEY` and `OPENAI_MODEL` through Base44 backend secrets.
- For managed Luma video, add `LUMA_AGENTS_API_KEY`, set `IABT_ENABLE_PAID_MEDIA=true`, and set `IABT_MEDIA_BILLING_READY=true` only after the provider account has a funded balance and spending controls. Set `IABT_LUMA_COMMERCIAL_APPROVED=true` only after the ProviderAgreement record documents embedded use, white-label permission, commercial output rights, privacy/DPA approval, and accepted billing terms.
- Publish only after `npm run verify` passes.
- Keep the production custom domain attached to this one canonical Base44 app.

## Founding pricing model

| Plan | Monthly price | Projects | Included IABT credits | Export/commercial access |
|---|---:|---:|---:|---|
| Free | $0 | 1 | 10/month | Preview, JSON, standalone HTML |
| Builder | $29 | 5 | 100/month | Adds static HTML ZIP |
| Pro | $79 | 25 | 500/month | Adds React exports and commercial use |
| Agency | $199 | Unlimited | 2,000/month | Adds white-label exports and 5 team seats |

One-time packs add 100 IABT credits for $10. Paid Builder, Pro, and Agency subscriptions can use their included IABT credits for eligible third-party production. Free-plan paid production and usage beyond a paid plan's remaining allowance require purchased credits and an approved supplier agreement. Assisted app-building engagements can be offered separately from $499–$1,500; they are a managed service, not an automated in-app entitlement.

## Stripe billing

Stripe defaults to safe test mode. Set `IABT_STRIPE_MODE=test` (or omit it) with `sk_test_` credentials for testing. Live payment support is code-ready but activates only when `IABT_STRIPE_MODE=live` is explicitly configured with matching `sk_live_` credentials and live Stripe resources. Webhook events whose test/live mode does not match the configured mode are rejected.

Required Stripe secrets for either mode:

1. Create recurring Builder ($29), Pro ($79), and Agency ($199) prices in the selected Stripe mode.
2. Create a one-time $10 price for the 100-credit IABT pack in the same mode.
3. Store their IDs in Base44 Secrets as `STRIPE_BUILDER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_AGENCY_PRICE_ID`, and `STRIPE_AI_CREDIT_PACK_PRICE_ID`.
4. Set `STRIPE_SECRET_KEY` to the matching test or live secret key and `STRIPE_WEBHOOK_SECRET` to the signing secret for the matching webhook endpoint.
5. Set `IABT_APP_ORIGIN=https://insuredspending.org` and set `IABT_STRIPE_MODE=test` while validating the release.
6. Configure the Customer Portal product catalog, then verify checkout, plan changes, cancellation, failed-payment handling, delayed-payment credit grants, and webhook idempotency with test resources before switching modes.

Checkout derives the authenticated user on the server. The browser cannot supply a customer identity, price ID, plan metadata, or redirect destination. Customer Portal access is limited to the Stripe customer stored on the signed-in user's entitlement. The billing UI receives only non-secret readiness booleans and the configured mode.

Do not set `IABT_STRIPE_MODE=live` until pricing, policies, refunds, taxes, support, production price IDs, production webhook behavior, and an end-to-end test release are explicitly approved. Switching to live mode can create real charges.

## Luma video and IABT credit economics

Stripe and Luma are separate accounts: subscription and credit-pack revenue settles through Stripe, while Ray 3.2 rendering spends the IABT owner's Luma balance. Stripe payments do not directly refill Luma. Keep a controlled Luma balance or enable Luma auto-reload with a conservative threshold and reload amount.

Paid supplier quotes use weighted IABT production credits. One production credit represents at most 3 cents of supplier cost while its current retail value is 10 cents, targeting roughly 70% gross margin before platform, payment, support, tax, and refund costs. A request reserves its exact eligible credit amount only after explicit approval. Paid plans use included credits first and purchased credits for overage; the Free plan requires purchased credits for paid production. Credits are captured after the MP4 is copied to durable private Base44 storage and restored when no durable result is produced under the credit policy.

## Commercial and legal control

Paid supplier execution is fail-closed. It requires a current approved ProviderAgreement, an active CommercialPolicy, adequate eligible IABT credits, the minimum margin floor, the per-job cost ceiling, daily and monthly spend capacity, supplier credentials, funded billing, and an explicit commercial-approval secret. Provider commitments and settlements are recorded separately from the customer credit ledger.

The public Trust & Legal Center is a prelaunch operational policy set. Before live paid launch, licensed counsel must review it and the owner must publish verified legal-entity, governing-law, privacy, legal, and support contact details.

## Agentic creation direction

JERICHO Studio is IABT's single creation surface. Generated AppDefinition projects are preserved for review and delivery; the former Visual App Builder is retired from customer-facing routes. Capability modules connect software development, integrations, original image/video/audio generation, documents, floor plans, simulators, and CAD/G-code workflows through an auditable planner → permission → sandbox → verification pipeline. Physical-output workflows require simulation and safety checks, and every provider remains subject to its technical, legal, and content-policy boundaries.

## Domain

`insuredspending.org` is the verified canonical production domain. `iabt.insuredspending.org` remains a verified redirect to the canonical root, and the Base44 address remains an emergency fallback. DNS and Base44 custom-domain changes are managed outside this repository.

## Historical baseline

The immutable Legacy Baseline v1.0 remains a separate recovery artifact. Do not overwrite it with this Base44-native implementation.

## GitHub

The repository includes a GitHub Actions verification workflow. Connect one private canonical repository to this Base44 app and protect `main` after the first successful workflow run.
