# IABT Project Context

## Canonical Base44 app

- Name: IABT-JERICHO
- App ID: `6a849bcd3e04d068553b4af7`
- Production URL: https://insuredspending.org
- Base44 fallback: https://crazy-creator-flow-hub.base44.app
- Architecture: React/Vite + Base44 SDK/auth/entities/functions
- AppDefinition schema: 1.0

## Migration decision

The current app is Base44-native. The historical Node/Express implementation remains preserved as an immutable legacy baseline and is not modified by this repository.

## Preserved capabilities

The former Visual App Builder remains preserved only as unreachable historical source. JERICHO Studio is the sole customer-facing creation experience. Generated app projects remain available as reviewable records with AppDefinition metadata, files, manifests, and delivery history. A permanent Deliverable Library recovers documents, code, G-code, private media, and preproduction packages independently of conversation history.

## Founding product origin

The original **Pooled Layout** for Insured Spending is a foundational IABT use case: many small, transparent member contributions coordinated toward a larger member purchase benefit. Its workflow and financial-modeling requirements helped motivate IABT as a builder that can create complete systems rather than simple pages. The canonical origin, unresolved economic choices, and regulated-finance boundary are preserved in [INSURED_SPENDING_ORIGIN.md](./INSURED_SPENDING_ORIGIN.md).

The initial IABT version of this concept must remain a no-real-money prototype and simulation until its exact structure is legally classified and implemented with appropriate licensed partners.

## External setup

- Sign in through the Base44-hosted login.
- Optional: configure `OPENAI_API_KEY` and `OPENAI_MODEL` in Base44 backend secrets for direct OpenAI Responses API usage.
- Managed Luma video requires a funded provider account, `LUMA_AGENTS_API_KEY`, paid-media and billing safety gates, an approved ProviderAgreement, and `IABT_LUMA_COMMERCIAL_APPROVED=true`.
- Stripe subscriptions and IABT credit packs fund user allowances; Stripe does not directly refill the separate Luma provider balance.
- Publish from Base44 after `npm run verify` passes.
- Do not change DNS without explicit authorization.

## Consolidated monetization status

- Stripe live-mode readiness is implemented with recurring Builder, Pro, and Agency subscriptions plus one-time IABT credit packs.
- Approved creations reserve the exact quoted IABT credits, capture them after durable verified output, and restore them when no durable output is produced.
- Builder, Pro, and Agency subscriptions can apply included credits to eligible paid third-party production. Free-plan production and paid-plan overage require purchased credits. The default rate maps no more than 3 cents of supplier cost to a 10-cent production credit, targeting roughly 70% gross margin before other expenses.
- Supplier execution is blocked unless agreement rights, privacy/DPA review, margin floor, per-job ceiling, and daily/monthly spend limits pass.
- Customers buy plans and credits from IABT through Stripe. IABT owns the customer relationship, quote, markup, credit ledger, delivery, and refund/restoration policy. Paid supplier work uses private IABT-managed accounts only after an approved job requires it; supplier brands remain internal unless disclosure is legally or contractually required.
- After the IABT owner funded Luma, a Ray 3.2 job completed successfully, received a provider job ID, and was copied into private Base44 storage before its IABT credit reservation was captured. Keep the separate Luma master provider balance funded or configure a conservative auto-reload threshold.
- Do not market video rendering as unlimited. The published plan allowances and exact per-job quotes remain the customer control; the owner-only Profit & Compliance Control Center governs private supplier economics.
- The Trust & Legal Center and versioned policy-acceptance gate are implemented as prelaunch policies. Final counsel review and verified legal/privacy/support contact details remain required before paid public launch.

## Canonical domain

`insuredspending.org` is the verified production domain. `iabt.insuredspending.org` redirects to it for backward compatibility.
