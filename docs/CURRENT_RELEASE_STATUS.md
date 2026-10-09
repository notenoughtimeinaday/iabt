# Current IABT release status — October 9, 2026

## October 9 Studio usability and image-to-video repair

The owner reported scrolling failures and no visible result from Create outcome.
Hosted inspection reproduced generic non-task replies to “clear up the image”
and “animate the attached image”; a conventional video request with an image
failed at the attachment gate with only temporary UI feedback. The live
capability response also reported image and video providers unconfigured.

The candidate repairs the overlapping composer, persistent submission feedback,
capability-map parsing and media setup disclosure. A new owner-checked image
route prepares a paid Luma quote from one JPEG/PNG, binds source hash and video
settings, and revalidates bytes before an inline first-keyframe submission.
Missing provider setup stops before a job or credit reservation. Photo cleanup
remains unsupported and now explains that limitation directly. Both changes
are taught in the versioned Jericho curriculum.

The first source-bound revision passed the complete suite again and was
published as a9c1b829b039e329ef30cb402d27fd39449f18b7 with identical tree
57aad957b5a997a0ecd259533727fd83250a0b2e; CI run 689 passed. A predeployment
supplier-pricing review then found the old linear duration estimate understated
10-second Luma clips. The follow-up uses a shared 1x/3x estimator, rejects
underfunded stale approvals before submission, and preserves polling of already
paid generations. Its final verification and staging evidence are pending.

Initial complete local verification passed **453 tests, zero failed/skipped**,
including 71 observed PostgreSQL checks, plus lint, type checking, Exchange and
creation checks, frontend isolation and the production build. That run covered
a changing working copy; final source binding and deployment evidence must be
recorded separately. Local browser tests reached the submit/error controls on
a 390×844 viewport and the paid image-video quote through the actual Studio
components. The local video transport is simulated and its placeholder MP4 is
not a playable generated video. It establishes workflow wiring only.

**No real image-to-video render is accepted.** Luma configuration, approved
supplier spending and a successful real output remain required. No provider
charge, production cutover or paid hosting upgrade is authorized by these tests.
Use the isolated staging services below for the UI deployment and acceptance.

## October 9 checkout diagnosis and continuation

The October 7 [release report](https://drive.google.com/file/d/1wphiGWaq7Z67vtLtfZkva8wDFFsNLEul/view)
supersedes the historical October 6 predeployment notes below: c43a5a7 was
deployed to both isolated services on October 6, new test offers were enabled,
and migration 009 was completed. The new Builder Checkout then returned 503
`billing_offer_verification_failed` before submitting a Checkout session.

An October 9 read-only probe on the canonical isolated API confirmed that the
first verification request, `GET /v1/account`, receives Stripe HTTP 403
`invalid_request_error`. A second deployed probe classified Stripe's exact
required-permissions explanation as `insufficient_permissions`. Account access
is the confirmed blocker; price and coupon access have not yet been reached.
Raw provider messages, credentials and account diagnostics are not stored here.
Do not replace this result with the earlier pricing rollout audit.

Runtime `95d2646f9aa90c4ada4470d4448afb0a05b97dbc` adds bounded operator-only
diagnostics and a default-off, test-only, read-only startup probe. It preserves
the generic customer 503 and all account/price checks. The isolated API was
updated; the frontend remains c43a5a7. The probe was disabled after evidence
collection. No Checkout, payment, subscription/price change, credential rotation,
permission expansion, production update or paid infrastructure was performed.
PR #4 remains draft and unmerged.

[CI run 687](https://github.com/notenoughtimeinaday/iabt/actions/runs/37890682563)
passed for branch candidate 95d2646, using PR test-merge
`e726ce4b9c5e6808ba92cb98ee3777d220de7f18`, including disposable PostgreSQL.
The preceding diagnostic candidate passed CI run 686 and local `npm run verify`;
local database tests were skipped, not counted as hosted or database acceptance.
Regression tests exercise account/price/coupon failures, timeouts, malformed
responses, secret redaction, HTTP correlation, no Checkout writes and test-only
probe activation. CI does not merge or deploy the PR.

**Remaining correction:** inspect the existing restricted staging test key in
the correct standalone Stripe Dashboard, grant only the read permission required
by the account endpoint if authorized, then re-run the read-only Builder check.
Do not broaden to an unrestricted key or disable account verification. The
current connector exposes no request-log/key-permission operation and the cloud
Stripe Dashboard requires sign-in. The provider's exact permission identifier
was not captured; inspect its request log rather than guessing its UI label.
Then validate selected price access and actual test Checkout separately. A
passing account read alone will not establish new-offer purchase acceptance.
See [the diagnostic procedure](PRICING_OFFER_ROLLOUT.md#read-only-verification-diagnosis-october-9).

## Historical October 6 predeployment pricing checkpoint

The draft branch now contains a test-only implementation of the approved future
price/credit offer, including Starter schema support, versioned offer IDs,
renewal-disclosure acceptance and durable introductory eligibility. New offers
default off and this candidate cannot activate them in live mode. Existing
legacy contracts, balances and tier capabilities remain unchanged. The staging
policy now gives every new paid offer commercial-use rights, subject to supplier
terms and law, through the verified versioned purchase contract. Legacy rights
remain unchanged. Introductory eligibility and disclosure are implemented;
actual hosted customer acceptance remains open.
See [the configuration, policy, tests and rollback map](PRICING_OFFER_ROLLOUT.md).
The three new test products/prices and the once-only, Starter-restricted discount
have now been provisioned in the correct existing standalone test account.
They are not activated in the isolated app. This source change alone does not
update environments or establish hosted offer acceptance. The deployed runtime
evidence below remains separate; no new deployment is implied.

Pricing repository verification passed in
[CI run 682](https://github.com/notenoughtimeinaday/iabt/actions/runs/37483576318):
**418 tests, zero failures/skips**, plus lint, type checking, Exchange/creation
checks and the production build. This includes disposable PostgreSQL integration.
The run targets branch head `07c7c239b37fa1c3a1fa4f146e73dff44ee9bbd2` and
checks out GitHub's PR test-merge revision
`e68939a1eb07e0464f4dc206a185a5fe3d356c1c`; it does not merge the PR or deploy.
Its structured readiness artifact records a clean, stable tested snapshot.
Runtime/test source matches the branch candidate. The test-merge additionally
includes the base branch's Base44 package-version updates in `package.json` and
`package-lock.json`; those two manifests are the only tree differences.

The first CI attempt (run 681) exposed two PostgreSQL retry failures. Fix
`aff4b88` canonicalizes only new-offer request fingerprints so JSONB key ordering
cannot change accepted terms; legacy fingerprints stay unchanged. A regression
reproduces the prior failure and now passes. Local database skips are superseded
by run 682's database evidence, not by inference from memory tests. Subsequent
commercial-rights, presentation and operator refund-review changes passed the
complete local verification: **427 tests, zero failures/skips**, including 70
PostgreSQL checks, plus lint, type checking and production build. Their published
commit and CI remain to be recorded separately. Local desktop/mobile inspection at 1280 by 720 and
390 by 844 passed for readable pricing, no horizontal overflow and per-offer
renewal-consent controls using an in-memory fixture with mocked payment
readiness. No payment was submitted from that fixture. Actual new-offer Stripe
checkout, introductory renewal and hosted disclosure acceptance remain unaccepted.

The smallest implementation changes are grouped as follows:

| Path | Purpose / preservation boundary |
| --- | --- |
| `src/lib/pricing.js`, `src/components/BillingDialog.jsx`, `src/index.css` | Server-supplied offer cards, explicit renewal consent and pending-purchase resume; legacy purchased allowances remain distinct. |
| `server/src/billing/plans.js`, `offers.js` | Add versioned commercial-use rights for new paid offers; retain all legacy defaults and require exact test-account/price/coupon terms. |
| `server/src/billing/price-catalog.js`, `server/migrations/009_starter_price_contracts.sql` | Add Starter to the registry without rewriting old price IDs, hashes, allowances or migration 008. |
| `server/src/billing/stripe-checkout.js`, `checkout-attempt.js`, `intro-eligibility.js` | Persist accepted terms and introductory claims with existing transaction/lease admission; preserve frozen retries and require provider-confirmed release. |
| `server/src/billing/stripe-webhook.js`, `server/src/app.js` | Consume introduction once on signed paid fulfillment and expose an owner-scoped offer/disclosure view; reuse normal invoice credit grants. |
| `server/src/config.js`, `standalone.env.example` | Add disabled switches and empty configuration placeholders; no service environment changes. |
| `server/test/billing-offers.test.js`, `billing-view.test.js`, `price-catalog.test.js` | Cover eligibility, disclosure, concurrency/restart, JSONB retries, failure/replay, additive contracts and legacy display/capacity. |
| `docs/PRICING_OFFER_ROLLOUT.md`, `docs/BILLING_FULFILLMENT.md`, `server/src/learning/curriculum.js` | Record staging policy, exact configuration, remaining acceptance and rollback with fulfillment preserved. |

The same undeployed candidate also adds a host-only refund review workflow.
It verifies current Stripe state, the original payment and persisted customer,
fulfillment and ledger grant before binding an explicit operator decision to
immutable evidence. The selected `retain_existing_credits_v1` policy changes no
credits, access or cash, including after partial refunds. This is not unused-
credit accounting or a cash-refund implementation. Its implementation details
are in [operator refund reconciliation](REFUND_OPERATOR_RECONCILIATION.md);
actual provider refund acceptance remains open.

## Previously deployed acceptance baseline

The standalone candidate has verified sample file delivery, a deployed refund
observation inbox, durable billing-mode protection and bounded storage reads.
An actual isolated test subscription payment, pending Checkout reuse and
same-event invoice replay also passed on October 5, followed by credit-pack
decline/recovery, a verified 100-credit pack grant and same-event pack replay.
The versioned price-contract implementation is now published and deployed to
the isolated API; the frontend remains on the unchanged 286b99d build.
A subsequent Studio source-review job used one test-purchased credit and
delivered three matching downloads and left **199 credits** at that checkpoint.
The early October 6 database check below subsequently observed **198 credits**.
The later immediate-cancellation and resubscription check retained those credits
through cancellation and added one legacy allowance, ending at **298 credits**.
Subsequent real Stripe Billing simulations renewed that subscription, recovered
a declined recurring invoice, and reached its scheduled cancellation boundary.
The final verified database state is **Free/canceled, 498 available credits and
zero reserved credits**. These are test credits, not live revenue.
Earlier 200-credit observations belong to the preceding payment tests.
**Full paid launch is not accepted.** Reuse the existing
candidate and isolated environment; do not restart completed upload, download,
email-validation or refund-observation implementation.

## October 6 immediate cancellation and resubscription

At 15:38–15:42 UTC, the connector exposed the correct existing standalone Stripe
account in test mode, resolving the earlier account-access gate. The isolated
API remained on d06894d and the frontend on 286b99d. Repository source was
d3a8f71; its disabled future-pricing candidate was not deployed or activated.

The existing legacy Builder test subscription was canceled immediately with
`invoice_now=false` and `prorate=false`. Its signed
`customer.subscription.deleted` event processed as
`subscription_entitlement_updated` with zero credits granted. The database
showed Free/canceled with **198 available and zero reserved credits**, and a
fresh Studio browser view showed Free and 198 credits.

The same account then used **Plans & billing → Test Builder** to complete a
legacy $29/100-credit Stripe sandbox Checkout. The replacement subscription was
active under the same customer while the old subscription remained canceled.
The signed `invoice.paid` event granted **100 credits once**; the subscription
creation event granted zero. Database state was Builder/active with **298
available and zero reserved credits**, and a fresh browser billing dialog
showed Builder as the current plan and 298 credits.

This closes effective immediate cancellation with credit retention and later
resubscription for this isolated runtime. It is a distinct lifecycle scenario;
the October 5 initial-purchase baseline remains separate. That scenario alone
did not establish a later independent sign-in, project access after downgrade,
natural period-end cancellation, monthly renewal or recurring decline/recovery.
The subsequent simulation below establishes the latter three separately.
No refunds, new prices, live/production changes or runtime deployment occurred
during the immediate-cancellation/resubscription check. Exact
provider and user identities belong in the private acceptance evidence.
See [billing acceptance](BILLING_ACCEPTANCE.md#october-6-immediate-cancellation-and-resubscription).

## October 6 monthly renewal, recurring recovery and period-end cancellation

The current Stripe test API successfully attached a Billing test clock to the
same existing customer and legacy Builder subscription. This used actual
provider simulation and signed webhooks on API d06894d / frontend 286b99d;
there was no synthetic webhook injection or manual credit adjustment.

- Advancing to simulated November 7 produced a paid USD 29 monthly renewal
  invoice for the November 6–December 6 period. Its signed `invoice.paid`
  delivery granted one legacy 100-credit allowance: **298 to 398 available,
  zero reserved**, Builder/active. A fresh hosted browser also showed 398.
- A declining public Stripe test method made the next monthly invoice fail on
  its first collection attempt. Stripe showed the same invoice open, zero paid,
  and the subscription `past_due`; the database retained **398 credits**.
  Restoring the original successful test method and advancing through the
  configured retry produced payment on attempt two of that same USD 29 invoice.
  Its signed paid event granted **100 once**, producing Builder/active with
  **498 available and zero reserved credits**.
- Scheduling cancellation at the recovered period's end and advancing beyond
  January 6, 2027 produced Stripe `canceled` with `ended_at` equal to the
  scheduled boundary. The signed deletion event granted zero credits; the
  database became **Free/canceled with 498 available and zero reserved**.
  A fresh hosted Studio independently showed Free/498, 12 saved conversations
  and the selected completed TreeBay report's three deliverables intact.

These checks establish actual legacy renewal, recurring decline/recovery and
natural period-end cancellation without changing the purchased allowance.
The ledger independently confirmed exactly one 100-credit grant for each of
the two new monthly periods.
Replay of these new cycle events, a later independent sign-in and project access
after downgrade remain separate acceptance steps. The earlier replay results
are preserved, not reused as evidence for an unperformed new-cycle replay.
Exact invoice, event, customer and ledger identities and the renewal screenshot
are retained in private evidence.

The clock's real-time automatic deletion is **November 5, 2026 at 15:51:50 UTC**,
independent of its simulated January date. Finishing or deleting the simulation
deletes its associated customer. Do not finish/delete it as routine cleanup;
preserve evidence and plan staging customer continuity before that expiry. No
live payments, production cutover or runtime deployment occurred in this test.
See [billing acceptance](BILLING_ACCEPTANCE.md#october-6-monthly-renewal-recurring-recovery-and-period-end-cancellation).

## October 6 connection and database reconciliation

During the earlier October 6 check, Stripe connector authentication worked, but
its authorized test account was the legacy Base44 setup. Complete read-only
lists returned no prices, customers or subscriptions, and its only webhook
pointed to Base44. The existing standalone account recorded in the private
October 5 billing evidence was a
different account. The owner was given Stripe's account-access link to authorize
that existing account in test mode. Do not create replacement accounts or prices,
change staging credentials, or repeat successful payments to work around this
authorization boundary. No Stripe write or payment test was performed in this
earlier reconciliation. The later account connection and lifecycle acceptance
above supersede this access gate.

Direct read-only queries against the canonical isolated Neon database confirmed:

- Both original test accounts are email-verified: two users, two verified.
- Eight schema migrations are applied and the durable billing mode is `test`.
- Three persisted `legacy-v1` monthly price contracts exist: Builder 100,
  Pro 500 and Agency 2000 credits, registered October 6 at 02:12:36.172 UTC.
  This closes the previous direct-registry-enumeration evidence gap. It does not
  establish new-offer acceptance or a renewal credit grant.
- Account B then retained Builder with 198 available and zero reserved test
  credits; account A had zero available and zero reserved credits. Earlier balances
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
| Source at October 6 lifecycle check | `d3a8f71fc65709c800d202fc81aa200bf8f2e213` — includes the disabled pricing candidate; distinct from deployed runtime |
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
  invoice. Asynchronous packs and actual refund reconciliation remain open.
  The separate October 6 checks above establish effective immediate cancellation,
  resubscription, monthly renewal, recurring decline/recovery and natural
  period-end cancellation on d06894d.
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
| Stripe identity/configuration | The existing standalone test account connection was verified before the October 6 15:38–15:42 UTC lifecycle check, resolving the earlier legacy-only connector gate. The restricted test key, four legacy prices, dedicated active test webhook and unique `iabt-isolated-staging-v1` marker remain installed; webhook API version is `2026-08-26.dahlia`. Preserve the working isolated configuration and historical endpoint/customer state. No real purchase or funding is needed. |
| Payment lifecycle | Initial isolated subscription payment, observed concurrent UI session reuse, cancellation/reopen, changed-plan conflict, same-invoice replay and card-pack decline/recovery/replay passed on 286b99d. Scheduling/restoration, immediate cancellation/resubscription, true monthly renewal, recurring decline/recovery and natural period-end cancellation passed on d06894d. Still verify replay of the new cycle events, fulfillment without returning from Checkout, asynchronous packs, later independent sign-in and project access after downgrade, provider expiry and interrupted/different-event fulfillment. Preserve the clocked customer's evidence and plan continuity before real-time automatic deletion on November 5 at 15:51:50 UTC. Historical September payments/replays remain separate evidence. |
| Refunds/disputes | The undeployed candidate adds current provider/payment association and immutable operator review with explicit retain-existing-credits approval. Complete its exact-candidate verification and actual sandbox refund/reconciliation acceptance. Cash refunds remain separate authorized provider operations; no automatic clawback or access change. Dispute reconciliation remains absent. |
| Test/live state | Migration 007 and the database mode binding first deployed at 286b99d and remain included in d06894d. Exact owner/subscription provenance governs legacy inference; guards precede provider calls/receipt writes. Mode binding does not prove Stripe-account identity or replace a reviewed production data/credit migration. Drain older binaries before initializing another database. [Contract](BILLING_FULFILLMENT.md#database-billing-mode-binding) |
| Pricing | Versioned price contracts are deployed to the API at d06894d with migration 008; actual legacy renewals now granted the retained 100-credit allowance. The hosted registry still contains only the three legacy monthly contracts. Approved new test products/prices and the restricted introductory coupon are provisioned but not enabled. Finish exact-candidate verification, migration 009, test-only configuration and hosted new-offer acceptance: Meet Jericho first month $4.99/100 then Starter $12/100; Builder $29/300; Pro $59/650; top-up $10/100. All new paid offers include versioned commercial-use rights; legacy purchased terms remain unchanged. Local responsive disclosure controls passed, but no new-offer hosted purchase is implied. Approval of customer prices is not authorization for infrastructure/provider spending. |
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
