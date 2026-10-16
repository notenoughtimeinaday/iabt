# Staging payment and delivery acceptance: September 20–22, 2026

Includes the explicitly dated September 23 follow-up observations below.

This records observed Stripe **test-mode** payments, signed webhook processing,
Neon records and a private Studio job. It is partial staging acceptance, not a
production launch approval. No live payment or production cutover is certified.
See the [billing acceptance matrix](BILLING_ACCEPTANCE.md) for the remaining work.

The evidence was checked through the actual browser UI, Stripe/provider tools
and read-only Neon inspection. Identifiers below are correlation references;
credentials, signed URLs, card fields, account emails and operator identities
are intentionally omitted. The staging API shares the primary Neon database:
test-mode payments still change the selected app account's credits and plan.

## Versions and environment

| Checkpoint | Recorded version or result |
| --- | --- |
| September 20 subscription Checkout | API `ce2b50e`; frontend `ee4d8d34539d60d7d5980aad9bb9d4e3740150c1` |
| September 22 polling repair and delivery | `7ebc9c1d6e722445a1d16b907a1e62fe3e2a96d9` |
| Full verification for that repair | 338 checks passed; [GitHub Actions run 35814190374](https://github.com/notenoughtimeinaday/iabt/actions/runs/35814190374) succeeded |
| Render API deployment | `dep-dapkdvvlk1mc73bu2ej0`, Live at `7ebc9c1d6e722445a1d16b907a1e62fe3e2a96d9` |
| Render frontend deployment | `dep-dapkehe7bikc73fqhr10`, Live at the same commit |
| Independent frontend | `https://iabt-staging-web.onrender.com` |
| Independent API | `https://iabt-api-insured-spending.onrender.com` |

The Studio repair stopped overlapping attachment polls from preventing creation.
Later download-handoff and cancellation-projection repairs are follow-up work;
their local results must not be attributed to the deployed commit above.

## September 20: hosted subscription payment

An initial payment attempt using Stripe's public generic-decline test scenario
displayed a decline in hosted Checkout. It issued no credit grant: the balance
remained **10**. Retrying the same Checkout with Stripe's successful test scenario
completed payment. Provider inspection reported `status=complete`,
`payment_status=paid`, `livemode=false`, and an amount of **2,900 minor units**.

| Object | Identifier |
| --- | --- |
| Checkout Session | `cs_test_b1RJyeM0GX7k6c5w79feieEX7pdZrLcUqiS1URFOmqFhNQfyT11PQG0R6g` |
| Customer | `cus_VIQtpaCcaMZQE3` |
| Subscription | `sub_1UHqCIJQwCRZm16s79QaUadU` |
| Initial invoice | `in_1UHqCGJQwCRZm16sfQsjdjmQ` |
| Paid-invoice event | `evt_1UHqCJJQwCRZm16shcFAAGhW` |

The signed invoice event produced **one 100-credit Builder allowance**, taking
the balance from **10 to 110**. This proves the observed initial decline,
successful hosted card payment and initial allowance. It does not prove renewal,
renewal decline/recovery, or fulfillment when the return page is never visited.

## September 22: hosted credit pack and replay

The hosted credit-pack payment completed with `status=complete`,
`payment_status=paid`, `livemode=false`, and an amount of **1,000 minor units**.
One **100-credit** grant took the balance from **110 to 210**.

| Object | Identifier |
| --- | --- |
| Checkout Session | `cs_test_a13Tvki6Ofy7KoVXotzxJAz6dcdjjEf8wWNAgQCVT7qBedoah0wRVk793f` |
| PaymentIntent | `pi_3UIgoTJQwCRZm16s0vBUu7Ob` |
| Checkout completion event | `evt_1UIgoVJQwCRZm16sZv8m8CiR` |

At **2026-09-22 22:29:47 CDT**, a manual Dashboard resend of the initial
`invoice.paid` event to the Render destination returned HTTP **200**, with:

```json
{"received":true,"reused":true,"type":"invoice.paid","action":"succeeded"}
```

Neon inspection still showed exactly **three grant entries**: the starter grant,
the subscription allowance and the pack purchase. Replay added no credits.
At **2026-09-23 00:12 CDT**, manual resend of pack completion event
`evt_1UIgoVJQwCRZm16sZv8m8CiR` also returned HTTP **200**. The app still displayed
**209 credits** after reload, following the one-credit job described below.
The earlier three-grant ledger inspection was not repeated for this pack resend;
its application observation is the unchanged reloaded balance.

These are actual same-event replay observations. Concurrent different-event delivery,
an interrupted hosted fulfillment and asynchronous pack settlement remain open.

The user-approved restricted test key was installed with three configured
permission scopes. No key material is retained here. The legacy Base44 **test**
webhook `we_1UDZ4XJQwCRZm16sA7P7M9O4` was disabled; the independent Render
destination `we_1UEQKMJQwCRZm16sgGOHd8Lp` remained active. These observations do
not establish the state of live-mode destinations or authorize changing them.

## September 22: scheduled cancellation and projection defect

The customer portal displayed cancellation scheduled for **October 20, 2026**.
The subscription update event `evt_1UIgs3JQwCRZm16sKbTAUTe0` was recorded as
succeeded in Neon. A subsequent provider read showed:

| Provider field | Observed value |
| --- | --- |
| Subscription status | `active` |
| `cancel_at_period_end` | `false` |
| `cancel_at` | `1792523684` |
| Item `current_period_start` | `1789931684` |
| Item `current_period_end` | `1792523684` |
| Subscription item | `si_VIR4GvHJ6GH5BS` |

The top-level period-end field was absent. The cancellation timestamp exactly
matched the item period end, consistent with the portal's scheduled date.
The deployed app retained active Builder access, but stored
`cancel_at_period_end=false` because it copied only that provider boolean.
The provider schedule is verified; the app's cancellation display was incomplete.

A follow-up server projection repair persists `cancel_at` and
`cancellation_scheduled`, retains the original provider boolean, and treats an
exact item-period-boundary timestamp as period-end cancellation for existing
clients. Custom dates remain distinct. Its regression tests also cover
resumption and effective cancellation without changing the credit balance.
This local repair still requires deployment and a fresh provider reconciliation;
resending the already-succeeded event alone does not reprocess its entitlement.

The future cancellation has **not** taken effect in this acceptance window.
Effective downgrade, immediate cancellation and later sign-in/access checks
remain unverified. Cancellation is not a cash refund.

## September 22: funded private Studio execution

Job `8fa6e21e-7335-42f1-8c4d-24ac6b65b3fd` succeeded in **one attempt** and recorded
three verified formats from a **236-byte** source. The source verification
marker was `IABT-MAINTENANCE-20260920`.

The job ledger contained exactly **one 1-credit reservation and one 1-credit
capture**. Available credits moved from **210 to 209**, with **0 reserved** at
completion. The recorded artifact manifest was:

| Format | Private file ID | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Markdown | `a40d8abc-8e9f-5ebd-a423-81a1a05dbfbf` | 2,111 | `81944ac8eb540cb8e95025c8b9987b1471d218e8c833b8651a82fb6668619f26` |
| DOCX | `39229565-51a7-5d47-a61a-b3d53aed9200` | 9,704 | `1b02cd513c28a0c376315b6563a3ff15721a04e97884fbe69f499d66cdc363de` |
| PDF | `76233b96-0cdb-5b58-acf5-e8ff7944d270` | 4,064 | `4477a2276ac8ce41ff36ebb69b3a8d8a01d89d4799734a523fedf7f791b90fb0` |

**Browser download acceptance did not pass.** The browser obtained HTTP 200 from
the authenticated access request, but the asynchronous `target=_blank` handoff
did not start the expected file request or download. A follow-up repair passed
its local browser regression: delayed private access then a same-tab attachment
download, including a second fresh-link download. It still requires a hosted
rerun. The manifest's verification status and hashes do not establish that
the user downloaded, opened or visually accepted these hosted outputs.

Separate local evidence covers **11 PostgreSQL delivery/recovery groups** and
visual inspection of **two PDF and two DOCX outputs**. Those checks used local
fixtures; they are not a substitute for downloading and opening the three
hosted files above. Hosted cross-account denial, restart/retrieval, terminal
failure release and final visual/content acceptance remain separate checks.

Jericho automatically recorded an `artifact_delivery` lesson linked to this job
and its three files, explicitly leaving functional correctness unestablished.
The actual download failure was recorded through the normal Studio correction
workflow as `unreadable_artifact`. That correction is evidence of the observed
problem, not a verified resolution; keep it open until repaired delivery is
accepted through the normal workflow.

## Remaining release gates

- Repair and rerun the actual browser download flow; inspect hosted contents and
  rendered documents, then verify retrieval and owner isolation.
- Deploy and verify the cancellation projection, then exercise effective
  period-end cancellation and immediate cancellation separately.
- Exercise a genuine monthly renewal, recurring-payment decline and recovery,
  delayed pack settlement, and concurrent first-time hosted Checkouts.
- Complete isolated hosted interruption/recovery checks without interrupting
  the shared primary service or changing database records directly.
- Define and implement refund reconciliation before claiming refund support.
  Refund/dispute processing is still unsupported; an acknowledged event or a
  failed-job IABT credit release does not prove a cash refund.
- Preserve the other staging gates in the [deployment runbook](../STANDALONE_DEPLOYMENT.md),
  including account access, recovery, migration/reconciliation and operational
  readiness. This payment record does not complete them.

Render remains on the existing **free hosting** arrangement. An idle-suspended
web service cannot guarantee uninterrupted embedded-worker or maintenance
execution. No paid hosting upgrade, production DNS change, merge into `main`,
or production cutover follows from this record. Keep the independent
Render + Neon + Resend + GitHub stack and the staging gate in place.
