# Isolated staging continuation October 4 2026

Continue from the existing `jericho-autonomy-v1` branch and PR 4. The hosted
file acceptance below tested a530f21557753731486ea3a4eaf3c2200a47e0c0 before
the email-validation and refund-observation changes in this continuation.

## Hosted evidence

- Reused an existing verified account, Studio conversation and test fixture.
- Uploaded `server/test/fixtures/jericho-upload-project.md` through Studio.
  Its 175 bytes and SHA-256
  `96d6a4006f623ac5b40db0c60bbb74490c1c430694c564d822b541fc15a2b88d`
  match the generated source inventory.
- One source-review job completed with three saved outputs. The visible credit
  balance changed from 10 to 9, with no external provider charge for this route.
- Actual browser download events produced Markdown, DOCX and PDF files.
  All contain the source-only verification marker and all three requirements.
- Reopened Studio: sign-in, conversation, attachment and completed job persisted.
  Downloaded all three outputs again; each SHA-256 matched its initial download.
  The balance remained 9 and the conversation still showed one job.
- Rendered both PDF pages and visually checked legibility and source evidence.
  DOCX ZIP integrity and document XML content pass, but visual DOCX acceptance
  remains open because the local renderer lacks LibreOffice.
- Hosted anonymous and second-account denial, password recovery, and a real
  storage restore are not established by this check.

## Email delivery correction

A copied list marker before a registered email address previously received the
same generic response as a valid unknown account. The API now rejects malformed
addresses for registration, verification-code requests and password-reset
requests. Login's verification button uses the same validation before sending.
Valid unknown and already-verified accounts retain generic responses. Plus
aliases stay distinct; no punctuation is stripped to guess another identity.

Regression checks cover the actual malformed-address reproducer, preservation
of a previously valid challenge, plus-address ownership, normalization, and
existing account privacy and recovery contracts with memory and PostgreSQL.

## Recovered refund observations

Reused the eleven recovered September 30 files after checking their recovery
manifest hashes against the existing a530f21 baseline. Migration 006 creates an
operator-only immutable refund-observation inbox. Signed same-mode events and
replays explicitly require reconciliation; they do not adjust credits or cash.

The disposable PostgreSQL test covers concurrent instances, interrupted event
completion, reopening, and stale claims. Full refund payment association,
partial/spent-credit policy and actual Stripe sandbox lifecycle acceptance
remain incomplete. Do not describe the observation inbox as finished refunds.

## Local verification

`npm run verify` passed with a disposable loopback PostgreSQL database:
336 server tests, 16 file/email tests, 5 frontend-isolation tests and 8 readiness
tests; zero skipped tests. Lint, type checking, Exchange/creation checks and the
production build passed. This is separate from CI and hosted acceptance of the
new candidate. Keep production and domain changes gated on release acceptance.
