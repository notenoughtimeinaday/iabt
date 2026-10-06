# Current IABT release status — October 6, 2026

The standalone candidate has verified sample file delivery, a deployed refund
observation inbox, durable billing-mode protection and bounded storage reads.
An actual isolated test subscription payment, pending Checkout reuse and
same-event invoice replay also passed on October 5, followed by credit-pack
decline/recovery, a verified 100-credit pack grant and same-event pack replay.
The versioned price-contract implementation is now published and deployed to
the isolated API; the frontend remains on the unchanged 286b99d build.
A subsequent Studio source-review job used one test-purchased credit and
delivered three matching downloads and left **199 credits** at that checkpoint.
The October 6 database check below subsequently observed **198 credits**;
earlier 200-credit observations belong to the preceding payment tests.
**Full paid launch is not accepted.** Reuse the existing
candidate and isolated environment; do not restart completed upload, download,
email-validation or refund-observation implementation.

## October 6 connection and database reconciliation

Stripe connector authentication is working again, but its authorized test
account is the legacy Base44 setup. Complete read-only lists returned no prices,
customers or subscriptions, and its only webhook points to Base44. The existing
standalone account recorded in the private October 5 billing evidence is a
different account. The owner was given Stripe's account-access link to authorize
that existing account in test mode. Do not create replacement accounts or prices,
change staging credentials, or repeat successful payments to work around this
authorization boundary. No Stripe write or payment test was performed in this
reconciliation.

Direct read-only queries against the canonical isolated Neon database confirmed:

- Both original test accounts are email-verified: two users, two verified.
- Eight schema migrations are applied and the durable billing mode is `test`.
- Three persisted `legacy-v1` monthly price contracts exist: Builder 100,
  Pro 500 and Agency 2000 credits, registered October 6 at 02:12:36.172 UTC.
  This closes the previous direct-registry-enumeration evidence gap. It does not
  establish new-offer acceptance or a renewal credit grant.
- Account B retains Builder with 198 available and zero reserved test credits;
  account A has zero available and zero reserved credits. Earlier balances
  remain evidence for their individual scenarios.

Render's deployment records still show API d06894d and unchanged frontend
286b99d below. Repository head bd86e9f at the start of this check contained the
later documentation; no runtime deployment or repeated test suite was needed.
Password recovery, hosted request-based isolation and payment lifecycle gates
remain distinct from these database reads. Preserve the completed October 5
purchase, decline/recovery, replay and file-delivery evidence.

## Canonical candidate and environment

| Item | Verified identity |
| --- | --- |
| Repository | [notenoughtimeinaday/iabt](https://github.com/notenoughtimeinaday/iabt) |
| Branch / review | `jericho-autonomy-v1`, [draft PR 4](https://github.com/notenoughtimeinaday/iabt/pull/4) |
| API runtime candidate | `d06894d30200afcebbd6d15f0bc3f9fe05e1f12a` |
| Published tree | `752287f054d86a102d106e520c4a42973464fc5a` |
| CI | [Run 677 — passed](https://github.com/notenoughtimeinaday/iabt/actions/runs/37402441778) on that exact commit |
| Isolated frontend | [iabt-isolated-staging-web](https://iabt-isolated-staging-web.onrender.com/#/login) |
| Isolated API | [iabt-isolated-staging-api](https://iabt-isolated-staging-api.onrender.com) |
| API deployment | `dep-db25okss728c73b6pl7g` — same d06894d runtime, maintenance enabled; Live October 6, 2026 at 02:26:58 UTC |
| Frontend deployment | `dep-db18lmvr12us739rm4a0` — unchanged at `286b99da93ae7a0dda580d2d5d762824fa679b84` |
| Neon | Project `noisy-bread-33052649`, branch `br-mute-heart-b517gyel`, database `iabt_staging_isolated` |
| Schema | Eight applied migrations; none pending |

The isolated API is Live on d06894d; the frontend remains on 286b99d because
its code did not change. Later documentation-only commits record these results
and do not imply another runtime deployment. October 5 payment acceptance used
API 286b99d at `dep-db254s6k1f9s73953slg`. The October 4 API deployment
`dep-db18lm1mgk9c73d5c1pg` and previous 78d1c82 baseline remain historical
evidence in the dated continuation.

This is the current acceptance environment. The older
`iabt-api-insured-spending` / `iabt-staging-web` pair and its shared database are
historical test evidence. Do not deploy there or use its payment/account state
as a substitute for current isolated acceptance. The independent runtime remains
Render, Neon/private object storage, Resend and GitHub; Base44 is historical.
Keep the existing free hosting, main branch, public domain and production
configuration unchanged until release acceptance.

## Verified, with scope

- **Maintenance continuation:** the account had a durable enabled schedule but
  staging's server switch was disabled. `IABT_MAINTENANCE_ENABLED=true` was saved
  and the same d06894d runtime redeployed; the existing job worker was already
  enabled. Its first automatic pass ran 02:26:52–02:26:55 UTC, checked 11 jobs,
  ensured 11 outcome lessons, and required no plan repairs. The next check was
  scheduled for 02:41:55 UTC. No credits or external generation were used.
  Remote storage readback remains disabled: all 40 artifact findings explicitly
  report `remote_readback_disabled_unverified`, so the completed pass is marked
  `needs_attention`, not file-integrity success. Free hosting can still suspend.
  This maintenance does not modify source or complete launch work autonomously.
- **Earlier 286b99d baseline verification:** 352 server, 16 file/email, five
  frontend-isolation and eight readiness tests (**381 total, zero failed or
  skipped**), including 56 observed PostgreSQL checks; lint,
  type checking, Exchange/creation checks and production build passed. Exact
  published candidate CI and both isolated deployments passed separately.
- **Published d06894d verification:** 87 focused tests passed. After the final
  curriculum change, the complete `npm run verify` was repeated with the correct
  isolated API origin and exited zero: **393 tests, zero failed or skipped**,
  plus lint, type checking, Exchange/creation, frontend and production-build
  checks. An earlier build attempt had failed because `VITE_IABT_API_URL` was
  missing; both the corrected build rerun and this final complete run passed.
  Exact-commit CI run 677 passed and the API deployed separately. These results
  do not establish new-offer billing acceptance.
- **Post-deployment account continuity:** a fresh app reload against d06894d
  retained Builder, 200 available credits, zero reserved credits and the same
  customer/subscription association. Readiness reported eight migrations and
  none pending.
- **Test-purchased-credit delivery on d06894d:** Studio accepted the 4,892-byte
  TreeBay benchmark source and automatically completed one source-review job
  with zero external provider cost. Three stored artifacts were delivered and
  one IABT credit captured, taking available credits from 200 to **199**. Native
  browser MD/PDF/DOCX downloads matched all persisted sizes and SHA-256 hashes.
  Four PDF pages were visually inspected and legible without overlap; literal
  monospace wrapping was awkward. Markdown preserved every nonempty source line
  and DOCX ZIP/XML validation passed; new DOCX visual review is pending. A fresh
  hosted learning response recorded the account-scoped `verified_delivery`
  observation, three matching hashes and one attempt, with
  `functional_correctness: not_established`. The report
  inventories/preserves input and extracts candidates by line; it does not
  establish semantic TreeBay diagnosis, a complete checklist, repair/build
  execution or store submission. [Exact evidence](BILLING_ACCEPTANCE.md#paid-credit-source-delivery-on-d06894d)
- **Fresh subscription contract lookup on d06894d:** the Stripe test portal
  scheduled period-end cancellation, then restored renewal of the same legacy
  Builder subscription. Both new events returned HTTP 200, `reused: false`,
  `subscription_entitlement_updated` and zero granted credits. Fresh app states
  attached the `legacy-v1` Builder contract for 100 monthly credits, retained
  active Builder and 200 available/zero reserved credits, and correctly set
  then cleared the cancellation schedule. The canonical period-end projection
  was correct despite the provider's period-end boolean being false. This
  establishes fresh subscription contract lookup, not renewal-credit granting
  or effective cancellation. Direct hosted registry enumeration subsequently
  passed in the October 6 read-only check above. Earlier payment/replay evidence
  stays scoped to 286b99d.
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
  invoice. Renewal, recurring failure/recovery, effective/immediate
  cancellation, asynchronous packs and refund reconciliation remain open.
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
  On 286b99d, the deployed learning endpoint returned 200 with the new
  `billing.database_mode_binding` and `files.bounded_storage_read_timeout`
  entries; its curriculum digest matched that candidate. A fresh d06894d hosted
  learning response returned HTTP 200 with `billing.versioned_price_allowances`
  and the TreeBay `software-release-benchmark` rule. Its digest was
  `a1c9aaf636759629cb47e7aab27feb94752918ee8f6af746f8614a911ffd68ff`.
  The complete suite was repeated after the final rule change. Serving the
  benchmark does not mean Jericho can already repair and submit TreeBay.
  Learning records do not grant permissions or establish functional correctness.
- **Runtime health:** after the d06894d API deployment, readiness reported eight
  migrations and none pending. The earlier 286b99d check reported healthy
  database/S3 access and configured Resend; the queried API error-log window
  since October 4 at 17:20 UTC then returned no entries. Those dated checks do
  not establish uninterrupted worker availability on free hosting or inbox
  delivery.

Earlier file hashes are in the
[October 4 continuation](STAGING_CONTINUATION_2026-10-04.md). Current purchased-
credit delivery hashes, Stripe test results and remaining scenarios are in
[billing acceptance](BILLING_ACCEPTANCE.md).

## Next acceptance gates

| Area | Remaining work |
| --- | --- |
| Identity and private files | Reuse existing accounts/jobs to verify password recovery and second-account denial, and visually review the new TreeBay-source DOCX. Native MD/PDF/DOCX delivery and four-page PDF visual review passed for that new report. Anonymous source access already returned 401. |
| Stripe identity/configuration | October 5 isolated dashboard setup and actual signed fulfillment supersede the earlier absent-key/empty-price gate. The restricted test key, four legacy prices, dedicated active test webhook and unique `iabt-isolated-staging-v1` marker are installed. Webhook API version is `2026-08-26.dahlia`. October 6 connector authentication works but authorizes only the legacy Base44 account; add the existing standalone account before further connector payment tests. Preserve the working staging configuration and historical endpoint/customer state. No real purchase or funding is needed. |
| Payment lifecycle | Initial isolated subscription payment, observed concurrent UI session reuse, cancellation/reopen, changed-plan conflict, same-invoice replay and card-pack decline/recovery/replay passed on 286b99d. Fresh period-end cancellation scheduling and restoration of renewal passed on d06894d with no credit change. Still verify fulfillment without returning from Checkout, renewal-credit granting, recurring decline/recovery, asynchronous packs, effective/immediate cancellation, provider expiry, later resubscription and interrupted/different-event fulfillment. Historical September payments/replays remain separate evidence. |
| Refunds/disputes | Extend the existing inbox with verified payment association, current provider state and operator review. Cash refunds and credit adjustments require explicit approval; no automatic clawback or access change. |
| Test/live state | Migration 007 and the database mode binding first deployed at 286b99d and remain included in d06894d. Exact owner/subscription provenance governs legacy inference; guards precede provider calls/receipt writes. Mode binding does not prove Stripe-account identity or replace a reviewed production data/credit migration. Drain older binaries before initializing another database. [Contract](BILLING_FULFILLMENT.md#database-billing-mode-binding) |
| Pricing | Versioned price contracts are published, CI-verified and deployed to the API at d06894d with migration 008. Fresh hosted subscription events resolved the legacy Builder contract correctly; October 6 direct SQL enumeration confirmed all three legacy monthly contracts. Renewal-credit granting and new-offer acceptance remain open. The approved offer remains Meet Jericho first month $4.99/100 credits then Starter $12/100; Builder $29/300; Pro $59/650; top-up $10/100. Finish the offer rollout, renewal disclosure and introductory eligibility while preserving existing purchases. October 5 payment acceptance used 286b99d's legacy $29/100-credit Builder contract and $10/100-credit pack. Approval of customer prices is not authorization for infrastructure/provider spending. |
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
