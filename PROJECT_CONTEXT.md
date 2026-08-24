# IABT Project Context

## Canonical Base44 app

- Name: IABT-JERICHO
- App ID: `6a849bcd3e04d068553b4af7`
- Production URL: https://iabt.insuredspending.org
- Base44 fallback: https://crazy-creator-flow-hub.base44.app
- Architecture: React/Vite + Base44 SDK/auth/entities/functions
- AppDefinition schema: 1.0

## Migration decision

The current app is Base44-native. The historical Node/Express implementation remains preserved as an immutable legacy baseline and is not modified by this repository.

## Preserved capabilities

Pages, components, routing, inspector editing, ScannerInput, local recovery, AI generation, project persistence, JSON import/export, HTML/ZIP exports, React exports, and live preview are all represented in the Base44 implementation.

## Founding product origin

The original **Pooled Layout** for Insured Spending is a foundational IABT use case: many small, transparent member contributions coordinated toward a larger member purchase benefit. Its workflow and financial-modeling requirements helped motivate IABT as a builder that can create complete systems rather than simple pages. The canonical origin, unresolved economic choices, and regulated-finance boundary are preserved in [INSURED_SPENDING_ORIGIN.md](./INSURED_SPENDING_ORIGIN.md).

The initial IABT version of this concept must remain a no-real-money prototype and simulation until its exact structure is legally classified and implemented with appropriate licensed partners.

## External setup

- Sign in through the Base44-hosted login.
- Optional: configure `OPENAI_API_KEY` and `OPENAI_MODEL` in Base44 backend secrets for direct OpenAI Responses API usage.
- Luma Ray 3.2 requires a funded provider account, `LUMA_AGENTS_API_KEY`, and both paid-media safety gates.
- Stripe subscriptions and IABT credit packs fund user allowances; Stripe does not directly refill the separate Luma provider balance.
- Publish from Base44 after `npm run verify` passes.
- Do not change DNS without explicit authorization.

## Consolidated monetization status

- Stripe live-mode readiness is implemented with recurring Builder, Pro, and Agency subscriptions plus one-time IABT credit packs.
- Approved creations reserve the exact quoted IABT credits, capture them after durable verified output, and restore them when no durable output is produced.
- Customers buy plans and credits from IABT through Stripe. IABT owns the customer relationship, quote, markup, credit ledger, delivery, and refund/restoration policy. Paid supplier work uses private IABT-managed accounts only after an approved job requires it; supplier brands remain internal unless disclosure is legally or contractually required.
- The Luma Ray 3.2 path reached the provider successfully during live testing, then failed with `insufficient funds`. This proves the request path but not a successful MP4 delivery. The IABT owner must fund or auto-reload the Luma master provider account before another live renderer acceptance test.
- Do not market video rendering as unlimited. The published plan allowances and exact per-job quotes remain the commercial control.

## Candidate domain

`iabt.insuredspending.org`
