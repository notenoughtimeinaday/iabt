# Staging download acceptance — September 28, 2026

This is a bounded delivery check of existing artifacts. It is not production
launch approval or proof that generated applications function correctly.

## Observed starting state

- Render's confirmed workspace reports both the API and staging frontend live at
  `e1cdd7503eeeb3204b8e5309378cdee93cfcd27e` (deployed September 24).
- Secure browser sign-in succeeded. The normal app displayed Builder and 209
  available credits. Its Deliverables page listed the existing source-review
  Markdown, DOCX and PDF plus the original source.
- Clicking the Markdown Download button reached private storage and displayed
  the Markdown as inline page text. No browser download event occurred in the
  20-second observation. The expected verification marker was visible.
- The storage URL requested an attachment response, but the observed browser
  behavior was inline rendering. The previous popup-handoff fix did not establish
  reliable downloads with this storage provider.

Signed URLs, credentials, account identifiers and storage paths are deliberately
excluded from this record.

## Repair and verification boundary

The repair gives the API responsibility for attachment headers and bounded private
streaming. Owner-authorized access issues a short-lived API capability; the gateway
resolves the persisted object, enforces provider/size/checksum and transfer bounds,
and aborts storage reads when the browser disconnects. Existing files are reused.
No new generation, database migration, paid hosting upgrade, production DNS change
or merge into the default branch is part of this repair.

Local `npm run verify` passed: 272 backend checks passed and 24 database checks
were skipped because this runner has no disposable PostgreSQL instance. All 14
file, 5 frontend and 8 readiness checks passed, as did lint, typecheck and the
production build. The focused backend delivery/source checks passed 28/28 with
no skips. GitHub Actions must run the PostgreSQL checks before staging deployment.

CI results, the deployed repair commit, saved-file hashes, reopening, rendered
content and final balance must be recorded after verification. At this checkpoint,
repaired hosted delivery remains **pending**. The earlier owner
correction remains open until its separate explicit acceptance requirements pass.
