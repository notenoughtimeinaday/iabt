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

| Scenario | Existing local evidence | Remaining sandbox acceptance | Status |
| --- | --- | --- | --- |
| Hosted subscription Checkout | Server derives tier, price, owner metadata and redirects. A subscription label grants no credits by itself. | Verify fulfillment when the customer never visits the success page; keep renewal and cancellation acceptance separate. | **October 5 isolated payment passed on 286b99d:** a legacy Builder $29 test payment produced one signed-invoice allowance, available credits 0 to 100 and reserved credits zero. The customer portal opened and showed the paid invoice. [Current evidence](#october-5-isolated-hosted-acceptance) September 20 results remain historical. |
| Hosted credit-pack Checkout | Server captures pack quantity; paid session identity grants once; unpaid completion waits for delayed success. | Exercise an enabled asynchronous method through pending then successful or failed settlement. No credits may appear while payment is unpaid or failed. | **October 5 isolated card decline, recovery and same-event replay passed on 286b99d:** a $10/100-credit pack was declined for insufficient funds, with a fresh app read still showing 100 credits. Successful retry of the same Checkout produced a signed `checkout.session.completed` grant of 100; the fresh app showed 200 credits and Builder. Manual redelivery returned HTTP 200 with `reused: true` and `action: succeeded`; a fresh Studio read still showed 200 credits and Builder. Asynchronous settlement remains unverified. [Current evidence](#october-5-isolated-hosted-acceptance) September 22 results remain historical. |
| Signed delivery, replay and interrupted fulfillment | Memory and PostgreSQL tests cover signatures, same/different event IDs, concurrent instances, crash windows and restart. | Verify hosted different-event/same-payment delivery and an interrupted fulfillment in an isolated environment, with no duplicate grant. | **October 5 isolated signed delivery and same-event replay passed for invoice and pack:** the initial invoice granted 100 once and its redelivery left the balance at 100. The later pack granted 100 once and its redelivery left the balance at 200. Both replays returned HTTP 200 with `reused: true`. Hosted interruption and other-event cases remain open. [Current evidence](#october-5-isolated-hosted-acceptance) Earlier invoice/pack replays remain [historical evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-hosted-credit-pack-and-replay). |
| Purchased credit to private artifact | The local contract combines purchase fulfillment, automatic document creation, worker byte verification, credit capture and file readback. | Visually review the new DOCX, and verify hosted second-account denial, terminal failure release and actual storage recovery. Reuse the completed source-review jobs for file checks. | **Test-purchased-credit delivery passed on d06894d:** a real Studio attachment request automatically completed one source-review job, captured one credit (200 to 199), and delivered MD/PDF/DOCX through native browser downloads matching stored byte counts/hashes. Four PDF pages were legible with no overlap; new DOCX visual review remains pending. The report inventories/preserves literal input and extracts candidates by line; it is not semantic TreeBay diagnosis or a complete release checklist. [Current evidence](#paid-credit-source-delivery-on-d06894d) Earlier starter-credit and September purchased-credit journeys remain separate history. |
| Monthly renewal | Synthetic monthly invoices grant once per subscription period and preserve earlier credits. | Use an isolated sandbox subscription and [Stripe Billing simulation](https://docs.stripe.com/billing/testing/test-clocks) to advance to the next real monthly invoice. Observe its webhook and one additional tier allowance; replay it and confirm no increase. Keep this separate from the hosted Checkout evidence. | Unverified |
| Decline and recovery | Synthetic `invoice.payment_failed` is ignored and cannot fund credits. Verified subscription states determine grace: `past_due` retains the tier, `unpaid` becomes Free. Recovery plus a paid invoice funds once. | Cause an actual renewal decline; inspect invoice/payment/subscription state and no new grant. Observe configured dunning, restore a successful test method and verify one allowance after actual settlement. | **October 5 isolated pack decline/retry passed:** balance stayed 100 after the decline and became 200 only after successful settlement. This is not recurring invoice recovery. September 20 initial subscription decline/retry remains [historical evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-20-hosted-subscription-payment); recurring decline/recovery is unverified. |
| Period-end and immediate cancellation | Local checks retain paid access while cancellation is scheduled, downgrade on verified canceled state, and retain credits. Projection tests cover provider `cancel_at` at the item period boundary while its period-end boolean is false; the repair is included in the current isolated candidate. | Verify effective downgrade, immediate cancellation, later sign-in, project access and credit retention. Cancellation is not a cash refund. | **Fresh isolated scheduling and renewal restoration passed on d06894d:** the portal scheduled period-end cancellation, then restored renewal of the same subscription. Both real events updated entitlement with zero grants; Builder remained active with 200 available and zero reserved credits. The app correctly projected period-end cancellation from `cancel_at` despite the provider boolean being false. Effective and immediate cancellation remain unverified. [Current evidence](#price-contract-deployment--october-6-utc) September 22 results remain historical. |
| Cash refund lifecycle | Immutable operator refund observations retain bounded signed evidence, mark reconciliation required and preserve replay/out-of-order evidence without changing money, credits or access. Memory and disposable PostgreSQL tests passed; migration 006 is deployed on isolated staging. | Associate the original payment/fulfillment, retrieve current provider state, define full/partial treatment of unused/reserved/spent credits, and implement explicit operator approval for consequential adjustments. Then exercise actual sandbox refunds and verify provider and application results. | **Observation ingestion implemented, tested and deployed; payment association, financial reconciliation and actual hosted refund lifecycle remain incomplete** |
| Concurrent first-time subscription purchase | A private pending-session record now reuses one session across concurrent instances and restart, retains exact retry parameters, and requires verified expiry before replacement. Completed-unreconciled sessions and changed terms fail closed. Existing subscribers use the portal. | Verify interrupted/retried creation, actual provider expiry and later purchase after verified cancellation. The observed concurrent UI requests do not establish multiple-server or restart acceptance. | **October 5 isolated UI checks passed:** two concurrent Builder clicks returned the same Checkout session; cancellation/reopen reused it; selecting Pro while it remained pending returned HTTP 409 `stripe_checkout_terms_conflict`. [Current evidence](#october-5-isolated-hosted-acceptance) |

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

Payment association, authoritative current-state reconciliation and an
application refund policy are still not implemented. The inbox does not create
owner billing records or alter credits, access or cash. Dispute reconciliation
is also absent. Cash refunds and credit adjustments must remain separate,
explicitly approved operator actions; a signed event or learning record does
not approve either action.

Stripe documents asynchronous refund state and failure handling in
[Refund and cancel payments](https://docs.stripe.com/refunds). Receipt of an event
or an initial refund creation response cannot establish that funds reached the
customer. The application also needs a verified association between the refund,
its payment/charge and the original fulfillment; current fulfillment records are
centered on Checkout or subscription-period grant identity.

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

On October 6, reconnection restored connector authentication, but the authorized
test account was still the legacy Base44 account. Complete read-only customer,
price and subscription lists were empty; its only webhook destination was
Base44. The standalone account identity is retained in the private October 5
acceptance record. The owner received Stripe's account-access link to add that
existing account in test mode. No provider writes, replacement accounts, new
prices, payment attempts or runtime changes were made during this check.
Resume the unverified lifecycle scenarios only after the authorized account
matches the existing staging subscription and price contracts. The isolated
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
