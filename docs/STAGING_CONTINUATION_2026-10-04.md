# Isolated staging continuation October 4 2026

Continue from the existing `jericho-autonomy-v1` branch and PR 4. The hosted
file acceptance below tested a530f21557753731486ea3a4eaf3c2200a47e0c0 before
the email-validation and refund-observation changes in this continuation.
The current verified runtime/deployment baseline is now
`286b99da93ae7a0dda580d2d5d762824fa679b84`; see
[CURRENT_RELEASE_STATUS.md](CURRENT_RELEASE_STATUS.md) for exact CI, deployment
identities, environment and remaining launch gates. The checks below retain
their tested-commit scope rather than attributing every workflow to the newer
candidate.

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
  DOCX ZIP integrity and document XML content passed. The later October 4 review
  opened that same downloaded DOCX read-only in Microsoft Word, exported a PDF,
  and inspected both rasterized pages: the marker and all three requirements
  were legible, with no clipping or overlapping text. Original download bytes
  were unchanged. This supersedes the earlier LibreOffice-related visual gate
  for this sample; it does not establish arbitrary Office-input parsing.
- Anonymous access to the source-file API returned 401. This proves that
  unauthenticated source access was denied, not that a valid signed download
  capability requires a session. Hosted second-account denial, password recovery
  and a real storage restart/restore remain open.

The saved hosted evidence records six downloads on a530f21 (all three formats
before and after reopening) and one further PDF download on 78d1c82. On the newer
candidate the authenticated session, conversation and job persisted, the balance
remained 9, and the PDF hash still matched. One pointer activation timed out
without a download event; keyboard activation succeeded. Its cause remains
unestablished, so this evidence does not claim every activation path passed.

| Download | Bytes | SHA-256 |
| --- | ---: | --- |
| Markdown | 2032 | `c395c8455315f574c4ee6de0a2888e4e14677d9a0290beec418e3b79c22696fe` |
| DOCX | 9729 | `d660782144add01040c52b8266bec1d58a8d63313b67226cffff4f72c0cfd0f1` |
| PDF | 3986 | `5e8423422da34c84d94d2430bdada9becab3efd1aea78251366e46d4c4b18d35` |

These results reuse one existing account and job. They do not justify generating
a replacement output or spending another credit to repeat a passed check.

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
production build passed. The refund PostgreSQL test was included; earlier
documentation saying it was skipped is superseded.

[GitHub verification run 674](https://github.com/notenoughtimeinaday/iabt/actions/runs/37215305665)
passed on exact published commit 78d1c82. Both existing isolated Render services
deployed that commit: API `dep-db17i5142hec73eddecg` and frontend
`dep-db17i93ncjis73bi1nc0`. Readiness reported six applied migrations, none pending
and no Base44 runtime requirement. Deployed email validation rejected copied
list-marker addresses while preserving plus aliases. These local, CI,
deployment and hosted facts are separate evidence scopes.

## Billing-mode and storage-read follow-up

The next code candidate, `286b99da93ae7a0dda580d2d5d762824fa679b84`, published
tree `a74c0920322e5793a31bb5a59cb523e019e27bde`. It adds the private database
billing-mode binding and bounded storage-read timeouts, with matching curriculum
entries. The complete existing suite passed: 352 server, 16 file/email, five
frontend-isolation and eight readiness tests (**381 total, zero failed or
skipped**), including 56 observed PostgreSQL checks. Lint, type checking,
Exchange/creation checks and the production build passed.

[GitHub verification run 675](https://github.com/notenoughtimeinaday/iabt/actions/runs/37219964688)
passed on exact commit 286b99d. Both isolated Render deployments are Live on that
commit: API `dep-db18lm1mgk9c73d5c1pg` and frontend
`dep-db18lmvr12us739rm4a0`. Readiness reported healthy database and S3 access,
configured Resend, seven applied migrations and none pending. The queried API
error-log window since October 4 at 17:20 UTC returned no entries.

After browser reload, the saved conversation, source, one completed job and its
three artifacts remained, with nine credits. A native browser download saved
the existing 3986-byte PDF; SHA-256
`5e8423422da34c84d94d2430bdada9becab3efd1aea78251366e46d4c4b18d35`
matched the originally accepted file. No replacement job, generation or credit
spending occurred. The earlier MD/DOCX checks and Word/PDF visual review remain
at their original scope; this follow-up verifies persistence and renewed PDF
delivery on 286b99d, not a fresh review of all formats or a hosted timeout fault
injection.

The deployed learning endpoint returned 200 and included
`billing.database_mode_binding` and `files.bounded_storage_read_timeout`.
Curriculum digest
`9e41f7c8ec1540d2400de82981b631ab2c8b487bf28a583c4fa9990b5452d8c7`
matched the local candidate. This proves the published instructions were loaded,
not that learning grants financial authority or that every future repair works.

The first local verification attempt failed safely on a migration-checksum
mismatch in an older disposable database after Windows line-ending conversion.
The passing run used a fresh disposable database, without weakening checksum
validation. During deployment, an environment update triggered a Render deploy
despite auto-deploy being disabled. Inspect recent/current deployment IDs and
commits after future environment changes before manually triggering another
deploy. The later documentation-only evidence update does not require a new
runtime deployment; 286b99d remains the runtime baseline.

## Evidence provenance and remaining acceptance

This continuation consolidates the October 4 `IABT-completion-ledger.json` and
`IABT-hosted-file-acceptance.json` from the existing completion workspace. The
file record was updated at `2026-10-04T16:20:36.510Z` for the Word review; it
preserves the original a530f21 hashes and the 78d1c82 post-deployment scope. The
GitHub CI result and existing isolated services were independently rechecked
during this continuation. No sensitive session links, credentials or inbox
codes are retained here.

The subsequent October 4 Stripe read succeeded but exposed only the existing
IABT-JERICHO test account `acct_1U6O5GDTeg6LQ8RA`, with no active prices and one
legacy Base44 webhook. The owner later reported reconnecting the earlier Insured
Spending test account `acct_1TOYQhJQwCRZm16s`, but a fresh connector account
listing still exposed only the legacy account. Correct-account access remains
unverified; this does not establish that the owner failed to reconnect it.
The isolated API's mode is `test`, with an empty Builder price ID. Correct
account selection and isolated price/webhook configuration remain incomplete;
this supersedes the earlier generic connector-reauthentication blocker. Test
payments require no real purchase or account funding. Neither account's prices,
credentials nor webhook configuration were changed by this documentation work.

The sample delivery and observation inbox are completed only within those
scopes. Hosted second-account denial, password recovery, provider billing
lifecycle, refund/dispute financial reconciliation, hosted disaster recovery,
pricing rollout and final launch acceptance remain open. Keep production and
domain changes gated on release acceptance and retain the owner's free-hosting
choice. Free hosting does not establish an always-running worker.
