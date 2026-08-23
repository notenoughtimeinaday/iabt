# IABT-JERICHO — Autonomous Interactive App Building

IABT-JERICHO is an autonomous project operator and visual SaaS app builder running on Base44. It preserves the original AppDefinition workflow while adding conversational planning, provider-neutral routing, explicit approval and credit controls, verified delivery, Base44 authentication, owner-scoped cloud entities, protected backend functions, and managed hosting.

- Production: https://iabt.insuredspending.org
- Base44 fallback: https://crazy-creator-flow-hub.base44.app

## What works

- Authenticated Base44 project dashboard
- Cloud create, load, save, rename, duplicate, delete, and search
- Recovery of unsaved local drafts
- User-controlled migration of legacy `iabt.projectsIndex` projects without deleting local originals
- Multi-page visual editor with page add, rename, duplicate, delete, and reorder
- Text, Input, Button, and ScannerInput components
- Component selection, inspector editing, deletion, reorder, undo, and redo
- Page routing and live phone/tablet preview
- Keyboard-wedge barcode/QR scanning; Enter dispatches a bubbling `iabt:scan` event
- AI AppDefinition generation through an authenticated, per-user rate-limited function
- Account entitlements for Free, Builder, Pro, and Agency
- Monthly IABT credit allowances, hourly safety limits, and one-time credit packs
- Plan-enforced cloud-project and export access
- Professional dark-neon JERICHO interface based on the canonical launch artwork
- Professional Plans & Billing interface with visible IABT credit balances and provider-cost economics
- Secure Stripe subscription/credit Checkout, Customer Portal, and idempotent signed webhooks with explicit test/live mode separation
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

The AI functions use `OPENAI_API_KEY` and the OpenAI Responses API when that secret is configured. Without it, app generation falls back to Base44 managed AI. Every creation reserves authenticated-user IABT credits atomically, captures them only after durable output is verified, and restores them when work fails before a durable result. Usage is tracked in hourly safety and UTC monthly buckets; purchased credits are consumed only after an eligible included monthly allowance.

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
- For Luma Ray 3.2 video, add `LUMA_AGENTS_API_KEY`, set `IABT_PAID_MEDIA_ENABLED=true`, and set `IABT_MEDIA_BILLING_READY=true` only after the provider account has a funded balance and spending controls.
- Publish only after `npm run verify` passes.
- Keep the production custom domain attached to this one canonical Base44 app.

## Founding pricing model

| Plan | Monthly price | Projects | Included IABT credits | Export/commercial access |
|---|---:|---:|---:|---|
| Free | $0 | 1 | 10/month | Preview, JSON, standalone HTML |
| Builder | $29 | 5 | 100/month | Adds static HTML ZIP |
| Pro | $79 | 25 | 500/month | Adds React exports and commercial use |
| Agency | $199 | Unlimited | 2,000/month | Adds white-label exports and 5 team seats |

One-time packs add 100 IABT credits for $10. Credits can fund app generation and weighted paid-media rendering. Assisted app-building engagements can be offered separately from $499–$1,500; they are a managed service, not an automated in-app entitlement.

## Stripe billing

Stripe defaults to safe test mode. Set `IABT_STRIPE_MODE=test` (or omit it) with `sk_test_` credentials for testing. Live payment support is code-ready but activates only when `IABT_STRIPE_MODE=live` is explicitly configured with matching `sk_live_` credentials and live Stripe resources. Webhook events whose test/live mode does not match the configured mode are rejected.

Required Stripe secrets for either mode:

1. Create recurring Builder ($29), Pro ($79), and Agency ($199) prices in the selected Stripe mode.
2. Create a one-time $10 price for the 100-credit IABT pack in the same mode.
3. Store their IDs in Base44 Secrets as `STRIPE_BUILDER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_AGENCY_PRICE_ID`, and `STRIPE_AI_CREDIT_PACK_PRICE_ID`.
4. Set `STRIPE_SECRET_KEY` to the matching test or live secret key and `STRIPE_WEBHOOK_SECRET` to the signing secret for the matching webhook endpoint.
5. Set `IABT_APP_ORIGIN=https://iabt.insuredspending.org` and set `IABT_STRIPE_MODE=test` while validating the release.
6. Configure the Customer Portal product catalog, then verify checkout, plan changes, cancellation, failed-payment handling, delayed-payment credit grants, and webhook idempotency with test resources before switching modes.

Checkout derives the authenticated user on the server. The browser cannot supply a customer identity, price ID, plan metadata, or redirect destination. Customer Portal access is limited to the Stripe customer stored on the signed-in user's entitlement. The billing UI receives only non-secret readiness booleans and the configured mode.

Do not set `IABT_STRIPE_MODE=live` until pricing, policies, refunds, taxes, support, production price IDs, production webhook behavior, and an end-to-end test release are explicitly approved. Switching to live mode can create real charges.

## Luma video and IABT credit economics

Stripe and Luma are separate accounts: subscription and credit-pack revenue settles through Stripe, while Ray 3.2 rendering spends the IABT owner's Luma balance. Stripe payments do not directly refill Luma. Keep a controlled Luma balance or enable Luma auto-reload with a conservative threshold and reload amount.

Paid Luma quotes use weighted IABT credits. One IABT credit covers at most 5 cents of quoted provider/platform cost, rounded up. A request reserves its exact credit amount only after explicit approval. Credits are captured after the MP4 is copied to durable private Base44 storage; they are restored when Luma rejects the request before queuing or when no durable result is produced. The Free plan's included credits cannot fund Luma, but a Free user may render with enough purchased credits. Paid-plan included credits are eligible.

## Agentic creation direction

The visual AppDefinition editor is IABT's first creation surface, not its final limit. Future capability modules should connect software development, integrations, original image/video/audio generation, documents, floor plans, simulators, and CAD/G-code workflows through an auditable planner → permission → sandbox → verification pipeline. Physical-output workflows require simulation and safety checks, and every provider remains subject to its technical, legal, and content-policy boundaries.

## Domain

`iabt.insuredspending.org` is connected and live. The Base44 address remains a fallback. DNS changes are outside this repository.

## Historical baseline

The immutable Legacy Baseline v1.0 remains a separate recovery artifact. Do not overwrite it with this Base44-native implementation.

## GitHub

The repository includes a GitHub Actions verification workflow. Connect one private canonical repository to this Base44 app and protect `main` after the first successful workflow run.
