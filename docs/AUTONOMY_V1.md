# JERICHO autonomy v1: implementation and acceptance evidence

This document describes the `jericho-autonomy-v1` implementation as reviewed on 2026-09-20. It is a completion checklist, not a declaration that the entire IABT product is complete or launched. Test results must identify their commit, environment and run; a source file, green unit test, configuration flag or curriculum statement alone is not live acceptance evidence.

## Architecture and authority

The standalone application uses Render for services, Neon/PostgreSQL for durable records, Resend for account email and GitHub for source/review, plus private S3-compatible object storage. Base44 code is retained for migration and explicitly selected legacy builds; it is not an independent-runtime dependency.

The server owns capability definitions, risk classification, approval policy, quote signatures, ownership, cost estimates, job leases and credit transitions. Browser fields, model-generated plans, uploaded instructions and learned observations cannot grant authority. Safe automatic execution applies to exact registered reversible internal routes with zero external provider cost. An IABT credit reservation may still apply and is disclosed. Paid provider calls and consequential external actions remain approval-gated.

The Responses worker has registered tools for planning a dependency graph, inspecting approved text files, generating document formats and packaging source. Graph validation limits nodes, depth and per-node attempts, preserves attempted evidence and enforces dependency readiness. It does not expose shell, SQL, arbitrary network, account, GitHub push or deployment tools.

Learning is retrieval of a versioned code-reviewed curriculum and typed account evidence. It does not update model weights or rewrite the running codebase. Lessons and improvement proposals preserve sources, completed investigation and outstanding acceptance checkpoints so later work can continue without presenting an unverified inference as a learned fact.

## Completion and evidence matrix

“Implemented” below describes the checked-in branch. “Regression evidence” names executable suites, not an assertion that every named suite has passed on every environment. The full verification log for the release must supply the actual results.

| Area | Implemented on this branch | Regression evidence | Still required for completion or launch |
|---|---|---|---|
| Independent runtime | Standalone frontend/API/worker, owner-scoped records, PostgreSQL migrations and private storage; no Base44 AI fallback | Frontend verification; `routing`, `standalone-client`, `migrations`, `standalone-workflows` tests | Reconcile migrated users, projects, files, jobs and credit balances; confirm production dependencies and rollback |
| Account access and recovery | Verified email/password sessions, reset flow, throttling, policy acceptance and existing-admin operator recovery preserving identity | `auth`, `email`, `policy-acceptance`, `durable-autonomy` tests; PostgreSQL variants when configured; live Resend domain verification and reset email acceptance on 2026-09-20 | Prove real inbox delivery, code redemption, sign-in and recovery with the intended account |
| Capability and approval policy | Server registry separates configured/observed/unknown; exact internal routes can auto-run; signed plans bind route, arguments and costs | `autonomy-policy`, existing creation/media/approval suites | Live adapter health and commercial setup evidence; verify the deployed UI and API preserve these gates |
| Duplicate-work and credit protection | Stable plan/job identity, transactional reservation, owner checks and lease-guarded checkpoints | `autonomy-policy`, `durable-autonomy`, `operations`, `postgres-workflows` | Multi-process staging acceptance and real migration ledger reconciliation |
| Responses orchestration | Background requests, saved response IDs, strict function tools, bounded turns/polls/tokens, approved budget snapshot and labeled fallback | `orchestration` with mocked Responses transport | Explicitly authorized live provider run, observed usage/cost, account limits and provider response acceptance |
| Dependency graphs | Up to 16 nodes, depth 8, three attempts per node; ready-node binding; immutable attempted evidence and result hashes | `execution-graph`; orchestration dependency/restart cases | Validate useful multi-step objectives in staging; no arbitrary source execution is implemented |
| Durable recovery | Checkpoint-before-submission, restartable polling/tools, bounded retries, saved provider results and no automatic repeat of ambiguous paid POSTs | `orchestration`, `worker-recovery`, `durable-autonomy` | Restart and outage exercises on the deployed worker/database; reconcile any actual uncertain provider outcome |
| Artifact delivery | Deterministic object identity, size/hash readback before capture, manifests and owner-controlled signed downloads | `operations`, `source-review`, `orchestration`, export and creation suites | Live storage retrieval after restart, backup/restore, visual review and end-user acceptance |
| File-first Studio | Durable upload IDs, persisted conversation references, private text/code inspection and line-referenced document artifacts | `source-review`, `verify:files`, frontend tests | Live browser upload/reload/download journey; PDF/Office/archive/media understanding is not implemented |
| Learning and teamwork | Versioned curriculum, terminal job observations, correction candidates, explicit owner acceptance, withdrawal and proposal checkpoints | `learning`, `learning-http`, `learning-postgres`; orchestration context cases | Demonstrate corrections improving subsequent real work; automated repository repair and deployment remain unimplemented |
| Generated software | Known internal templates/scaffolds and model-written private source ZIPs with format checks and limitations | Creation/export/specialized suites; source tool validation | Isolated dependency install, build/test execution, security/functionality verification, repair and acceptance of arbitrary generated projects |
| Billing and monetization | Existing server-derived Stripe checkout/portal, signed idempotent webhooks, entitlement and credit logic; test/live separation | `stripe-checkout`, `stripe-webhook`, account/credit suites | Real Stripe test journey through payment, entitlement, delivery, cancellation and refund; commercial/operational approval before live billing |
| Exchange and integrations | Existing owner-scoped profiles, matching, mutual introductions, rooms and integration records | `exchange`, `integrations`, `postgres-workflows` | Deployed two-account/privacy acceptance; connection records do not establish live external-action tools |
| Production operations | Health endpoints, non-mutating smoke checks, migration safeguards and backup/restore tooling | `staging-smoke`, `migrations`; runbook commands | Always-on worker plan if required, alerting, restore/retrieval exercise, staged release and rollback evidence |

## Verification contract

Run the complete existing suite from the repository root:

```sh
npm ci
npm ci --prefix server
npm run verify
```

Provide a valid `VITE_IABT_API_URL` build origin. Set `IABT_AUTH_TEST_DATABASE_URL` to a disposable local PostgreSQL test database for database-backed suites. The CI workflow supplies PostgreSQL 16 and the test connection string. Never point these mutation tests at a Neon production database. A run without the configured database cannot claim PostgreSQL coverage merely because its remaining tests passed.

Important targeted suites live under `server/test/`:

- `orchestration.test.js`: Responses background/tool continuations, explicit approval and operator budget gates, ambiguous POST recovery, safe GET retry, unchanged approved budgets, artifact readback, account/path controls, DAG ordering and restart identity.
- `execution-graph.test.js`: cycles, missing dependencies, unknown tools, injected statuses/authority, depth/node bounds, bounded retries and immutable evidence.
- `durable-autonomy.test.js`: concurrent identities/reservations, checkpoint lease ownership, evidence persistence and existing-owner recovery; memory and PostgreSQL variants.
- `learning.test.js`, `learning-http.test.js`, `learning-postgres.test.js`: owner isolation, typed correction provenance, transaction deduplication, withdrawal, resolution evidence and learning failures that cannot retry committed work.
- `source-review.test.js`: HTTP upload/conversation/worker/download, content-only markers, source integrity, limits, owner isolation, fresh storage reads and expiring link renewal.

Paid OpenAI/image/audio/video tests use mocked provider transports. They prove local request/response, authorization and recovery contracts, not a live provider account, funding, billing limit or successful production result. S3 transport doubles and local storage do not establish live storage recovery. The generated source is not executed as part of the orchestration tools.

## Configured limits and current scope

`staging.env.example` keeps orchestration and paid-provider gates disabled. Responses orchestration additionally requires operator budget acceptance, positive per-response and per-run estimates, and the user's accepted quote. Defaults cap a run at eight model turns, 120 polls and 6,000 output tokens per response. Graph execution has its own node and attempt bounds.

Supplier cents are conservative operator estimates; they are **not a provider-enforced dollar ceiling**. Increasing server configuration cannot expand the budget snapshot of an already-approved job. Validate actual provider usage and account spending controls before enabling live calls.

Normal file-attached creation currently routes only to deterministic text source review. The inspection tool is owner/hash checked, but planner availability does not imply support for binary formats or every creation intent. Unsupported files and intents fail explicitly. Internal generators may produce templates or scaffolds; those are not certified arbitrary applications.

Artifacts may be delivered after partial orchestration or an internal fallback. Their public status and metadata retain the limitation. A succeeded job and captured credit prove the applicable durable-delivery transition, not fulfillment of every requested requirement. User acceptance and functional testing remain separate evidence.

The learning service records account evidence and static instructions, with no model training or cross-account knowledge pooling. Initial model context is limited to eight relevant typed lessons and compact references. User corrections do not silently become system instructions. Same-email guidance never merges or links independently verified accounts.

## Staging acceptance gate

Do not merge for a production cutover, change DNS, enable live billing or activate paid provider spend merely because this branch passes local checks. Record staging acceptance against the exact reviewed commit:

1. Complete the full suite with PostgreSQL coverage and no unresolved required check.
2. Resolve the last observed Resend 403, then receive and redeem real verification/reset codes and sign in to the intended existing account.
3. Complete upload → request → reserved credit → verified artifact → renewed download → reopened conversation, including another-account denial and a failure/recovery case.
4. Exercise worker restart, saved Responses polling/tool state, lease loss and storage recovery without duplicate reservation or paid submission. Live paid execution requires its explicit quote and budget authorization.
5. Complete Stripe test checkout, webhook replay, entitlement, delivery, cancellation, failed-payment and refund/credit-restoration scenarios.
6. Reconcile the migration counts and balances; restore a disposable database backup and retrieve the associated private files. A database backup alone does not preserve object bytes.
7. Complete the repeated successful creation runs, logs/alert review, hosting availability and rollback requirements in `STANDALONE_DEPLOYMENT.md`.
8. Review the remaining functional/security/visual gaps for each launch claim. Keep unresolved claims out of the release's supported feature promise.

The current free Render API's idle suspension is a known availability constraint for its embedded worker. A configuration-only health result does not resolve that constraint or establish email delivery. Provider acceptance and inbox delivery are separate acceptance steps.

On 2026-09-20, the configured sender domain was missing its Resend DKIM and two return-path DNS records. The owner explicitly approved those three email-only additions. GoDaddy saved them, authoritative DNS returned the expected values, and Resend marked the domain Verified. A reset request to the owner through the deployed IABT form succeeded; `/readyz` then reported `provider_acceptance_observed`. Inbox delivery, code redemption and sign-in are awaiting the owner's completion. Website routing and Google inbox records were not changed. This infrastructure repair applies to the existing deployed release, not deployment of this branch.

The local browser acceptance check used a disposable PostgreSQL account: sign-in, greeting without a job/charge, source attachment, automatic three-format source review, one-credit capture, reopened conversation/files, persisted delivery lesson, correction and improvement proposal all succeeded. This is local evidence, separate from the required deployed staging journey.

## Remaining engineering work

The full self-sufficient vision still needs isolated generated-code execution and repair, broader file understanding, richer artifact validation, narrowly authorized repository/infrastructure tools, and a verified path from an improvement proposal through regression tests and staging. Learning records provide continuity and evidence for that work; they do not claim those capabilities already exist.

Keep each new capability paired with its regression tests, curriculum update, explicit limitations and acceptance evidence. Preserve existing objectives, completed artifacts and unresolved checkpoints when resuming work. This is the mechanism for developer–JERICHO teamwork without repeating prior work or mistaking recorded history for current proof.
