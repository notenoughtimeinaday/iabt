# Jericho Studio 1.0 private release kit

Jericho's production site is https://jericho-studio.onrender.com. This is the standalone IABT/Jericho product; Base44 is not needed by this runtime. TreEbay and IABT Lite remain separate.

This is an owner handoff with sales closed. The production account and customer-delivery checks, public AI operating limits and recurring off-device recovery remain unfinished. The owner must enter the new production account password and email verification privately. The existing staging account and records remain intact.

## Contents

- source.zip: the exact committed source identified in manifest.json. Extract into a new directory and follow README.md and STANDALONE_DEPLOYMENT.md.
- frontend/: a hash-routed build targeting the production API identified in manifest.json. Host over HTTP(S). It needs the configured API, database, private storage and email service; it is not a self-contained AI service or Windows installer.
- START-HERE.html and product.json: product scope, intended offers, quick start and unresolved release gates.
- THIRD-PARTY-NOTICES.txt: dependency notices; no additional source license or generated-content certification is implied.
- manifest.json: file sizes and SHA-256 checksums. No account exports or infrastructure credentials are included.

## Completed evidence

Application revision 9e71b33b2e283076dd8857572a58f1b4a63b69d0 passed all 563 local tests with no skips, lint, type checks and build. GitHub verification 714 passed. The environment label follows the server's billing mode. A default-off, expiring owner-only introductory Checkout window allows bounded review while public sales remain closed. It does not authorize any card charge or paid AI usage.

Credit pricing reserves an approved maximum, captures verified usage after durable delivery and atomically returns unused credits. The three preserved examples calculate to 4, 3 and 11 credits; those are examples, not fixed prices for every job. Historical quotes and settled jobs are unchanged.

Completed staging evidence is retained: useful custom app, owned-source revision and 781-word original guide; scoped app interactions and source checks; Word/PDF visual review; password recovery and invalidation; account isolation; five support-address deliveries; 18-table database restore; and 130 objects restored with matching hashes. Stripe test acceptance covers the $4.99 introduction, $12 renewal, effective cancellation, retained credits/files and duplicate-event protection. Do not repeat those workflows merely to refresh this package.

## Production installed

The single approved Render API is jericho-production-api (srv-db9063vf3r2c73fkvhv0), with the jericho-studio static frontend (srv-db906dc9v7es73e3emjg). The API costs the approved $7/month base plus applicable taxes and metered costs. Billing has started. Existing Neon usage and AI usage remain separate; this is not a total operating-cost cap. Auto-deploy is off and the deployed revision is checked during build and start.

The separate jericho_live_v1 database has nine migrations and three immutable monthly price contracts. The separate private bucket preserves live/test isolation. The restricted live Stripe key, dedicated webhook and customer portal are installed with exact production URLs. Live account/price/coupon reads passed through the actual restricted key. Initial database/storage/email readiness passed; unsigned payment notifications, anonymous account requests and foreign origins are rejected.

All four live products remain inactive. Subscription and top-up selectors, the private acceptance window and paid AI remain closed. No real Checkout payment has been made. Conservative OpenAI usage remains $0.5156508 of the previously approved $9.90 balance; this release added no paid AI call or funds.

## Remaining launch work

1. Complete the owner production account and verify the authenticated file-to-delivery workflow on the deployed production services. Reuse existing paid-AI output evidence rather than regenerating the same examples.
2. Complete non-charging live Checkout/configuration review. Do not charge the owner's card as a test: Stripe's testing guidance prohibits testing in live mode with real payment details. Retain the completed test-mode purchase, renewal and cancellation evidence. A genuine later customer purchase has its own fulfillment record; configuration readiness must not be described as observed revenue.
3. Agree and enforce the public AI operating budget before enabling paid creation. The prior private-testing balance does not authorize unbounded public operating spend.
4. Establish recurring off-device recovery and support ownership. The current external-drive recovery copy is not an independent second-device backup. Review applicable tax/commercial obligations before public offers are activated.
5. Activate the verified product, credit and AI settings only after their corresponding gates pass. Do not merge main, change production DNS or overwrite old accounts as part of this kit.

Stripe testing guidance: https://docs.stripe.com/testing . Current deployment IDs, source revisions and local acceptance receipts are in E:/Jericho-Master/evidence/product-release-20261015. START-HERE.md in E:/Jericho-Master is the continuation entry point. Credentials are kept outside this kit and Git.
