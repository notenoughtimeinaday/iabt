# Operator refund reconciliation

The internal operator workflow links a refund to an original IABT credit grant,
records current provider evidence, and requires an explicit decision to retain
existing credits. It makes no Stripe write and never changes credits or access.
Cash refunds remain a separate authorized Stripe operation. This document
describes implementation; hosted acceptance belongs in `BILLING_ACCEPTANCE.md`.

## Implemented policy

`retain_existing_credits_v1` retains all existing IABT credits for full or partial
cash refunds, including spent credits and outstanding reservations. It does not
restore spent credits, grant extra credits, revoke entitlements or cancel a
subscription. Failed and canceled cash refunds also cause no credit adjustment.
The operator must approve this exact policy for the exact evidence digest.

This is a deliberately bounded support policy. The current ledger has fungible
credits and cannot prove how many unused credits came from an individual grant.
An account's available balance is not evidence of that grant's unused credits.
There is no automatic clawback, negative balance, or adjustment endpoint.
Different refund economics require a separately reviewed accounting policy.

## Association and current-state verification

The operator supplies an existing signed inbox event, the owner and original
`BillingFulfillment` identity, and the expected existing Stripe account. The
service verifies all of the following before saving a private review:

- A granted fulfillment owned by that account, its exact grant key, amount and
  original ledger entry. Exact legacy Checkout grants remain supported.
- The configured mode, database mode binding, and the Stripe account returned
  by `GET /v1/account` before payment reads. Cross-account Connect events fail.
- The current refund's charge and PaymentIntent, paid charge, succeeded intent,
  amounts/currency, and matching persisted owner customer. Refund metadata and
  email strings cannot establish or override ownership.
- For a pack, the original paid completed Checkout with the exact PaymentIntent,
  customer, currency and paid amount. For a subscription allowance, its original
  paid invoice/subscription and complete single paid InvoicePayment pointing to
  that PaymentIntent. Incomplete, multi-payment or unsupported graphs fail closed.

Refunds have no `livemode` field in the current API. Mode therefore comes from
the signed event, credential namespace and fresh charge/intent/source objects.
See [Refund](https://docs.stripe.com/api/refunds/object) and
[InvoicePayment](https://docs.stripe.com/api/invoice-payment/object).

An individual refund amount stays separate from a charge's cumulative refunded
total. A charge-level event requires an explicit individual refund ID, which
must belong to the observed charge/intent. Neither total is added to the other.
Pending and requires-action states are retained as `provider_pending`; unknown
states fail. Terminal succeeded, failed and canceled states remain distinct.
Stripe-reported success does not prove that the customer received the money.

## Host-only commands

Use the existing isolated environment's `IABT_DATABASE_URL`, `STRIPE_SECRET_KEY`
and `IABT_STRIPE_MODE=test`. Supply credentials through the host's secret
environment, never command arguments, checked-in files or generated reports.
The CLI refuses an unbound database and does not run migrations or bootstrap
new infrastructure. Current source can therefore review an already-migrated
isolated database without silently applying unrelated candidate migrations.

```sh
node deploy/reconcile-stripe-refund.mjs review \
  --owner OWNER_UUID --fulfillment FULFILLMENT_UUID \
  --event evt_EXISTING --account acct_EXPECTED
```

For a charge-level inbox observation, also supply `--refund re_EXISTING`.
The output contains the proposed zero-credit effect, bounded provider facts,
review ID, evidence digest and the observed balance. Keep output in private
operator evidence, since it contains account and provider object identities.

After inspecting that concrete review, the authorized host operator records the
decision using its exact returned ID and digest:

```sh
node deploy/reconcile-stripe-refund.mjs approve \
  --owner OWNER_UUID --review REVIEW_UUID --digest EVIDENCE_SHA256 \
  --operator OPERATOR_ID --approve-policy retain_existing_credits_v1
```

These shell examples use POSIX continuations; enter each command on one line in
PowerShell. Operator identity is an audit label; authority comes from controlled
host access, not the label. Application administrator status grants no access to
these records. Neither command is registered as a model tool or public API.

Approval re-reads the graph. Changed facts require a fresh review. Each review
and decision is insert-only through this service, keyed by canonical evidence;
the shared database transaction serializes duplicates across processes. Retries
return the same decision without another action. If provider status later
changes, a new review/decision preserves earlier history rather than replacing
it. These are time-bounded observations, not an always-current state projection.

Only allowlisted facts are retained. Raw metadata, customer details, card data,
provider error bodies, credentials and arbitrary operator prose are omitted.
`BillingRefundReview` and `BillingRefundDecision` have no generic read/write API,
including for administrators. Refund inbox receipt continues to say
`refund_reconciliation_required`; a webhook does not impersonate an operator.

## Verification scope

`refund-reconciliation.test.js` covers ownership and payment mismatch, account
and mode validation, partial and cumulative values, pending/failure/cancellation,
stale reviews, explicit approval, existing reservations/spending, immutable
duplicates, and sanitized provider failures. Its disposable PostgreSQL case
covers concurrent instances, restart and unchanged ledger. `refund-events.test.js`
also verifies that the new private records are unavailable through entity APIs.
Mocks and local database results do not establish actual Stripe refund ingestion,
hosted CLI operation, customer cash receipt or live/production acceptance.
