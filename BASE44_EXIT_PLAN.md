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

## Implementation status

Completed in the independent runtime:

- IABT-owned frontend client boundary
- standalone authentication, sessions, and tenant-owned entity API
- PostgreSQL core schema
- durable PostgreSQL job queue with lease recovery and idempotency
- transactional reserve, capture, and release credit lifecycle
- durable incidents with safe user-facing diagnoses
- private S3-compatible object storage with short-lived download URLs
- development-only local object storage with signed links
- fail-closed OpenAI, ElevenLabs, Luma, and Stripe adapters
- worker contract that captures credits only after verified durable storage
- prompt-first automatic intent inference with no required mode selector
- signed server-owned quotes and exact approval matching
- protected server-managed plan, billing, consent, artifact, and incident records
- deterministic app and website orchestration with working preview, AppDefinition, source ZIP, and validation report
- standalone piano-app and merchandise-storefront golden-path tests
- standalone Markdown, DOCX, and PDF document export with durable artifact verification
- asynchronous Luma submission, restart-safe polling, MP4 ingestion, and media-signature verification
- verified Stripe checkout, customer portal, credit-pack, webhook-signature, replay-protection, and entitlement core
- Base44 export-package validation with identity, ownership, file-hash, credential-field, and count reconciliation
- cost-capped managed image generation with server-owned quotes and verified private PNG artifacts
- checksum-verified automatic PostgreSQL migrations with concurrent-start locking
- separately scalable API and background-worker processes
- portable frontend/API/worker/PostgreSQL staging containers
- database and private-object-storage readiness probes
- non-mutating independent staging smoke tests
- checksum-manifested PostgreSQL backups and guarded disposable restore validation
- prompt-inferred runnable code scaffolds with explicit implementation limits
- reviewable design specifications, design tokens, and accessible SVG boards
- simulation-only G-code safety packages that never claim machine readiness
- disabled-by-default automation runbooks with approval and idempotency gates

Still required before cutover:

- request-specific code synthesis and sandbox execution beyond the verified scaffold
- authorized integration adapters for automation execution; machine-ready G-code remains CAM/operator gated
- complete Stripe test lifecycle against the owner's Stripe test account
- Base44 live record/file export, staged import, and post-import reconciliation
- deploy the prepared independent staging stack and connect monitoring
- execute backup/restore validation and 20 consecutive golden-path runs

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
