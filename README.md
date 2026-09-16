# Intelligent Application Building Tool (IABT) — JERICHO Studio

The Intelligent Application Building Tool (IABT) is an autonomous creation and project-operations platform whose current public deployment runs on Base44 while a verified standalone runtime is prepared for independent hosting. JERICHO Studio is the single creation front door: it preserves context, plans and quotes work, routes to authorized providers, requires explicit approval, and verifies delivery. Generated app projects are preserved as reviewable project records and deliverable artifacts. The former Visual App Builder is retired from the customer-facing product.

- Production: https://insuredspending.org
- Base44 fallback: https://crazy-creator-flow-hub.base44.app

## What works

- Authenticated Base44 project dashboard
- Cloud load, save, rename, duplicate, delete, import, and search
- Recovery of unsaved local drafts
- User-controlled migration of legacy `iabt.projectsIndex` projects without deleting local originals
- Generated app project records with AppDefinition metadata, files, manifests, and delivery history
- A permanent Deliverable Library independent of conversation history
- Document production as an in-app Markdown preview plus private downloadable DOCX and PDF files
- Generated application delivery as AppDefinition JSON, a Vite/React source ZIP, and a transparent build-readiness report
- Download recovery for inline documents, code, G-code, app packages, and preproduction packages
- Private signed-link retrieval for stored media artifacts, including playable MP3 audio when managed audio production is fully approved
- The former Visual App Builder is retained only as unreachable historical source and is not part of the customer experience
- AI AppDefinition creation through JERICHO Studio's authenticated plan, quote, approval, and verification workflow
- Account entitlements for Free, Builder, Pro, and Agency
- Monthly IABT credit allowances, hourly safety limits, and one-time credit packs
- Bounded self-healing with safe transient retries, durable incident fingerprints, user-visible diagnoses, credit-protection evidence, JERICHO system-health inspection, and pre-revision generated-project inspection
- A user-scoped Integration Center that separates IABT billing from generated-project commerce, records provider cost ownership, and keeps authorization requirements out of the main Studio screen
- IABT Exchange Beta: opt-in collaboration profiles, project capability needs, JERICHO gap analysis, deterministic explainable matching, mutual-consent introductions, private rooms, credential claims, blocking, safety reports, and owner-only review controls
- Plan-enforced cloud-project and export access
- Professional dark-neon JERICHO interface based on the canonical launch artwork
- Professional Plans & Billing interface with visible IABT credit balances and private supplier economics
- Secure Stripe subscription/credit Checkout, Customer Portal, and idempotent signed webhooks with explicit test/live mode separation
- Owner-only Profit & Compliance Control Center with supplier-admission, margin, spending, billing, and launch gates
- Public Trust & Legal Center plus versioned in-app Terms, Privacy, and Acceptable Use acceptance
- JSON import/export
- Standalone HTML, static multi-page HTML ZIP, React source, and runnable Vite/React ZIP exports
- Prompt-inferred runnable JavaScript code scaffolds with tests and explicit limitation reports
- Design specifications with JSON tokens and accessible SVG review boards
- Simulation-only G-code readiness packages with no unverified machine motion
- Disabled dry-run automation runbooks with authorization, idempotency, and recovery gates
- Browser-generated ZIPs with no temporary server filesystem
- Responsive desktop/mobile editor

## Architecture

- React + Vite frontend with an IABT-owned backend adapter boundary
- Current Base44 SDK/Vite adapter for the public deployment
- Standalone Node API and isolated background worker
- PostgreSQL with checksum-verified automatic migrations
- S3-compatible private object storage
- Portable staging containers and independent readiness checks
- Base44 authentication
- Owner-scoped `Project`, `AiUsage`, and `SystemIncident` entities
- User-readable, administrator-managed `AccountEntitlement` entity
- AI function at `base44/functions/generate-app/entry.ts`
- Exchange shared policy and matching logic at `base44/shared/exchange.ts`
- Exchange functions under `base44/functions/*exchange*`, plus project-need, matching, introduction, room, message, credential, block, and report functions
- Stripe functions under `base44/functions/stripe-*`
- Shared Stripe mode/readiness guard at `base44/shared/stripe.ts`
- AppDefinition schema version 1.0
- Local draft recovery plus Base44 cloud persistence

The AI functions use `OPENAI_API_KEY` and the OpenAI Responses API when that secret is configured. Without it, app generation falls back to Base44 managed AI. Every creation reserves authenticated-user IABT credits atomically, captures them only after durable output is verified, and restores them when work fails before a durable result. Usage is tracked in hourly safety and UTC monthly buckets. Paid subscriptions use eligible included credits first; Free-plan paid production and paid-plan overages use purchased credits.

## IABT Exchange Beta

Exchange is a separate collaboration module, not a financial pooling feature. It is available through `/exchange`, with private collaboration rooms at `/exchange/rooms/:roomId` and administrator controls at `/admin/exchange`.

The matching algorithm applies hard eligibility filters first, then scores eligible profiles using disclosed weights: capability fit 35%, jurisdiction and verified credentials 20%, availability 15%, project-stage fit 15%, relationship and compensation fit 10%, and verified reputation signals 5%. Ranking is deterministic; no random selection is used.

Privacy is fail-closed: profiles are opt-in, there is no public contact directory, contact fields are hidden in match results, and each participant separately authorizes disclosure when accepting an introduction. Credential claims are self-reported until administrator review records a verification method. The beta does not process pooled funds, investments, employment placement fees, banking services, insurance, brokerage, or fundraising transactions.

Before public beta, run an authenticated two-account test of profile creation, project needs, matching, introduction acceptance/decline/withdrawal, contact disclosure, private messaging, blocking, reporting, and administrator review. Final privacy and collaboration terms require licensed-counsel review.

## Standalone staging

The host-agnostic staging package is documented in
`STANDALONE_DEPLOYMENT.md`. It includes separate frontend, API, worker, and
PostgreSQL services, automatic checksum-verified migrations, liveness/readiness
checks, non-mutating smoke tests, and guarded backup/restore validation. It does
not change DNS or enable paid providers.

## Local development

The frontend defaults to the standalone IABT API. Install dependencies with
`npm ci`, then create `.env.local`:

```
VITE_IABT_API_URL=http://localhost:8787
```

Run `npm run dev` alongside the standalone server, or use the staging containers
in `STANDALONE_DEPLOYMENT.md`. Production builds require the independent API's
absolute HTTP(S) origin in `VITE_IABT_API_URL` at build time. Missing/invalid
origins fail the build instead of silently selecting Base44. Rebuild the frontend
when its API origin changes.

The standalone entry never loads the Base44 SDK, platform bootstrap, analytics,
or MCP consent page. External AI-client authorization is explicitly unavailable
until an independent consent implementation exists.

During migration only, the current Base44 deployment can still be built by
explicitly setting `VITE_IABT_BACKEND=base44`, `VITE_BASE44_APP_ID`, and
`VITE_BASE44_APP_BASE_URL` in that deployment's build environment. This selects
isolated legacy entries and tooling; it is not the default. The two `@base44`
packages remain installed solely for this temporary compatibility build.

Never place an OpenAI or Stripe key in a `VITE_*` variable or frontend file.

## Verification

Run:

```
npm run verify
```

This runs lint, JavaScript project validation, Exchange/creation checks,
standalone server tests, frontend independence checks, and the production Vite
build. Set `VITE_IABT_API_URL` in `.env.local` or the build environment first.
CI uses a reserved example origin for build verification and does not deploy it.
`npm run verify:frontend` additionally builds both frontend modes, rejects legacy
module/script regressions, and checks invalid API settings. These checks do not
prove live staging, email delivery, data migration, or backend feature parity.
Export verification should also generate both ZIP targets and build the exported React project.

## Base44 setup

- Authentication is enabled for email/password, Google, Microsoft, Facebook, and Apple.
- Optional: add `OPENAI_API_KEY` and `OPENAI_MODEL` through Base44 backend secrets.
- For managed Luma video, add `LUMA_AGENTS_API_KEY`, set `IABT_ENABLE_PAID_MEDIA=true`, and set `IABT_MEDIA_BILLING_READY=true` only after the provider account has a funded balance and spending controls. Set `IABT_LUMA_COMMERCIAL_APPROVED=true` only after the ProviderAgreement record documents embedded use, white-label permission, commercial output rights, privacy/DPA approval, and accepted billing terms.
- For managed audio, add `ELEVENLABS_API_KEY` and a reviewed integer `IABT_ELEVENLABS_COST_PER_MINUTE_CENTS`. Set `IABT_ENABLE_PAID_AUDIO=true`, `IABT_AUDIO_BILLING_READY=true`, and `IABT_ELEVENLABS_COMMERCIAL_APPROVED=true` only after the account is funded, cost controls are verified, and an approved ProviderAgreement documents commercial output, embedded use, white-label, privacy/DPA, and billing rights.
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

JERICHO Studio is IABT's single prompt-first creation surface. Users describe the objective; JERICHO infers the output type and required tools instead of forcing an app/website/media/document mode. Generated applications are preserved as project records and delivered as AppDefinition JSON, Vite/React source ZIPs, and explicit build-readiness reports; the former Visual App Builder is retired from customer-facing routes. Documents are delivered in Markdown, DOCX, and PDF. Playable audio is available only when the managed audio provider and all commercial gates are active; otherwise IABT produces clearly labeled preproduction. Capability modules connect software development, integrations, original image/video/audio generation, documents, floor plans, simulators, and CAD/G-code workflows through an auditable planner → permission → sandbox → verification pipeline. Physical-output workflows require simulation and safety checks, and every provider remains subject to its technical, legal, and content-policy boundaries.

## Domain

`insuredspending.org` is the verified canonical production domain. `iabt.insuredspending.org` remains a verified redirect to the canonical root, and the Base44 address remains an emergency fallback. DNS and Base44 custom-domain changes are managed outside this repository.

## Historical baseline

The immutable Legacy Baseline v1.0 remains a separate recovery artifact. Do not overwrite it with this Base44-native implementation.

## GitHub

The repository includes a GitHub Actions verification workflow. Connect one private canonical repository to this Base44 app and protect `main` after the first successful workflow run.
