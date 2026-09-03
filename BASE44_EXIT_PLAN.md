# IABT-JERICHO Base44 Independence Migration

## Objective

Operate IABT-JERICHO without Base44 hosting, authentication, data, storage,
functions, agents, integrations, billing, or publishing. GoDaddy remains the
domain registrar. DNS changes only after the independent environment passes the
full verification suite.

## Confirmed current dependencies

- React/Vite frontend with Base44 SDK and Vite plugin
- Base44 authentication and user records
- 29 application entity schemas
- 31 backend functions
- JERICHO and Exchange agent conversations
- private artifact storage and signed download URLs
- integration calls for language models, images, and uploads
- Stripe webhooks and entitlements hosted as Base44 functions
- Base44 custom-domain hosting for insuredspending.org

## Independence boundary

All feature code imports `src/api/iabtClient.js`. That module can select the
legacy Base44 adapter or the standalone IABT API through
`VITE_IABT_BACKEND`. No feature page should import the Base44 SDK directly.

## Required standalone services

1. HTTP API and background job workers
2. PostgreSQL data store with tenant/user ownership enforcement
3. authentication with email/password, Google OAuth, OTP, reset, and sessions
4. private object storage with short-lived signed URLs
5. durable creation jobs, retries, incidents, and credit reconciliation
6. direct OpenAI, ElevenLabs, Luma, Stripe, GitHub, and user-authorized adapters
7. monitoring, audit logs, backups, and restore tests
8. independent hosting for the frontend and API

## Safe cutover order

1. Preserve GitHub source and export all Base44 records and files.
2. Build the standalone API behind the IABT client boundary.
3. Run both environments against test providers.
4. Import data into staging and verify record/file counts.
5. Pass 20 consecutive golden-path tests and Stripe sandbox lifecycle tests.
6. Put Base44 in read-only maintenance mode.
7. Change GoDaddy DNS to the independent frontend/API.
8. Monitor authentication, jobs, webhooks, and downloads.
9. Cancel Base44 only after the rollback window closes.

## Non-negotiable approval gates

JERICHO may diagnose and safely retry internal work, but it must not silently
charge providers, enable live Stripe, publish legal terms, expose credentials,
increase spend limits, delete data, or change DNS.
