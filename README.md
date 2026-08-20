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
- Account entitlements for Free, Builder, and Pro
- Professional Plans & Billing interface
- Secure Stripe test-mode Checkout, Customer Portal, and signed webhook scaffolding
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

The AI function uses `OPENAI_API_KEY` and the OpenAI Responses API when that secret is configured. Without it, the function falls back to Base44 managed AI, so generation remains usable.

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

## Stripe test billing

Stripe is intentionally locked to test mode in code. The backend rejects any secret key that does not start with `sk_test_`.

Before testing Builder or Pro checkout:

1. Create recurring Builder and Pro prices in the connected Stripe test account.
2. Store their IDs in Base44 Secrets as `STRIPE_BUILDER_PRICE_ID` and `STRIPE_PRO_PRICE_ID`.
3. Confirm `STRIPE_SECRET_KEY` is the connected test key and `STRIPE_WEBHOOK_SECRET` is the registered endpoint signing secret.
4. Optionally set `IABT_APP_ORIGIN=https://iabt.insuredspending.org`.
5. Use Stripe test cards only and verify entitlement changes from signed webhook events.

Checkout derives the authenticated user on the server. The browser cannot supply a customer identity, price ID, plan metadata, or redirect destination. Customer Portal access is limited to the Stripe customer stored on the signed-in user's entitlement.

Do not enable live Stripe charges until pricing, policies, refunds, taxes, support, and production webhook behavior are explicitly approved.

## Domain

`iabt.insuredspending.org` is connected and live. The Base44 address remains a fallback. DNS changes are outside this repository.

## Historical baseline

The immutable Legacy Baseline v1.0 remains a separate recovery artifact. Do not overwrite it with this Base44-native implementation.

## GitHub

The repository includes a GitHub Actions verification workflow. Connect one private canonical repository to this Base44 app and protect `main` after the first successful workflow run.
