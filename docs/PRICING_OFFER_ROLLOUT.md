# Gated Jericho offer candidate — October 6, 2026

This implements a disabled, test-only candidate. The owner's authorization to
complete affordable monetization covers the staging offer, introductory policy
and disclosure below. It creates no Stripe products/prices/coupons and changes
no service configuration by itself. Production launch, legal/tax acceptance,
live charges and production merges remain separate release gates.

## Purchased terms and future offers

| Offer | Price | Credits per successful monthly payment |
| --- | --- | --- |
| Meet Jericho | USD 4.99 first monthly period, then Starter USD 12/month | 100 |
| Starter | USD 12/month | 100 |
| Builder, new version | USD 29/month | 300 |
| Pro, new version | USD 59/month | 650 |
| Existing credit pack | USD 10, one-time | 100 per purchase |

Legacy Builder/Pro/Agency prices retain their original 100/500/2000 allowances,
original Stripe prices and existing capabilities. No subscription is migrated.
Free starter credits and existing available/reserved credits are not reset or
replaced by a new payment. Agency remains a recognized legacy entitlement.

`PLAN_DEFAULTS` retains the existing tier capabilities. Every new paid offer,
including Meet Jericho, Starter and new Builder, includes commercial-use rights
subject to the applicable supplier terms and law. The verified purchased
`jericho-2026-10-v1` price contract selects these rights; legacy Builder remains
unchanged. Starter has one project, five hourly AI requests, HTML/static ZIP
export and one seat. React exports, capacity, seats and white-label differences
retain their existing tier boundaries. Customer acceptance snapshots, sale
cards and signed subscription fulfillment use the same versioned rights.
Cancellation restores Free capabilities while retaining purchased credits.

Migration 009 expands the price-contract tier constraint without changing
migration 008 or any existing row/hash. The original five-field contract hash
and legacy price mappings are preserved. Introductory claims and acceptance
records use the existing transactional record store and are excluded from
generic entity APIs.

## Activation remains disabled

All of these names are new server configuration, never frontend secrets:

| Setting | Default / requirement |
| --- | --- |
| `IABT_NEW_OFFERS_ENABLED` | `false` |
| `IABT_MEET_JERICHO_ENABLED` | `false` |
| `IABT_NEW_OFFER_TERMS_VERSION` | Empty; explicit future acceptance must match `jericho-2026-10-review-1` |
| `IABT_STRIPE_ACCOUNT_ID` | Empty; exact intended standalone Stripe account, separately authorized |
| `IABT_STRIPE_STARTER_PRICE_ID` | Empty; new monthly USD 1200 price |
| `IABT_STRIPE_BUILDER_V2_PRICE_ID` | Empty; new monthly USD 2900 price |
| `IABT_STRIPE_PRO_V2_PRICE_ID` | Empty; new monthly USD 5900 price |
| `IABT_MEET_JERICHO_COUPON_ID` | Empty; USD 701 off, once, restricted exclusively to the new Starter product |

`IABT_STRIPE_MODE` must be `test`; this candidate refuses new-offer activation
in live mode even when every switch is set. Existing legacy live behavior is not
changed. Customer acceptance is separate: every new offer request must include
the current disclosure version and affirmative acceptance.

Keep existing `STRIPE_BUILDER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`,
`STRIPE_AGENCY_PRICE_ID`, `STRIPE_AI_CREDIT_PACK_PRICE_ID`, pack size, keys,
webhook, app marker and database binding unchanged. Append the three future
price definitions to `IABT_STRIPE_PRICE_CATALOG_JSON`, each with version
`jericho-2026-10-v1` and allowance 100, 300 or 650. Do not repoint legacy
`checkout` selectors. The new offer IDs select their separate prices; attempting
to purchase this version through a legacy plan request fails closed.

Price IDs in configuration are not proof of provider terms. Before every fresh
new-offer Checkout the server uses bounded read-only requests to verify the
intended account, active test price, USD amount, licensed monthly interval and,
for Meet Jericho, the exact valid once-only product-restricted coupon. Restricted
keys need read access to the account, prices and coupons in addition to the
existing permissions. No fallback changes the account or creates resources.
The coupon read explicitly expands `applies_to` because Stripe omits it by
default. New sessions fix USD and disable adaptive currency conversion; legacy
session parameters stay unchanged. Review product names, descriptions and tax
behavior separately before activation; preserve historical product copy.

The correct standalone Stripe test account was connected on October 6. Verify
it again before provider writes. Do not use the empty legacy Base44 account as
a replacement, replace staging keys, or repeat completed historical payments.

## Introductory policy and disclosure proposal

Staging policy: once per verified IABT account and linked Stripe customer, with
no previous successful paid subscription. Prior top-up-only purchases do not
disqualify an account. A canceled/current Free account is not automatically new.
Any subscription allowance receipt or unreconciled Stripe/founding entitlement
history blocks the introductory path. Missing imported history must be
reconciled before activation; absence of local receipts cannot establish a
complete history for a separately imported legacy population. Email aliases are
not merged, and this is not a one-human-per-identity anti-abuse system.

The claim is reserved atomically inside existing Checkout admission. Concurrent
requests across API instances share one session and provider idempotency key.
The exact offer, price hash, coupon, currency, first/renewal amount, disclosure
and acceptance timestamp are retained privately. Retries resume that snapshot,
including after new sales are disabled. Different offers cannot replace a
pending purchase. New-offer request fingerprints ignore JSONB object-key order;
the historical legacy fingerprint algorithm remains unchanged. Browser
cancellation, local expiry, timeouts and payment
failure do not release eligibility. Only Stripe-confirmed session expiry with
no subscription releases a reservation. The existing definite provider-request
rejection classification (400/401/403, no returned session) also releases an
unpayable reservation; transport, parse, 5xx and payment failures do not.

The initial signed paid invoice, matching the reserved attempt/price/terms,
consumes eligibility. Its normal price contract grants 100 credits exactly once;
there is no separate intro bonus. Subsequent regular paid cycles grant 100.
Failed invoices grant nothing. Refunds, cancellation and resubscription never
reset an already-redeemed claim. Customer identity conflicts require review.
Intro redemption precedes idempotent ledger fulfillment so interruption can
resume without reopening eligibility or double-granting credits.

The proposed disclosure, also sent to Stripe Checkout, is:

> Meet Jericho costs $4.99 for your first monthly billing period and includes 100 credits after successful payment. It automatically renews as Starter at $12 per month, with 100 credits after each successful monthly payment, until canceled. Cancel through Manage billing before your next renewal. Applicable taxes are shown before payment. Available once per verified account with no previous paid subscription; prior credit-pack purchases alone do not disqualify you.

The frontend presents an unchecked acceptance control and exact first/renewal
prices. Legacy purchased terms and monthly credits are shown separately from
sale cards. Pending purchases retain a resume action even when new offers are
disabled. The subscription's verified period boundary supplies the displayed
next billing date. Existing subscribers continue to use their billing portal;
no subscription/price update is submitted by this rollout.

Terms version acceptance is a release input, not legal review. Before public
sale, review the
cancellation wording, tax-inclusive versus tax-exclusive presentation, customer
support/refund terms, Starter rights, intro policy and portal behavior before
activation. This change does not enable `automatic_tax`; Stripe Tax requires
separate registration/configuration review.

## Verification and remaining acceptance

`server/test/billing-offers.test.js` covers dormant/live gates, disclosure,
provider account/price/coupon mismatch, bypass prevention, frozen concurrent
attempts, interrupted responses, disabling sales, provider expiry, intro and
renewal grants, historical eligibility, legacy allowances and Starter quota.
The persistence/concurrency scenarios run against both memory and disposable
PostgreSQL; a skipped PostgreSQL test is not database evidence. Existing checkout,
webhook, price-contract, billing-view and project-quota suites remain required.
The frontend view tests verify that advertised Builder 300 cannot relabel a
legacy Builder customer's 100-credit contract.

Run the complete `npm run verify` with a disposable local
`IABT_AUTH_TEST_DATABASE_URL` and `VITE_IABT_API_URL`. The existing GitHub Actions
workflow supplies PostgreSQL; it does not deploy. Record its exact candidate
SHA and conclusion. Local tests use mocked Stripe responses, never real
customers or payment instruments.

The earlier pricing candidate passed CI run 682 with disposable PostgreSQL;
see the exact revisions in `CURRENT_RELEASE_STATUS.md`. The subsequent
commercial-rights and refund-review changes require their own full verification.

On October 6, the local candidate was inspected interactively at 1280 by 720
and 390 by 844 using the real frontend and API with an in-memory fixture and
mocked payment readiness. Dark-theme prices, features and disclosure text were
readable. The mobile dialog stayed within the viewport with no horizontal
overflow. Meet Jericho began unchecked and disabled; checking its disclosure
enabled only that offer, and unchecking disabled it again. No Checkout was
submitted from the fixture. This is local presentation and consent-control
evidence, not a hosted purchase, provider or persistence acceptance result.

Before staging activation: verify the intended Stripe account, provision the
authorized test-only objects, verify actual provider terms/permissions and
preserve current data.
Then test actual discounted Checkout and renewal amounts, payment failure and
recovery, asynchronous completion without browser return, replay, cancellation,
resubscription, customer portal restrictions and signed fulfillment. Actual
refund reconciliation and other existing release gates remain separate. No
customer credits, subscription state or price registry rows should be edited
manually to manufacture passing evidence.

## Rollback

Disable new sales and hide their cards. Keep this compatible binary, all
registered contracts, accepted terms, existing Checkout reconciliation, signed
invoice fulfillment and customer portal access. Do not delete or rewrite rows,
archive a payable pending purchase to sidestep reconciliation, or restore a
binary that cannot recognize Starter. Already-issued Stripe sessions can still
be payable until Stripe confirms otherwise; turning off new sales does not
revoke accepted purchases. Existing invoices and renewals retain purchased terms.

## Provider references

- [Subscription coupons and once duration](https://docs.stripe.com/billing/subscriptions/coupons)
- [Coupon object and expanded product restrictions](https://docs.stripe.com/api/coupons/object)
- [Price object](https://docs.stripe.com/api/prices/object)
- [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create)


## Read-only verification diagnosis (October 9)

A generic `billing_offer_verification_failed` is not a confirmed permission
problem. The verifier checks account first, selected price second, and the
coupon only for Meet Jericho. A failed check submits no new Checkout.

The API now logs a `billing_offer_verification_failed` event with the app
request ID, a fixed endpoint template, failure category, upstream HTTP status,
validated Stripe request ID, allowlisted error type/code and constrained permission-denial classification. Provider messages,
bodies, credentials, account/price IDs and headers are excluded. The client
continues receiving the same generic 503 response. Existing account/price/coupon
checks, legacy allowances, subscription state and fulfillment are unchanged.

On a test host without Shell/SSH, temporarily set `IABT_BILLING_OFFER_PROBE` to
an existing offer ID (for example `builder-2026-10`). At process startup, the
opt-in probe reuses the verifier and emits one `billing_offer_startup_probe`
result. It performs only Stripe GETs, has no repository or Checkout executor,
is skipped unless new offers are enabled in test mode, and does not block
server startup. Remove/empty the variable after collecting evidence. Each GET
retains the existing 15-second deadline. No public diagnostic endpoint exists.

A failed account check stops before price access; therefore fixing that check
still requires re-verifying price access. HTTP 401/403 must be investigated
using the exact Stripe request log before changing keys or permissions. A
successful read-only probe verifies configured provider terms, not payment,
subscription renewal, credit delivery or full checkout acceptance.
