# Current IABT release status — October 5, 2026

The standalone candidate has verified sample file delivery, a deployed refund
observation inbox, durable billing-mode protection and bounded storage reads.
An actual isolated test subscription payment, pending Checkout reuse and
same-event invoice replay also passed on October 5, followed by credit-pack
decline/recovery, a verified 100-credit pack grant and same-event pack replay.
**Full paid launch is not accepted.** Reuse the existing
candidate and isolated environment; do not restart completed upload, download,
email-validation or refund-observation implementation.

## Canonical candidate and environment

| Item | Verified identity |
| --- | --- |
| Repository | [notenoughtimeinaday/iabt](https://github.com/notenoughtimeinaday/iabt) |
| Branch / review | `jericho-autonomy-v1`, [draft PR 4](https://github.com/notenoughtimeinaday/iabt/pull/4) |
| Runtime candidate | `286b99da93ae7a0dda580d2d5d762824fa679b84` |
| Published tree | `a74c0920322e5793a31bb5a59cb523e019e27bde` |
| CI | [Run 675 — passed](https://github.com/notenoughtimeinaday/iabt/actions/runs/37219964688) on that exact commit |
| Isolated frontend | [iabt-isolated-staging-web](https://iabt-isolated-staging-web.onrender.com/#/login) |
| Isolated API | [iabt-isolated-staging-api](https://iabt-isolated-staging-api.onrender.com) |
| API deployment | `dep-db254s6k1f9s73953slg` — October 5 Stripe environment update, same runtime commit |
| Frontend deployment | `dep-db18lmvr12us739rm4a0` |
| Neon | Project `noisy-bread-33052649`, branch `br-mute-heart-b517gyel`, database `iabt_staging_isolated` |
| Schema | Seven applied migrations; none pending |

Both isolated deployments are Live on the exact runtime candidate. Later
documentation-only commits record these results and do not imply another
runtime deployment. The October 4 API deployment `dep-db18lm1mgk9c73d5c1pg`
and previous 78d1c82 baseline remain historical evidence in the dated
continuation.

This is the current acceptance environment. The older
`iabt-api-insured-spending` / `iabt-staging-web` pair and its shared database are
historical test evidence. Do not deploy there or use its payment/account state
as a substitute for current isolated acceptance. The independent runtime remains
Render, Neon/private object storage, Resend and GitHub; Base44 is historical.
Keep the existing free hosting, main branch, public domain and production
configuration unchanged until release acceptance.

## Verified, with scope

- **Deployed baseline local verification:** 352 server, 16 file/email, five
  frontend-isolation and eight readiness tests (**381 total, zero failed or
  skipped**), including 56 observed PostgreSQL checks; lint,
  type checking, Exchange/creation checks and production build passed. Exact
  published candidate CI and both isolated deployments passed separately.
- **Unpublished price-contract candidate:** 87 focused tests and the complete
  local suite of **393 tests, zero failed or skipped**, passed. Lint, type
  checking, Exchange/creation and frontend checks passed. The final production
  build first failed because `VITE_IABT_API_URL` was missing; rerunning with
  the correct isolated API origin passed. Overall local checks are green after
  that configuration correction. Publication, exact-commit CI, deployment and
  hosted acceptance of this candidate remain pending; runtime 286b99d remains
  the deployed baseline.
- **Hosted sample delivery:** one source-review job used one starter credit
  (10 to 9), produced actual Markdown/DOCX/PDF downloads, and retained matching
  hashes after reopening. Word and PDF pages were visually inspected. Those
  six downloads used a530f21; saved state and one matching PDF download also
  passed on 78d1c82. After deployment to 286b99d, browser reload preserved the
  same conversation, source, one completed job, three artifacts and nine credits.
  A native PDF download again saved 3986 bytes with the original SHA-256. No
  new generation or credit spending occurred during those October 4 rechecks.
  The earlier pointer-activation
  timeout remains unexplained; no hosted timeout fault injection was performed.
- **Account usability:** verification email delivery and authenticated Studio
  access were observed, saved sessions survived reopening/deployment, malformed
  copied email text now receives a validation error, and plus aliases remain
  distinct. Password recovery and two-account hosted isolation are not closed.
- **Isolated initial subscription payment:** October 5 runtime 286b99d used a
  restricted test key, dedicated 15-event test webhook, legacy prices and the
  unique isolated app marker. Two concurrent Builder clicks and cancellation/
  reopen reused one Checkout session; a pending Pro request returned HTTP 409
  `stripe_checkout_terms_conflict`. A legacy Builder $29 test payment granted
  100 credits once through its signed invoice event, taking available credits
  from zero to 100 with none reserved. Other October 5 jobs had consumed the
  earlier starter balance. Manual redelivery returned HTTP 200 with
  `reused: true` and no balance increase. The portal opened and showed the paid
  invoice. Renewal, recurring failure/recovery, cancellation, asynchronous
  packs and refund reconciliation remain open.
- **Isolated card-pack decline/recovery:** the $10/100-credit pack Checkout
  showed an insufficient-funds decline; a fresh app read remained at 100
  credits. Retrying the same Checkout successfully produced a signed
  `checkout.session.completed` event with `credit_pack_granted` and 100 credits.
  A fresh app read showed 200 credits and Builder. Manual pack-event redelivery
  returned HTTP 200 with `reused: true` and `action: succeeded`; a fresh Studio
  read still showed 200 credits and Builder. Actual asynchronous settlement
  remains unverified.
- **Refund observations:** signed same-mode snapshots persist immutably and
  explicitly require reconciliation. Memory/PostgreSQL tests passed and
  migration 006 deployed. This does not associate payments, issue refunds,
  change credits or prove an actual provider refund lifecycle.
- **Learning:** the existing sample job has an artifact-delivery observation;
  email validation and refund-observation boundaries are in the curriculum.
  The deployed learning endpoint returned 200 with the new
  `billing.database_mode_binding` and `files.bounded_storage_read_timeout`
  entries; its curriculum digest matched the local candidate. These records do
  not grant permissions or establish functional correctness.
- **Runtime health:** readiness reported healthy database and S3 access,
  configured Resend, seven migrations and none pending. The queried API error-log
  window since October 4 at 17:20 UTC returned no entries. This does not establish
  uninterrupted worker availability on free hosting or inbox delivery.

Details and file hashes are in the
[October 4 continuation](STAGING_CONTINUATION_2026-10-04.md). Historical Stripe
test results and remaining scenarios are in
[billing acceptance](BILLING_ACCEPTANCE.md).

## Next acceptance gates

| Area | Remaining work |
| --- | --- |
| Identity and private files | Reuse existing accounts/job to verify password recovery and second-account denial. Anonymous source access already returned 401. |
| Stripe identity/configuration | October 5 isolated dashboard setup and actual signed fulfillment supersede the earlier absent-key/empty-price gate. The restricted test key, four legacy prices, dedicated active test webhook and unique `iabt-isolated-staging-v1` marker are installed. Webhook API version is `2026-08-26.dahlia`. Keep this test configuration separate from production and preserve the historical endpoint/customer state. Current connector visibility is not established by dashboard acceptance. No real purchase or funding is needed. |
| Payment lifecycle | Initial isolated subscription payment, observed concurrent UI session reuse, cancellation/reopen, changed-plan conflict, same-invoice replay and card-pack decline/recovery/replay passed October 5. Still verify fulfillment without returning from Checkout, renewal, recurring decline/recovery, asynchronous packs, effective/immediate cancellation, provider expiry, later resubscription and interrupted/different-event fulfillment. Historical September payments/replays remain separate evidence. |
| Refunds/disputes | Extend the existing inbox with verified payment association, current provider state and operator review. Cash refunds and credit adjustments require explicit approval; no automatic clawback or access change. |
| Test/live state | Migration 007 and the database mode binding passed local verification/CI and are deployed on isolated staging at 286b99d. Exact owner/subscription provenance governs legacy inference; guards precede provider calls/receipt writes. Mode binding does not prove Stripe-account identity or replace a reviewed production data/credit migration. Drain older binaries before initializing another database. [Contract](BILLING_FULFILLMENT.md#database-billing-mode-binding) |
| Pricing | The versioned price-contract candidate passed local verification but is not yet published or deployed. The approved offer remains Meet Jericho first month $4.99/100 credits then Starter $12/100; Builder $29/300; Pro $59/650; top-up $10/100. Finish the catalog rollout, renewal disclosure and introductory eligibility while preserving existing purchases. October 5 hosted acceptance used the legacy $29/100-credit Builder contract and $10/100-credit pack. Approval of customer prices is not authorization for infrastructure/provider spending. |
| Recovery/migration | A synthetic local database restore passed. Verify hosted database and object-storage recovery and reconcile legacy data without changing protected production. |
| Product expansion | Customer connector workflows and isolated execution/testing of generated software remain incomplete. Existing maintenance cannot finish unrestricted software development or certify launch autonomously. |
| Public launch | Finish staging acceptance, workload costing, commercial/tax review and exact cutover/rollback preparation before domain changes, live billing or main merge. |

Use one exact source baseline and retain evidence with its environment, commit,
object IDs and hashes. Before implementing a fix, inspect the current branch and
these records for completed work. Advance the curriculum alongside future
implemented changes, while keeping local tests, CI, deployment and hosted
customer acceptance distinct.

The first local verification attempt rejected an older disposable database's
migration checksum after Windows line-ending conversion. The passing run used
a fresh disposable database; checksum validation was preserved. Render also
started a deployment after an environment update despite auto-deploy being off.
After future environment changes, inspect active/recent deployment IDs and
commits before manually triggering another deployment. Documentation-only
updates do not require redeploying the unchanged runtime.
