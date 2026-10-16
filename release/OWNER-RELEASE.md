# Jericho Studio 1.0 private release kit

Open START-HERE.html for the product presentation, intended prices and quick start. This is the standalone Jericho product. IABT Lite / Italy is separate; TreEbay and unmerged MCP candidates remain outside this kit. Base44 is not needed by this runtime.

This is an owner review and engineering handoff, not approval to sell. Running Jericho requires its API/worker, PostgreSQL, private storage and email provider. The frontend is not a self-contained AI service or Windows installer.

## Contents

- source.zip: exact source revision shown in manifest.json. Extract into a new folder, install both lockfiles with npm ci and npm ci --prefix server, then follow README.md and STANDALONE_DEPLOYMENT.md.
- frontend/: compiled hash-routed preview targeting the isolated staging API. Host over HTTP(S). Rebuild before selecting a different API origin.
- product.json: product scope, intended offers and explicit release gates.
- THIRD-PARTY-NOTICES.txt: dependency metadata and available license text; not a new grant of source rights or a certification of generated content.
- manifest.json: source revision, file sizes and SHA-256 checksums. No account backups, credentials or environment secrets belong in this package.

## Verified application, October 16 UTC

Application commit 9044626485e3f2892752fc295f21e02676d49ea7 is live on both isolated staging services. All 559 tests, lint, typecheck and build passed; CI 712 succeeded. Later package-documentation changes do not claim an additional deployed application revision.

Credit pricing now uses a signed, versioned Terra usage policy. A new quote reserves the approved maximum; after verified durable delivery, completion captures the calculated usage charge and returns the unused reservation atomically. Invalid or incomplete usage returns the reservation and remains an operator reconciliation issue. Existing settled jobs and old quotes retain their terms. Recorded usage for the three completed examples computes 4, 3 and 11 credits instead of the earlier fixed 54. These are examples, not promises that every future job costs the same. Both repository adapters and worker behavior passed tests; no paid generation was repeated just to check settlement.

The preserved private app, its source-bound revision and a 781-word original guide passed scoped acceptance. App review covered add/edit, search/filter, completion, totals, validation, confirmation, JSON round trip and reload. Original Markdown, Word and PDF hashes are retained; Word and PDF received visual review. A separate reviewed copy corrects one helper-text contrast rule. These results apply to the exact reviewed files, not every application Jericho might generate.

Password recovery and session invalidation, account isolation, all five published support-address deliveries, an 18-table database restore and all 130 current private objects' hash-verified backup/restore are complete. Do not recreate the accounts, resend those emails or repeat accepted purchases and generation jobs. The existing Stripe test acceptance covers the $4.99 first month, $12 renewal, cancellation to Free, retained credits/files and duplicate-event protection.

Conservative cumulative OpenAI usage is $0.5156508 of the approved $9.90 existing balance. No top-up or new paid generation was made by the pricing repair. Paid AI and orchestration are off. The OpenAI budget is not approval for a new hosting subscription or real card purchase.

## Prepared live environment

The live Stripe account has charges and payouts enabled with no outstanding requirements. Matching live products/prices and the Starter-only $7.01 first-month discount exist, but all four products remain inactive. No real Checkout or card charge was submitted. The browser form for a restricted live billing key is prepared and awaits the owner's action-time approval.

A new empty database, jericho_live_v1, on the existing production Neon compute has nine migrations, an immutable live environment binding and the three monthly price contracts. A separate private bucket passed upload, exact-byte readback and anonymous-access denial. No new compute/project/branch was created. The old production-named database contains test credits/events and remains intact; never switch it into live billing. Credentials are stored privately outside Git and this kit.

Render's October 16 pricing page lists $7/month for its 0.5c-512mb service. That is a proposed always-on compute cost, not a purchased plan or a complete operating-cost cap. Bandwidth/build overages, taxes, existing Neon usage and AI usage are separate. The existing Neon compute maxima remain 0.25 CU; a size limit does not cap total metered spending. No additional hosting subscription was activated by this kit. Pricing source: https://render.com/pricing .

## Remaining launch sequence

1. Obtain approval for the prepared restricted live Stripe key, create it and store it privately in the production service. Never publish its value.
2. Prepare the production API/frontend with the new live-only database, private storage, account email, origin restrictions and locked application revision. Keep live offers and paid AI disabled until acceptance. Confirm an approved always-on hosting budget before purchasing it.
3. Configure the dedicated live webhook and customer portal, verify live price/discount/renewal terms through the actual restricted key, then finish production checkout, fulfillment and customer delivery acceptance. A real payment requires its own specific authorization; the OpenAI allowance cannot fund it.
4. Establish recurring off-device backups and production recovery ownership. Retain existing restore receipts; provider retention is not an independent backup. Assign support Inbox and Spam review. Complete the applicable tax and commercial release review.
5. Only after these gates pass, activate the verified live products, offers and paid creation with an agreed operating budget, then announce sales. Do not merge main, change production DNS or overwrite old user data as part of this private kit.

Full local receipts are under E:/Jericho-Master/evidence/product-release-20261015. Start with credit-pricing-release-20261016.json and the production preparation receipts. The source status file distinguishes earlier checkpoints. This release deliberately leaves commercial gates closed instead of claiming test acceptance proves a public launch.
