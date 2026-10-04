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
the current isolated environment or another Stripe account.

| Scenario | Existing local evidence | Remaining sandbox acceptance | Status |
| --- | --- | --- | --- |
| Hosted subscription Checkout | Server derives tier, price, owner metadata and redirects. A subscription label grants no credits by itself. | Verify fulfillment when the customer never visits the success page; keep renewal and cancellation acceptance separate. | **Initial hosted payment and one 100-credit allowance passed September 20.** [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-20-hosted-subscription-payment) |
| Hosted credit-pack Checkout | Server captures pack quantity; paid session identity grants once; unpaid completion waits for delayed success. | Exercise an enabled asynchronous method through pending then successful or failed settlement. No credits may appear while payment is unpaid or failed. | **Hosted card payment and one 100-credit pack grant passed September 22.** Asynchronous settlement unverified. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-hosted-credit-pack-and-replay) |
| Signed delivery, replay and interrupted fulfillment | Memory and PostgreSQL tests cover signatures, same/different event IDs, concurrent instances, crash windows and restart. | Verify hosted different-event/same-payment delivery and an interrupted fulfillment in an isolated environment, with no duplicate grant. | **Actual signed delivery and same-event replay passed.** Invoice replay returned 200/reused with three grant entries unchanged; September 23 pack replay returned 200 with the reloaded balance unchanged. Hosted interruption and other-event cases remain open. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-hosted-credit-pack-and-replay) |
| Purchased credit to private artifact | The local contract combines purchase fulfillment, automatic document creation, worker byte verification, credit capture and file readback. | Complete the payment-to-delivery journey in the canonical isolated environment, hosted second-account denial, terminal failure release and actual storage recovery. Reuse the completed source-review job for file checks. | **File-delivery defect repaired:** October 4 isolated staging produced actual MD/DOCX/PDF downloads, repeated matching hashes and successful Word/PDF visual review. Starter-credit balance changed 10 to 9 once; this was not a fresh paid purchase. Saved state and matching PDF download also passed after deployment to 78d1c82. The older purchased-credit job (210 to 209) remains separate historical evidence. [October 4 evidence](STAGING_CONTINUATION_2026-10-04.md#hosted-evidence) |
| Monthly renewal | Synthetic monthly invoices grant once per subscription period and preserve earlier credits. | Use an isolated sandbox subscription and [Stripe Billing simulation](https://docs.stripe.com/billing/testing/test-clocks) to advance to the next real monthly invoice. Observe its webhook and one additional tier allowance; replay it and confirm no increase. Keep this separate from the hosted Checkout evidence. | Unverified |
| Decline and recovery | Synthetic `invoice.payment_failed` is ignored and cannot fund credits. Verified subscription states determine grace: `past_due` retains the tier, `unpaid` becomes Free. Recovery plus a paid invoice funds once. | Cause an actual renewal decline; inspect invoice/payment/subscription state and no new grant. Observe configured dunning, restore a successful test method and verify one allowance after actual settlement. | **Initial hosted decline and retry passed:** balance stayed 10 until successful payment. Recurring decline/recovery unverified. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-20-hosted-subscription-payment) |
| Period-end and immediate cancellation | Local checks retain paid access while cancellation is scheduled, downgrade on verified canceled state, and retain credits. Projection tests cover provider `cancel_at` at the item period boundary while its period-end boolean is false; the repair is included in the current isolated candidate. | Verify current isolated provider/app scheduling, effective downgrade, immediate cancellation, later sign-in, project access and credit retention. Cancellation is not a cash refund. | **Historical scheduling evidence; lifecycle acceptance incomplete.** The September 22 portal/provider scheduling and original display defect remain recorded in the dated report. Do not reuse that old deployed-state snapshot as the current candidate's status. Effective and immediate cancellation remain unverified. [Historical evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-scheduled-cancellation-and-projection-defect) |
| Cash refund lifecycle | Immutable operator refund observations retain bounded signed evidence, mark reconciliation required and preserve replay/out-of-order evidence without changing money, credits or access. Memory and disposable PostgreSQL tests passed; migration 006 is deployed on isolated staging. | Associate the original payment/fulfillment, retrieve current provider state, define full/partial treatment of unused/reserved/spent credits, and implement explicit operator approval for consequential adjustments. Then exercise actual sandbox refunds and verify provider and application results. | **Observation ingestion implemented, tested and deployed; payment association, financial reconciliation and actual hosted refund lifecycle remain incomplete** |
| Concurrent first-time subscription purchase | A private pending-session record now reuses one session across concurrent instances and restart, retains exact retry parameters, and requires verified expiry before replacement. Completed-unreconciled sessions and changed terms fail closed. Existing subscribers use the portal. | Start subscription Checkout concurrently from two tabs before an entitlement exists. Verify one actual provider session, then test interrupted/retried creation, browser cancellation/reopen, changed-plan conflict, provider expiry and later purchase after verified cancellation. | Local regression passed; sandbox unverified |

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
pair is historical acceptance evidence, not the current target. On October 4
the Stripe connector successfully read only test account
`acct_1U6O5GDTeg6LQ8RA` (IABT-JERICHO), with no active prices and one legacy
Base44 webhook. Historical paid-test evidence belongs to Insured Spending
`acct_1TOYQhJQwCRZm16s`. Access to that existing account has been requested
through the connector's account-selection flow and awaits the owner's selection.
This is an account-selection and configuration boundary, not a generic Stripe
authentication failure.

The isolated Render API was observed with `IABT_STRIPE_MODE=test` and an empty
`STRIPE_BUILDER_PRICE_ID`. Correct account access, price mapping and webhook
wiring remain required before isolated payment tests. No real purchase or
account funding is needed for sandbox acceptance. Do not create replacement
accounts or copy prices/credentials across accounts to make an old test pass.

The webhook mode check and mode-prefixed fulfillment identities do not partition
`AccountEntitlement` or the execution credit balance, which remain keyed by
account owner. Isolated staging protects the current test work; changing that
database to live mode is not an accepted migration. A local candidate now adds
the [persisted billing-mode binding](BILLING_FULFILLMENT.md#database-billing-mode-binding);
candidate verification, CI and isolated deployment remain pending. The deployed
78d1c82 baseline and its six applied migrations remain separate evidence.
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
