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
no skips.

GitHub Actions run `36461619177` passed full repository verification, including
disposable PostgreSQL integration, for branch commit
`0ee609729c5b5719474887e41bc0b1f8f22efcfd`. Its PR merge checkout was
`bc901c3c3baf8b50655ee9d91dc58461adc31705`; both commits have identical tree
`f251dafa1e6f0bfa270c059fe416d2610650b6e7`. The uploaded readiness report was
inspected and reports all repository gates passed, with live acceptance separate.

## Deployment continuation

The repair has not been deployed. The Render connector can read the confirmed
workspace, but its deployment operation cannot select a commit. Both services
track `main` with automatic deployment off, so a generic deploy would select the
wrong source. Dashboard access to the existing workspace is required to deploy
the exact tested repair commit. Browser authentication has not established that
access; the browser remains on Render's sign-in page.

After account access is established:

1. Verify the API's nonsecret `IABT_API_ORIGIN` equals its public staging origin.
2. Deploy exact commit `0ee609729c5b5719474887e41bc0b1f8f22efcfd` to the existing
   API and staging frontend using the dashboard's specific-commit deployment.
3. Reuse the existing Markdown, DOCX and PDF source-review artifacts. Confirm
   native browser download completion, saved bytes/hash, readable content and
   layout, and repeat retrieval after reloading Deliverables.
4. Confirm the observed 209-credit balance is unchanged by download-only checks.
   Record hosted results separately; do not close the owner's correction without
   its explicit acceptance, or imply generated-code/runtime acceptance.

The deployed repair commit, saved-file hashes, reopening, rendered
content and final balance must be recorded after verification. At this checkpoint,
repaired hosted delivery remains **pending**. The earlier owner
correction remains open until its separate explicit acceptance requirements pass.
