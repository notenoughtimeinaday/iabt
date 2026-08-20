# IABT — Interactive App Builder Tool

IABT is an AI-assisted SaaS app builder running on Base44. It preserves the original AppDefinition workflow while replacing the localhost-only Express runtime with Base44 authentication, owner-scoped cloud entities, protected backend functions, and managed hosting.

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
- Monthly AI allowances, hourly safety limits, and one-time AI credit packs
- Plan-enforced cloud-project and export access
- Professional Plans & Billing interface
- Secure Stripe test-mode subscription/credit Checkout, Customer Portal, and idempotent signed webhooks
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
- Shared test-mode Stripe guard at `base44/shared/stripe.ts`
- AppDefinition schema version 1.0
- Local draft recovery plus Base44 cloud persistence

The AI function uses `OPENAI_API_KEY` and the OpenAI Responses API when that secret is configured. Without it, the function falls back to Base44 managed AI, so generation remains usable. Usage is measured per authenticated user in hourly safety and UTC monthly buckets; purchased test credit packs are consumed only after the included monthly allowance.

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
- Publish only after `npm run verify` passes.
- Keep the production custom domain attached to this one canonical Base44 app.

## Founding pricing model

| Plan | Monthly price | Projects | Included AI generations | Export/commercial access |
|---|---:|---:|---:|---|
| Free | $0 | 1 | 10/month | Preview, JSON, standalone HTML |
| Builder | $29 | 5 | 100/month | Adds static HTML ZIP |
| Pro | $79 | 25 | 500/month | Adds React exports and commercial use |
| Agency | $199 | Unlimited | 2,000/month | Adds white-label exports and 5 team seats |

One-time AI credit packs add 100 generations for $10. Assisted app-building engagements can be offered separately from $499–$1,500; they are a managed service, not an automated in-app entitlement.

## Stripe test billing

Stripe is intentionally locked to test mode in code. The backend rejects any secret key that does not start with `sk_test_`, and the webhook rejects every Stripe event marked `livemode`.

Before testing paid checkout:

1. Create recurring Builder ($29), Pro ($79), and Agency ($199) prices in the connected Stripe test account.
2. Create a one-time $10 price for the 100-generation AI credit pack.
3. Store their IDs in Base44 Secrets as `STRIPE_BUILDER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_AGENCY_PRICE_ID`, and `STRIPE_AI_CREDIT_PACK_PRICE_ID`.
4. Confirm `STRIPE_SECRET_KEY` is the connected test key and `STRIPE_WEBHOOK_SECRET` is the registered test-endpoint signing secret.
5. Optionally set `IABT_APP_ORIGIN=https://iabt.insuredspending.org`.
6. Use Stripe test cards only and verify plan changes and idempotent credit grants from signed webhook events.

Checkout derives the authenticated user on the server. The browser cannot supply a customer identity, price ID, plan metadata, or redirect destination. Customer Portal access is limited to the Stripe customer stored on the signed-in user's entitlement.

Do not enable live Stripe charges until pricing, policies, refunds, taxes, support, and production webhook behavior are explicitly approved.

## Agentic creation direction

The visual AppDefinition editor is IABT's first creation surface, not its final limit. Future capability modules should connect software development, integrations, original image/video/audio generation, documents, floor plans, simulators, and CAD/G-code workflows through an auditable planner → permission → sandbox → verification pipeline. Physical-output workflows require simulation and safety checks, and every provider remains subject to its technical, legal, and content-policy boundaries.

## Domain

`iabt.insuredspending.org` is connected and live. The Base44 address remains a fallback. DNS changes are outside this repository.

## Historical baseline

The immutable Legacy Baseline v1.0 remains a separate recovery artifact. Do not overwrite it with this Base44-native implementation.

## GitHub

The repository includes a GitHub Actions verification workflow. Connect one private canonical repository to this Base44 app and protect `main` after the first successful workflow run.
