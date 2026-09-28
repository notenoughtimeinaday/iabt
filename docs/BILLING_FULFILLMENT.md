# Standalone billing contract

Free accounts receive **10 starter credits once** after verified account access.
Registration alone does not fund an unverified account. Successful verification,
sign-in and verified password recovery check the original `signup:free:v1`
allowance identity. Authenticated `get-account-entitlement` performs the same
check, repairing older verified accounts with an existing session that never
went through current registration. The amount and owner come from the server;
request fields cannot select a recipient, quantity or replacement grant key.

The check reloads the verified account and looks for its earlier starter grant
by that stable key or the recorded `source: initial_free_allowance` provenance.
An identified grant under an older or reviewed import key is preserved. Its
amount is not topped up, even when the balance is now zero. Existing purchased
credits remain intact; an account that has never received the starter allowance
can receive it once alongside purchased credits. Parallel requests and restarts
reuse the ledger's existing grant transaction and key rather than replenishing
spent credits.

A temporary allowance failure does not burn successful authentication or the
one-time verification/recovery code: the auth response includes
`starter_credits_pending: true`, and the next entitlement read retries the check.
This is a normal account workflow, not an operator SQL credit adjustment.
`server/test/starter-credits.test.js` covers verification, migrated recovery,
historical provenance, spent balances, owner isolation and concurrent API reads
against both memory and disposable PostgreSQL repositories.

This check does not infer or import Base44 balances from an email address, a
plan label or a zero balance. Runtime billing/credit migration still needs a
reviewed converter and reconciliation; known starter provenance must be
preserved during such a migration to prevent duplication. No live account is
changed by these code tests, and IABT credits are not cash or a funded supplier
account.

Paid monthly plans grant Builder 100, Pro 500 or Agency 2,000 credits after a
verified `invoice.paid` for subscription creation or a regular monthly renewal.
Credits accumulate in the execution ledger and are not erased by cancellation.
Trial invoices, failed or incomplete payments and mid-cycle proration invoices
do not refill credits. A plan change affects the next eligible monthly grant;
there is no automatic mid-cycle allowance top-up.

Credit packs use the server-set quantity captured in Checkout metadata at
purchase time. Later configuration changes cannot alter an existing purchase.
Unpaid delayed-payment sessions are acknowledged as pending; their later
`checkout.session.async_payment_succeeded` event performs fulfillment.

The payment identity is the Checkout session or the subscription period start,
not the webhook event ID. Server-only `BillingFulfillment` receipts and stable
ledger grant keys prevent duplicate grants, including across instances. A
process interruption between the ledger commit and receipt completion resumes
without issuing a second grant. These entities remain outside generic CRUD.

A webhook already being processed receives a retryable 503 rather than a false
success acknowledgment. Failed events can retry; processing claims abandoned
for 15 minutes can be reclaimed. Successful event IDs remain terminal regardless
of age. Completion and failure writes carry the current claim token, preventing
an older handler from overwriting a newer claim after recovery.

Subscription snapshots can arrive out of order, including events with the same
timestamp. Subscription events trigger a bounded read of the current Stripe
subscription before entitlement updates. `BillingSubscriptionSync` generations
are scoped to each subscription so a slow response cannot overwrite newer
state or suppress reconciliation of a different subscription. Transient reads
fail for retry while preserving existing access and credit balances. The Stripe
restricted key needs subscription read permission as well as Checkout and portal
permissions; keep it in server secrets. No credentials or provider error bodies
are stored in billing records.

The read request pins `2026-08-26.dahlia`, confirmed against Stripe's
[published changelog](https://docs.stripe.com/changelog) and
[versioning policy](https://docs.stripe.com/sdks/versioning) on 2026-09-20.
The webhook parser still supports earlier invoice shapes because event payloads
retain their webhook destination's API version.

The UI consumes standalone `checkout_ready` and `configured` separately.
Existing subscribers can manage overdue or incomplete subscriptions even when
new purchases are unavailable. New subscription checkout cannot silently replace
an existing recoverable subscription. Builder accepts the standalone flat
entitlement response, so paid export flags reach the editor.

## One pending subscription Checkout

The [pending Checkout guard](../server/src/billing/checkout-attempt.js) stores one
private attempt per account and Stripe mode. Concurrent requests, tabs and
restarts reuse its unexpired session. A short database transaction claims the
attempt; provider calls happen after commit. Retry keeps the same server-owned
Stripe idempotency key and frozen parameters, including plan, price, app/user
metadata and expiry. Late handlers cannot overwrite a reclaimed lease.

Sessions request 31 minutes of validity, providing a transmission margin above
Stripe's [30-minute minimum](https://docs.stripe.com/api/checkout/sessions/create#checkout_session_create-expires_at).
An elapsed local timestamp is insufficient to open another session: Stripe must
confirm expiry. Completed Checkout waits for entitlement reconciliation; a
verified canceled prior subscription can start a later purchase. Existing active
or recoverable subscriptions continue through the customer portal.

The browser's cancel return can reopen the same still-payable offer; it does not
expire the session. A different pending plan or price produces an explicit
conflict until the previous offer is resolved or Stripe confirms expiry. Unknown
creation outcomes cannot switch credentials/terms, and retries stop before
Stripe's documented [idempotency retention boundary](https://docs.stripe.com/api/idempotent_requests)
instead of risking a new purchase. Operators need Checkout read permission to
verify existing sessions. `BillingCheckoutAttempt` is outside generic entity
routes; its URLs and frozen account parameters are not public registry facts.

Memory and real local PostgreSQL tests cover concurrency, restart, lost
responses, stale lease owners, changed terms and verified expiry/cancellation.
The [sandbox acceptance matrix](BILLING_ACCEPTANCE.md) remains separate evidence.

## Project capacity

The [server project quota](../server/src/billing/project-quota.js) enforces
Free 1, Builder 5, Pro 25 and Agency unlimited cloud projects. Active, trialing
and past-due subscriptions retain their tier under the existing webhook policy;
inactive or unknown plans use free capacity. Single and bulk creation count only
the authenticated owner's projects, including for administrators. A transaction
checks the canonical plan and inserts the whole batch, preventing concurrent API
requests from exceeding capacity. Browser fields and stored numeric overrides
cannot increase that limit.

Over-limit accounts retain access to existing projects and can edit or delete
them. Internal migration tooling can preserve imported records above the limit;
it is not an alternate public creation path. No project is automatically deleted
and no credits are charged by quota enforcement. The
[quota regression suite](../server/test/project-quota.test.js) verifies HTTP
bypass rejection, concurrent instances, atomic failure and migration preservation
with memory and disposable PostgreSQL repositories.

## Configuration and acceptance

Subscribe the same-mode Stripe webhook destination to:

- `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
- `invoice.paid`.
- `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`.

Configure one monthly, single-quantity price per paid plan. The bounded invoice
handler supports old `subscription_details`/`price` fields and current
`parent.subscription_details`/`pricing.price_details` fields. Truncated line
lists, multiple eligible recurring lines, unknown prices, non-monthly periods,
changed owners and mismatched customers require operator reconciliation; they
do not guess a credit grant. Annual billing and prorated allowance adjustments
are not implemented. A canceled subscription using a different Stripe customer
also requires reconciliation instead of silently linking accounts.

Prices and taxes are confirmed in Stripe; a local label or a syntactically valid
price ID does not verify a configured product, funded account or paid invoice.
Review applicable tax registrations and Stripe Tax setup before live billing;
this change does not enable automatic tax or change registrations.

Before production, demonstrate test-mode checkout, delayed payment, renewal,
decline recovery, portal cancellation and retry on staging. Confirm credits
arrive from webhooks even when the user never returns to the success page.
Pre-upgrade standalone grants used event-ID keys but preserved the Checkout
session ID in ledger metadata. Before funding a pack without a completed receipt,
the handler reads at most two old grants matching that exact session. One grant
with the same owner, quantity and valid provenance becomes a completed receipt
without changing the balance. Multiple matches, changed quantities or owners,
and malformed provenance stop for reconciliation without minting more credits.
An unavailable legacy lookup also fails closed. This is a payment-specific bridge,
not a historical ledger scan, invoice backfill or cash refund.

Drain old webhook handlers before handing billing traffic to the new release:
an older binary does not use session-level receipts and can still write another
event-level grant. The bridge preserves committed historical grants; it cannot
change a simultaneously running old binary. Historical invoices remain subject
to deliberate reconciliation rather than automatic replay. None of these local
checks certify live billing.

Local regression evidence lives in `stripe-checkout.test.js`,
`stripe-webhook.test.js`, `billing-view.test.js` and `billing-postgres.test.js`
under `server/test/`. The PostgreSQL suite uses a disposable local schema, two
repository instances and reopening; mocked Stripe events do not charge cards.
