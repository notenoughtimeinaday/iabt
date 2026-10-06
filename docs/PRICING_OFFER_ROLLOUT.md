# Gated Jericho offer candidate — October 6, 2026

This implements a disabled, test-only candidate. It does not accept the proposed
introductory eligibility, Starter feature rights, renewal disclosure or public
launch. It creates no Stripe products/prices/coupons, changes no service
configuration, and does not authorize a deployment, production merge or charge.

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

`PLAN_DEFAULTS` retains the existing tier capabilities. Proposed Starter has one
project, five hourly AI requests, HTML/static ZIP export, one seat, and no React,
commercial-use or white-label entitlement. New Builder and Pro retain their
existing tier capabilities; only their purchased price/allowance changes.
These Starter rights need acceptance before sale. No paid plan can be advertised
as allowing commercial use beyond its actual entitlement.

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

The October 6 release record identifies a Stripe connector account-access gate.
Do not use the empty legacy Base44 account as a replacement, replace staging
keys, or repeat the completed historical payment tests.

## Introductory policy and disclosure proposal

Proposed policy: once per verified IABT account and linked Stripe customer, with
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
pending purchase. Browser cancellation, local expiry, timeouts and payment
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

Terms version acceptance is a release input, not legal review. Review the
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

Local lint, type checking, available regression tests and the production build
passed on October 6. Database tests were skipped locally because no disposable
PostgreSQL service was available; CI must establish that evidence. A browser
download failed in this workspace, so interactive desktop/mobile verification
remains pending rather than being counted as passed.

Before any future staging activation: accept the product/disclosure proposal,
verify the intended Stripe account, provision separately authorized test-only
objects, verify actual provider terms/permissions and preserve current data.
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
