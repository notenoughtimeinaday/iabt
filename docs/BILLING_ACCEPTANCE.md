# Billing acceptance and remaining requirements

Baseline code audited at `ee4d8d34539d60d7d5980aad9bb9d4e3740150c1` on 2026-09-20;
the pending Checkout guard below was added during the follow-up audit.
The added [local acceptance-contract tests](../server/test/billing-acceptance.test.js)
use synthetic signed events, mocked Stripe responses and private local files.
They do not establish a completed hosted Checkout, actual decline, recurring
collection, portal cancellation, refund or staging delivery. Actual September
20–22 browser, Stripe and Neon results are recorded separately in the
[dated staging payment and delivery report](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md).
The table distinguishes those observed passes from the work still required.

| Scenario | Existing local evidence | Remaining sandbox acceptance | Status |
| --- | --- | --- | --- |
| Hosted subscription Checkout | Server derives tier, price, owner metadata and redirects. A subscription label grants no credits by itself. | Verify fulfillment when the customer never visits the success page; keep renewal and cancellation acceptance separate. | **Initial hosted payment and one 100-credit allowance passed September 20.** [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-20-hosted-subscription-payment) |
| Hosted credit-pack Checkout | Server captures pack quantity; paid session identity grants once; unpaid completion waits for delayed success. | Exercise an enabled asynchronous method through pending then successful or failed settlement. No credits may appear while payment is unpaid or failed. | **Hosted card payment and one 100-credit pack grant passed September 22.** Asynchronous settlement unverified. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-hosted-credit-pack-and-replay) |
| Signed delivery, replay and interrupted fulfillment | Memory and PostgreSQL tests cover signatures, same/different event IDs, concurrent instances, crash windows and restart. | Verify hosted different-event/same-payment delivery and an interrupted fulfillment in an isolated environment, with no duplicate grant. | **Actual signed delivery and same-event replay passed.** Invoice replay returned 200/reused with three grant entries unchanged; September 23 pack replay returned 200 with the reloaded balance unchanged. Hosted interruption and other-event cases remain open. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-hosted-credit-pack-and-replay) |
| Purchased credit to private artifact | The local contract combines purchase fulfillment, automatic document creation, worker byte verification, credit capture and file readback. | Repair browser download handoff; download and inspect hosted artifacts, reload/restart and retrieve again. Verify second-account denial and terminal failure release. | **Partial:** hosted job succeeded once, recorded three verified formats and one reserve/capture; balance 210 to 209. Browser download did not start and is not passed. Local visual checks are separate. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-funded-private-studio-execution) |
| Monthly renewal | Synthetic monthly invoices grant once per subscription period and preserve earlier credits. | Use an isolated sandbox subscription and [Stripe Billing simulation](https://docs.stripe.com/billing/testing/test-clocks) to advance to the next real monthly invoice. Observe its webhook and one additional tier allowance; replay it and confirm no increase. Keep this separate from the hosted Checkout evidence. | Unverified |
| Decline and recovery | Synthetic `invoice.payment_failed` is ignored and cannot fund credits. Verified subscription states determine grace: `past_due` retains the tier, `unpaid` becomes Free. Recovery plus a paid invoice funds once. | Cause an actual renewal decline; inspect invoice/payment/subscription state and no new grant. Observe configured dunning, restore a successful test method and verify one allowance after actual settlement. | **Initial hosted decline and retry passed:** balance stayed 10 until successful payment. Recurring decline/recovery unverified. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-20-hosted-subscription-payment) |
| Period-end and immediate cancellation | Local checks retain paid access while cancellation is scheduled, downgrade on verified canceled state, and retain credits. Follow-up projection tests cover provider `cancel_at` at the item period boundary while its period-end boolean is false. | Deploy/reconcile the projection repair, verify the future effective downgrade, immediate cancellation, later sign-in, project access and credit retention. Cancellation is not a cash refund. | **Partial:** portal and provider confirmed October 20 scheduling; the deployed app missed the schedule because it read only the false boolean. Effective and immediate cancellation unverified. [Evidence](STAGING_PAYMENT_DELIVERY_ACCEPTANCE_2026-09-22.md#september-22-scheduled-cancellation-and-projection-defect) |
| Cash refund lifecycle | Refund event receipt succeeds but application processing returns `ignored`; the added test explicitly documents this limitation. | Before declaring support, define how full/partial refunds affect unused, reserved and spent IABT credits and subscription access. Implement durable payment-to-refund reconciliation and test pending, succeeded, failed, canceled, partial/multiple, duplicate and out-of-order refund events. Then refund only a sandbox payment and verify both Stripe state and the defined application result. | **Unsupported application reconciliation** |
| Concurrent first-time subscription purchase | A private pending-session record now reuses one session across concurrent instances and restart, retains exact retry parameters, and requires verified expiry before replacement. Completed-unreconciled sessions and changed terms fail closed. Existing subscribers use the portal. | Start subscription Checkout concurrently from two tabs before an entitlement exists. Verify one actual provider session, then test interrupted/retried creation, browser cancellation/reopen, changed-plan conflict, provider expiry and later purchase after verified cancellation. | Local regression passed; sandbox unverified |

## Refunds are a separate unfinished workflow

The current webhook dispatch recognizes paid Checkout completion, delayed
Checkout success, subscription lifecycle updates and `invoice.paid`.
`refund.created`, `refund.updated`, `refund.failed` and `charge.refunded` fall
through to `action: ignored`. Their transport receipt can be marked succeeded
without creating an owner billing event, refund record or credit adjustment.
Refund ingestion, reconciliation and an application refund policy are therefore
not implemented. Dispute reconciliation is also absent.

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

## Evidence to retain

For each sandbox run, retain the tested commit/environment, redacted account ID,
Stripe object/event IDs, test-mode flag, event outcome, before/after entitlement
and available/reserved credits, relevant receipt/ledger identities, and any
job/artifact IDs and verified hashes. Never retain card fields, credentials,
webhook signing secrets, session access tokens or full provider error bodies.
Use [Stripe's Billing testing guidance](https://docs.stripe.com/billing/testing)
to distinguish simulated provider behavior from local payload injection.

Repository coverage is in `stripe-checkout.test.js`, `stripe-webhook.test.js`,
`billing-postgres.test.js`, `checkout-attempt.test.js`, `project-quota.test.js`, `billing-acceptance.test.js`
and the existing artifact/worker recovery suites. A passing refund-limitation
test means the unsupported boundary was observed; it does **not** pass the refund
acceptance row. The [billing contract](BILLING_FULFILLMENT.md) defines the current
grant and project-quota behavior. Production billing and cutover remain gated by
separate staging acceptance.
