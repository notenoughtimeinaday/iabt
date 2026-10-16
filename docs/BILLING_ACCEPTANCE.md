# Billing acceptance and remaining requirements

Baseline code audited at `ee4d8d34539d60d7d5980aad9bb9d4e3740150c1` on 2026-09-20;
the pending Checkout guard below was added during the follow-up audit.
The added [local acceptance-contract tests](../server/test/billing-acceptance.test.js)
use synthetic signed events, mocked Stripe responses and private local files.
They do not establish a completed hosted Checkout, actual decline, recurring
collection, portal cancellation, refund or staging delivery. Historical September
20–23 browser, Stripe and Neon results are recorded separately in the
[dated staging payment and delivery report](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md).
The [October 4 continuation](STAGING_CONTINUATION_2026-10-04.md) adds actual
isolated-staging file delivery and exact-candidate verification. Use
[CURRENT_RELEASE_STATUS.md](CURRENT_RELEASE_STATUS.md) for the canonical
candidate and isolated environment. Earlier payment results belong to the older
Insured Spending test integration; they do not establish billing acceptance for
the current isolated environment or another Stripe account. The October 5
isolated results below now establish an initial subscription purchase,
same-invoice replay, and a declined then successfully retried credit-pack
purchase on runtime 286b99d; they do not close the full lifecycle.
API candidate d06894d is now published and deployed with versioned price
contracts. Fresh hosted cancellation-scheduling and renewal-restoration events
verified its subscription contract lookup. That evidence is separate from the
earlier 286b99d payment and replay tests.
On October 6 at 15:38–15:42 UTC, the correctly connected standalone test account
also passed effective immediate cancellation with credit retention and
same-customer resubscription on d06894d, ending at 298 available and zero
reserved credits. Subsequent actual Stripe Billing simulation on that same
subscription passed a monthly renewal, recurring decline/recovery, and natural
period-end cancellation, ending Free/canceled with 498 available and zero
reserved credits. These do not establish the disabled future-pricing candidate's
hosted acceptance.

| Scenario | Existing local evidence | Remaining sandbox acceptance | Status |
| --- | --- | --- | --- |
| Hosted subscription Checkout | Server derives tier, price, owner metadata and redirects. A subscription label grants no credits by itself. | Verify fulfillment when the customer never visits the success page; keep renewal and cancellation acceptance separate. | **October 5 isolated payment passed on 286b99d:** a legacy Builder $29 test payment produced one signed-invoice allowance, available credits 0 to 100 and reserved credits zero. The customer portal opened and showed the paid invoice. [Current evidence](#october-5-isolated-hosted-acceptance) September 20 results remain historical. |
| Hosted credit-pack Checkout | Server captures pack quantity; paid session identity grants once; unpaid completion waits for delayed success. | Exercise an enabled asynchronous method through pending then successful or failed settlement. No credits may appear while payment is unpaid or failed. | **October 5 isolated card decline, recovery and same-event replay passed on 286b99d:** a $10/100-credit pack was declined for insufficient funds, with a fresh app read still showing 100 credits. Successful retry of the same Checkout produced a signed `checkout.session.completed` grant of 100; the fresh app showed 200 credits and Builder. Manual redelivery returned HTTP 200 with `reused: true` and `action: succeeded`; a fresh Studio read still showed 200 credits and Builder. Asynchronous settlement remains unverified. [Current evidence](#october-5-isolated-hosted-acceptance) September 22 results remain historical. |
| Signed delivery, replay and interrupted fulfillment | Memory and PostgreSQL tests cover signatures, same/different event IDs, concurrent instances, crash windows and restart. | Verify hosted different-event/same-payment delivery and an interrupted fulfillment in an isolated environment, with no duplicate grant. | **October 5 isolated signed delivery and same-event replay passed for invoice and pack:** the initial invoice granted 100 once and its redelivery left the balance at 100. The later pack granted 100 once and its redelivery left the balance at 200. Both replays returned HTTP 200 with `reused: true`. Hosted interruption and other-event cases remain open. [Current evidence](#october-5-isolated-hosted-acceptance) Earlier invoice/pack replays remain [historical evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-hosted-credit-pack-and-replay). |
| Purchased credit to private artifact | The local contract combines purchase fulfillment, automatic document creation, worker byte verification, credit capture and file readback. | Visually review the new DOCX, and verify hosted second-account denial, terminal failure release and actual storage recovery. Reuse the completed source-review jobs for file checks. | **Test-purchased-credit delivery passed on d06894d:** a real Studio attachment request automatically completed one source-review job, captured one credit (200 to 199), and delivered MD/PDF/DOCX through native browser downloads matching stored byte counts/hashes. Four PDF pages were legible with no overlap; new DOCX visual review remains pending. The report inventories/preserves literal input and extracts candidates by line; it is not semantic TreeBay diagnosis or a complete release checklist. [Current evidence](#paid-credit-source-delivery-on-d06894d) Earlier starter-credit and September purchased-credit journeys remain separate history. |
| Monthly renewal | Synthetic monthly invoices grant once per subscription period and preserve earlier credits. | Replay the newly observed cycle event and confirm no additional grant. Keep legacy renewal evidence separate from introductory/new-offer renewal acceptance. | **October 6 actual Stripe Billing simulation passed on d06894d:** the existing legacy Builder subscription's USD 29 monthly invoice paid; its signed `invoice.paid` granted one 100-credit allowance, changing available credits 298 to 398 with zero reserved. Database and fresh hosted Studio agreed. The new cycle event has not yet been replayed. [Current evidence](#october-6-monthly-renewal-recurring-recovery-and-period-end-cancellation) |
| Decline and recovery | Synthetic `invoice.payment_failed` is ignored and cannot fund credits. Verified subscription states determine grace: `past_due` retains the tier, `unpaid` becomes Free. Recovery plus a paid invoice funds once. | Replay the recovered cycle event and verify no additional grant. Exhausted-dunning/unpaid downgrade remains distinct from the observed successful retry. | **October 6 actual recurring decline/recovery passed on d06894d:** the next USD 29 invoice failed on attempt one, stayed open with zero paid and `past_due`, and credits remained 398. After restoring the original successful test method and advancing through the configured retry, that same invoice paid on attempt two; its signed event granted 100 credits, yielding Builder/active and 498 available/zero reserved. [Current evidence](#october-6-monthly-renewal-recurring-recovery-and-period-end-cancellation) October 5 pack decline/retry and September initial-subscription decline remain separate evidence. |
| Period-end and immediate cancellation | Local checks retain paid access while cancellation is scheduled, downgrade on verified canceled state, and retain credits. Projection tests cover provider `cancel_at` at the item period boundary while its period-end boolean is false; the repair is included in the current isolated candidate. | Verify a later independent sign-in and project access/admission after downgrade. The fresh Studio retained saved conversations and a selected completed report, but that does not establish every project path. Cancellation is not a cash refund. | **October 6 immediate cancellation and natural period-end cancellation passed on d06894d:** the earlier immediate deletion retained 198 credits. Later the clock reached the scheduled boundary, Stripe ended the subscription there, and its signed deletion event granted zero; database and fresh Studio showed Free/canceled with 498 available and zero reserved. [Current simulation evidence](#october-6-monthly-renewal-recurring-recovery-and-period-end-cancellation) [Earlier immediate-cancellation evidence](#october-6-immediate-cancellation-and-resubscription) Scheduling/restoration and September results remain distinct dated evidence. |
| Cash refund lifecycle | Immutable signed observations are deployed with migration 006. The later undeployed candidate adds current Stripe/payment association, original fulfillment/ledger verification and an immutable operator review using `retain_existing_credits_v1`. This policy retains credits and access; it does not infer unused credits from a payment. | Complete exact-candidate verification and exercise actual sandbox refunds, signed observation, reviewed original-payment association and explicit policy approval. Cash refund execution remains a separate authorized Stripe operation. | **Observation ingestion implemented, tested and deployed; bounded operator reconciliation implemented in the candidate, but actual hosted refund lifecycle remains unverified.** No cash refund or credit adjustment is implied. [Implementation](REFUND_OPERATOR_RECONCILIATION.md) |
| Subscription admission and later resubscription | A private pending-session record now reuses one session across concurrent instances and restart, retains exact retry parameters, and requires verified expiry before replacement. Completed-unreconciled sessions and changed terms fail closed. Existing subscribers use the portal. | Verify interrupted/retried creation and actual provider expiry. The observed concurrent UI requests do not establish multiple-server or restart acceptance. | **October 5 isolated UI checks passed:** two concurrent Builder clicks returned the same Checkout session; cancellation/reopen reused it; selecting Pro while it remained pending returned HTTP 409 `stripe_checkout_terms_conflict`. [Earlier evidence](#october-5-isolated-hosted-acceptance) **October 6 same-customer resubscription passed on d06894d:** after effective cancellation, app-generated legacy Builder Checkout produced a new active subscription, one 100-credit invoice grant and Builder/298 available/zero reserved in database and fresh billing UI. [Lifecycle evidence](#october-6-immediate-cancellation-and-resubscription) |

## October 6 immediate cancellation and resubscription

At 15:38–15:42 UTC, the connector's correct existing standalone Stripe test
account was verified and used for the existing isolated subscription. This
resolved the earlier legacy-only connector authorization gate. The tested API
remained d06894d and frontend 286b99d. Source head was d3a8f71, which includes
the disabled future-pricing implementation; that candidate was not deployed
or activated for this check.

The existing legacy Builder subscription was immediately canceled with
`invoice_now=false` and `prorate=false`. Its signed
`customer.subscription.deleted` event processed as
`subscription_entitlement_updated` with `credits_granted: 0`. The persisted
entitlement became Free/canceled while the ledger retained **198 available and
zero reserved credits**. A fresh Studio browser view independently showed
Free and 198 credits.

The same app account then selected **Plans & billing → Test Builder** and
completed the app-generated $29 legacy Builder Checkout using a public Stripe
sandbox test card. Stripe recorded a new active subscription under the same
customer, with the prior subscription still canceled. The signed `invoice.paid`
event granted **100 credits once**; `customer.subscription.created` updated
the entitlement and granted zero. The persisted account showed Builder/active
with **298 available and zero reserved credits**. A fresh actual billing dialog
showed Builder as the current plan and 298 credits.

The paid USD 29 invoice used `billing_reason: subscription_create` and the
same legacy monthly price. Its one 100-credit ledger grant retained the
`legacy-v1` price contract and original contract hash. The existing customer
had no test clock at this checkpoint; this scenario must not be labeled a monthly
renewal. A clock was attached later for the distinct simulation below.

This establishes effective immediate cancellation with credit retention and a
later same-customer purchase through the application. It is a distinct
resubscription scenario, not a repetition or reinterpretation of the October 5
initial-purchase baseline. It does not establish a natural period-end downgrade,
a later independent sign-in, project access after downgrade, renewal-credit
granting, recurring decline/recovery, fulfillment without returning from
Checkout, or new-offer acceptance. No refunds, new prices, live/production
changes or runtime deployment occurred. Exact provider, user, event and
fulfillment identities remain in private acceptance evidence.

## October 6 monthly renewal, recurring recovery and period-end cancellation

The current Stripe test API accepted attaching a Billing test clock directly to
the same existing customer and replacement legacy Builder subscription. This
continues the existing purchased contract without a replacement customer,
synthetic webhook injection or a manual credit/entitlement edit. All scenarios
ran against isolated API `d06894d30200afcebbd6d15f0bc3f9fe05e1f12a` and frontend
`286b99da93ae7a0dda580d2d5d762824fa679b84`; the newer pricing, commercial-rights
and operator refund-review candidate was not deployed.

Advancing the provider simulation to November 7 produced the actual USD 29
monthly invoice for **November 6, 2026 at 15:41:17 UTC through December 6 at
15:41:17 UTC**. Stripe reported paid. The signed `invoice.paid` event granted
the legacy **100-credit** allowance, preserving the original 100-credit contract
rather than applying the new 300-credit offer. Available credits moved **298 to
398**, with **zero reserved**, and the entitlement remained Builder/active.
A fresh hosted Studio browser independently showed 398 credits; its screenshot
is retained in private evidence.

The next recurring collection used a public Stripe test method that declines
charges. The December 6 invoice's first attempt failed: it remained open with
zero amount paid, and the subscription became `past_due`. The database retained
**398 available credits**, proving that the unsuccessful collection did not
fund a monthly allowance. The original successful test method was restored.
The configured retry was scheduled for **December 8 at 12:15:48 UTC**; advancing
to December 9 allowed Stripe to collect **the same USD 29 invoice on attempt
two**. Its signed paid event granted 100 credits, producing Builder/active with
**498 available and zero reserved credits**. This is recurring invoice recovery,
separate from the October 5 credit-pack retry. It does not establish exhausted
dunning or the `unpaid` downgrade path.
The ledger independently confirmed one 100-credit grant per new cycle: the
November-period grant at 15:57:49.299 UTC and December-period grant at
16:26:16.457 UTC on October 6, with no additional grants for either period.

The recovered subscription then scheduled cancellation at **January 6, 2027 at
15:41:17 UTC**. Advancing the clock past that boundary produced Stripe
`status: canceled` with `ended_at` equal to the scheduled period end. Its signed
`customer.subscription.deleted` event completed on October 6 at
**16:27:20.223 UTC**, granted zero credits, and projected **Free/canceled with
498 available and zero reserved credits** in the database. A fresh hosted
Studio showed Free and 498 credits, with 12 saved conversations and the selected
completed TreeBay report's three deliverables still present. That browser view
does not substitute for a later independent sign-in, a new download check or
full project access/admission acceptance after downgrade.

No manual replay of either new cycle event has been performed. Earlier same-
event invoice/pack replay evidence remains valid for its original events; it
must not be relabeled as a replay of these renewals. Exact provider identities,
event outcomes, balances, simulated boundaries and browser screenshots are in
the private October 6 renewal/recovery record. This test used no real payment,
cash refund, live billing configuration or production cutover.

The attached clock was created in real time on **October 6 at 15:51:50 UTC**.
Its real-time automatic deletion is **November 5, 2026 at 15:51:50 UTC**, despite
the later simulated calendar date. Finishing/deleting the simulation deletes
its associated customer. Preserve the current evidence and prepare staging
customer continuity before expiry; do not use Finish simulation or delete the
clock as routine cleanup.

## October 5 isolated hosted acceptance

The isolated API redeployed Live at runtime
`286b99da93ae7a0dda580d2d5d762824fa679b84` as
`dep-db254s6k1f9s73953slg` after its Stripe environment update. A restricted
test key with Checkout Sessions write, Customer Portal write and Subscriptions
read permissions was installed. A dedicated active test webhook subscribes to
15 event types at the isolated API's `/v1/webhooks/stripe`, using Stripe API
version `2026-08-26.dahlia`. The existing four legacy test prices and the unique
`iabt-isolated-staging-v1` app marker were configured. These are isolated test
changes; production and the historical endpoint were not cut over.

Two concurrent Builder requests in the actual UI returned one provider Checkout
session. Canceling and reopening reused it. A Pro request while that session was
pending failed closed with `stripe_checkout_terms_conflict`. The Builder $29
test payment then succeeded. Its signed `invoice.paid` event granted exactly
100 legacy credits. Available credits changed from zero to 100, with zero
reserved credits; other October 5 jobs had consumed the earlier starter balance.
Manual redelivery returned HTTP 200 with `reused: true`, and the available
balance remained 100. The customer portal opened and displayed the paid invoice.

The same isolated account then attempted a $10/100-credit pack. Stripe's actual
Checkout UI reported an insufficient-funds decline, and a fresh application
read still showed 100 credits. Retrying that same Checkout with a successful
test method completed payment. Its signed `checkout.session.completed` event
returned `credit_pack_granted` with 100 credits, and a fresh application read
showed 200 available credits with the Builder plan. Manual pack-event redelivery
returned HTTP 200 with `reused: true` and `action: succeeded`; a fresh Studio
read still showed 200 credits and Builder. Enabled methods were observed as `card`,
`apple_pay`, `cashapp`, `klarna` and `link_instant_debit`; that configuration is
not evidence of an actual asynchronous pending-to-settled payment sequence.

Exact account, customer, subscription, session and event identities are retained
in the private acceptance record, not in repository diagnostics or bearer URLs.

This proves the initial isolated subscription payment, observed pending
Checkout/invoice-replay behavior and card-pack decline/recovery/replay. It does not
prove fulfillment without returning from
Checkout, renewal, recurring decline/recovery, effective or immediate
cancellation, asynchronous packs, interrupted fulfillment, refunds or disputes.
The observed $29/100-credit legacy purchase is not the approved future
$29/300-credit Builder offer. Do not reinterpret or repeat this purchase under
changed allowances.

## Price-contract deployment — October 6 UTC

Candidate `d06894d30200afcebbd6d15f0bc3f9fe05e1f12a` is published and passed
[CI run 677](https://github.com/notenoughtimeinaday/iabt/actions/runs/37402441778).
Its isolated API deployment `dep-db25i03bc2fs73faso5g` became Live on October 6,
2026 at 02:12:47 UTC. The unchanged frontend remains at 286b99d. Readiness
reported eight applied migrations and none pending, including migration 008
for immutable price contracts. A fresh app reload retained Builder, 200
available credits, zero reserved credits and the same customer/subscription
association.

The candidate passed 87 focused tests. After the final curriculum change, the
complete `npm run verify` was repeated with the correct isolated API origin and
exited zero: 393 tests, zero failures or skips, plus lint, type checking,
Exchange/creation, frontend and production-build checks. An earlier build
attempt failed because `VITE_IABT_API_URL` was missing; the corrected build
rerun and final complete verification both passed.

After deployment, the actual Stripe test portal scheduled period-end
cancellation, then restored renewal of the same legacy Builder subscription.
The new events at 02:14:46 and 02:15:27 UTC each returned HTTP 200,
`reused: false`, `subscription_entitlement_updated` and `credits_granted: 0`.
A fresh app read during cancellation retained active Builder, 200 available
credits and zero reserved credits, with `cancel_at: 2026-11-06T01:50:15Z` and
`cancellation_scheduled: true`. Its canonical period-end flag was true even
though the provider's `cancel_at_period_end` was false. Restoring renewal
cleared the cancellation time/schedule while preserving the same customer,
subscription, active tier and 200/0 credit balances.

Both fresh states attached a `billing_price_contract` for the configured legacy
Builder price: version `legacy-v1`, 100 credits per month, contract SHA-256
`c239cdb856ec3ae3accda6da09fe7ed6c5b8f15045119a7ed26cc5084864fa1c`.
This proves a fresh hosted subscription entitlement update used the durable
contract lookup. It does not prove renewal-credit granting, effective
cancellation or a new offer. Direct SQL enumeration of the hosted registry
subsequently passed on October 6: three test-mode `legacy-v1` monthly contracts
persist for Builder 100, Pro 500 and Agency 2000 credits. This read-only check
does not establish a renewal grant or new-offer acceptance.
The earlier invoice/pack replay tests ran against 286b99d
and are not the evidence for this new lookup path.

The hosted learning response returned HTTP 200 with
`billing.versioned_price_allowances` and the `software-release-benchmark`
TreeBay rule. Its curriculum digest was
`a1c9aaf636759629cb47e7aab27feb94752918ee8f6af746f8614a911ffd68ff`.
Serving those lessons does not implement the benchmark or confer permissions.
The new offers, introductory eligibility and renewal disclosure still require
implementation or provider acceptance; deployment does not activate or accept
them.

## Paid-credit source delivery on d06894d

After the subscription and pack tests funded the isolated account, Studio
accepted `TREEBAY_ACCEPTANCE_BENCHMARK.md` as a real attachment and a request
for a report grounded in that source. The supported safe, zero-external-cost
workflow ran automatically. One job succeeded with three stored artifacts and
one captured IABT credit, changing available credits from 200 to **199**. The
earlier 200-credit cancellation/replay observations remain historical; 199 is
the balance observed for this delivery. A later October 6 read-only database
check observed 198 available and zero reserved credits on the same Builder
test account. The credit funding was Stripe test-mode
funding, not live revenue.

Native browser downloads matched each artifact's persisted byte count and
SHA-256. The verified source and outputs were:

| Item | Bytes | SHA-256 |
| --- | ---: | --- |
| Attached benchmark source | 4,892 | `48575f120dbd01f68a6340e6e1c76fa9df69b946487d4f9c175d23cfba0dadeb` |
| Markdown report | 9,147 | `8639310a553e558639896ad7e8a635c533be305a75c5bf1e6013d498f630caad` |
| PDF report | 13,730 | `71a8776bdbad5a38e71799420c2606124a2666c578d49f6b5e9f050406540514` |
| DOCX report | 21,811 | `e6d7074d00606a035174ef8ee3417c42268c7f0aeca2487a98706e262c5440f0` |

All four PDF pages were rendered and inspected: the content was legible with
no overlap. Literal monospace source wrapping was awkward, and candidate
extraction remained line-based. The output inventories and preserves the
input; it does not demonstrate semantic TreeBay diagnosis, a complete release
checklist, source repairs, successful software builds or store submission.
The Markdown preserves every nonempty source line. DOCX ZIP/XML validation
passed, but the new DOCX has not yet received visual review.
October 4 Word acceptance belongs to its earlier sample and cannot substitute
for this report's visual acceptance. The exact job identity remains in the
private acceptance record.

A fresh hosted learning response also returned the account-scoped job execution
observation with `verified_delivery`, all three matching artifact hashes and
one execution attempt. It explicitly recorded
`functional_correctness: not_established`. This completes the evidenced report-
delivery scope and preserves its limitations; it does not establish TreeBay
repair or expand Jericho's authority.

## Refunds are a separate unfinished workflow

The previous webhook dispatch silently acknowledged refund events with
`action: ignored`. The September 30 local change adds an operator-only inbox for
`refund.created`, `refund.updated`, `refund.failed`, `charge.refund.updated` and
`charge.refunded`. Migration `006_refund_observations.sql` retains bounded,
immutable observations after signature/mode verification and a current event
processing claim. Acknowledgment and duplicate replies explicitly say
`refund_reconciliation_required`; they are not reconciliation success.

Each event retains provider identities, connected-account context when present,
event time, amount/currency and observed status. Private descriptions, card
details, emails and raw metadata are omitted. Matching application metadata is
only an attribution hint, never account ownership. No generic API route exposes
this operator evidence, including to application administrators. A charge's
cumulative refunded amount is distinguished from an individual refund amount;
never add both together. Older snapshots cannot replace newer evidence because
there is no automatic latest-state projection. Unknown provider statuses remain
explicitly unknown, not successful.

Interrupted transport completion retries the same immutable inbox entry.
Missing persistence fails the webhook instead of discarding it. Older releases'
successful-but-ignored receipts without an inbox entry return
`stripe_refund_receipt_missing` on redelivery and need operator reconciliation;
the change does not infer historical refunds from a prior HTTP 200 or perform
an automatic historical backfill. `refund-postgres.test.js` passed against a
disposable local database in the October 4 complete suite, including concurrent
instances, interrupted completion, reopening and stale claims. Exact commit
78d1c82 passed CI and deployed migration 006 to the isolated database. These
supersede earlier skipped/local-only descriptions. Actual provider refund
ingestion and lifecycle acceptance remain pending.

The October 6 undeployed candidate now adds payment association, current-state
verification and an immutable host-only operator review. It verifies the current
Stripe account/mode, refund, charge, PaymentIntent and original paid source
against the persisted customer, fulfillment and ledger grant; metadata cannot
establish ownership. An operator can approve the exact evidence digest with
`retain_existing_credits_v1`, retaining all credits, reservations and access
without additional grants. This policy supports full/partial refund review but
does not infer a payment's unused credits from a fungible account balance.
See [operator refund reconciliation](REFUND_OPERATOR_RECONCILIATION.md).

That candidate is not yet deployed or accepted through a real sandbox refund.
Its complete local verification passed with 427 tests, zero failures/skips,
including 70 PostgreSQL checks, plus lint, type checking and the production build;
exact published-commit CI and hosted acceptance remain separate gates.
The deployed inbox alone still does not associate payments or alter credits,
access or cash. The operator workflow makes no Stripe write and does not execute
a cash refund. Dispute reconciliation remains absent. Cash refunds and credit
adjustments remain separate, explicitly authorized operations; a signed event
or learning record does not approve either action.

Stripe documents asynchronous refund state and failure handling in
[Refund and cancel payments](https://docs.stripe.com/refunds). Receipt of an event
or an initial refund creation response cannot establish that funds reached the
customer. Hosted acceptance must verify the candidate's association between the
refund, its payment/charge and the original fulfillment; current fulfillment
records are centered on Checkout or subscription-period grant identity.

Do not substitute a failed-job credit release for this workflow. A failed job
returns that job's reserved IABT credits; it calls no cash-refund endpoint and
cannot recover supplier charges. Cancellation likewise does not debit or refund
the existing credit balance. There is no chosen automatic clawback policy in
this implementation, especially for already-spent credits or partial refunds.

## Environment and account boundaries

Use the existing isolated staging services and database listed in
[CURRENT_RELEASE_STATUS.md](CURRENT_RELEASE_STATUS.md). The older API/database
pair is historical acceptance evidence, not the current target. On October 4,
the connector exposed only a different legacy test account, despite the owner's
reported reconnection, and the isolated Builder price was empty. Those were
dated configuration/access findings, not a generic authentication failure.
The October 5 dashboard setup, installed isolated test credential, dedicated
webhook, legacy price mapping and actual payment now supersede the claim that
isolated payment wiring is still absent. They do not establish which accounts
a later connector listing will expose.

During the earlier October 6 check, reconnection restored connector authentication,
but the authorized test account was still the legacy Base44 account. Complete
read-only customer, price and subscription lists were empty; its only webhook destination was
Base44. The standalone account identity is retained in the private October 5
acceptance record. The owner received Stripe's account-access link to add that
existing account in test mode. No provider writes, replacement accounts, new
prices, payment attempts or runtime changes were made during that earlier check.
The correct existing standalone test account was subsequently authorized and
verified for the [15:38–15:42 UTC lifecycle check](#october-6-immediate-cancellation-and-resubscription),
resolving that connection gate. The isolated
database's two verified original users and three immutable legacy monthly
contracts were confirmed independently; those reads do not replace hosted
password recovery, cross-account request tests or provider lifecycle evidence.

Keep `IABT_STRIPE_MODE=test` and the unique isolated app marker fixed for the
accepted pending sessions and subscription. Separate endpoint signing secrets
authenticate deliveries; they do not prevent other subscribed endpoints on the
same Stripe account from receiving events. The app marker separates ownership
and fulfillment from the historical integration. Do not disable the historical
endpoint or change old customer/credit state to make isolated acceptance pass.
No real purchase or account funding is needed for sandbox acceptance. Do not
create replacement accounts or copy prices/credentials across accounts to make
an old test pass.

The webhook mode check and mode-prefixed fulfillment identities do not partition
`AccountEntitlement` or the execution credit balance, which remain keyed by
account owner. Isolated staging protects the current test work; changing that
database to live mode is not an accepted migration. The
[persisted billing-mode binding](BILLING_FULFILLMENT.md#database-billing-mode-binding)
passed complete local verification and exact-commit CI, and migration 007 is
first deployed on isolated staging at 286b99d and remains included in d06894d.
The earlier 78d1c82/six-migration state remains historical evidence. Mode binding does not establish correct Stripe
account selection or complete a live payment journey.
A reviewed production data/credit migration is still required. Test grants must
not become live purchased credits.

## Evidence to retain

For each sandbox run, retain the tested commit/environment, redacted account ID,
Stripe object/event IDs, test-mode flag, event outcome, before/after entitlement
and available/reserved credits, relevant receipt/ledger identities, and any
job/artifact IDs and verified hashes. Never retain card fields, credentials,
webhook signing secrets, session access tokens or full provider error bodies.
Use [Stripe's Billing testing guidance](https://docs.stripe.com/billing/testing)
to distinguish simulated provider behavior from local payload injection.

Repository coverage is in `stripe-checkout.test.js`, `stripe-webhook.test.js`,
`refund-events.test.js`, `refund-postgres.test.js`,
`billing-postgres.test.js`, `checkout-attempt.test.js`, `project-quota.test.js`, `billing-acceptance.test.js`
and the existing artifact/worker recovery suites. Passing refund inbox tests
means receipt and the remaining boundary were observed; it does **not** pass the refund
acceptance row. The [billing contract](BILLING_FULFILLMENT.md) defines the current
grant and project-quota behavior. Production billing and cutover remain gated by
separate staging acceptance.
