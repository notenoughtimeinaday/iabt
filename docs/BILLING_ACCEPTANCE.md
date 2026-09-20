# Billing acceptance still required

Baseline code audited at `ee4d8d34539d60d7d5980aad9bb9d4e3740150c1` on 2026-09-20;
the pending Checkout guard below was added during the follow-up audit.
The added [local acceptance-contract tests](../server/test/billing-acceptance.test.js)
use synthetic signed events, mocked Stripe responses and private local files.
They do not establish a completed hosted Checkout, actual decline, recurring
collection, portal cancellation, refund or staging delivery. Record real sandbox
results separately against the exact deployed commit; none are marked passed here.

| Scenario | Existing local evidence | Exact sandbox acceptance still required | Status |
| --- | --- | --- | --- |
| Hosted subscription Checkout | Server derives tier, price, owner metadata and redirects. A subscription label grants no credits by itself. | Open Checkout from a verified staging account, complete a sandbox payment, close the return page, and independently observe signed subscription and paid-invoice webhooks. Verify the chosen tier, one monthly grant and matching owner/customer/subscription/invoice IDs. | Unverified |
| Hosted credit-pack Checkout | Server captures pack quantity; paid session identity grants once; unpaid completion waits for delayed success. | Complete a sandbox pack purchase and verify the exact captured quantity. Exercise an enabled asynchronous method through pending then successful or failed settlement. No credits may appear while payment is unpaid or failed. | Unverified |
| Signed delivery, replay and interrupted fulfillment | Memory and PostgreSQL tests cover signatures, same/different event IDs, concurrent instances, crash windows and restart. | Deliver actual sandbox events to the staging endpoint; resend both the same event and another event for the same payment. Inspect one receipt and one ledger grant. Interrupt an isolated staging processing attempt and verify retry completes without a duplicate grant. | Unverified |
| Purchased credit to private artifact | The local contract combines purchase fulfillment, automatic document creation, worker byte verification, credit capture and file readback. | From the funded staging account, submit work, observe reserve then one capture, download and inspect the expected artifact, reload/restart and retrieve it again. A second account must be denied. Verify a terminal delivery failure releases its reservation exactly once. | Unverified |
| Monthly renewal | Synthetic monthly invoices grant once per subscription period and preserve earlier credits. | Use an isolated sandbox subscription and [Stripe Billing simulation](https://docs.stripe.com/billing/testing/test-clocks) to advance to the next real monthly invoice. Observe its webhook and one additional tier allowance; replay it and confirm no increase. Keep this separate from the hosted Checkout evidence. | Unverified |
| Decline and recovery | Synthetic `invoice.payment_failed` is ignored and cannot fund credits. Verified subscription states determine grace: `past_due` retains the tier, `unpaid` becomes Free. Recovery plus a paid invoice funds once. | Cause an actual sandbox initial-payment decline and renewal decline, inspect Stripe invoice/payment/subscription state, and show no new grant. Observe the configured recovery/dunning transitions, update to a successful test method and verify one grant after actual paid settlement. | Unverified |
| Period-end and immediate cancellation | Local checks keep the tier while `cancel_at_period_end` is true, downgrade when current Stripe state is canceled, and retain existing credits. | Cancel through the sandbox customer portal, verify access until the period ends, then the effective downgrade. Also verify immediate cancellation, later sign-in, retained project access and credit balance. Cancellation must not be reported as a cash refund. | Unverified |
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
