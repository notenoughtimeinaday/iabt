# Custom-app continuation - November 2, 2026

## Latest checkpoint - supersedes the historical blocker notes below

After explicit approval, the single 44-credit operator allowance was recorded
once with non-Stripe provenance. Initial execution stopped on private-scope
authorization before any provider submission: turn 0, spend estimate 0, no
response ID, calls, usage or artifacts, with all reserved credits restored.
The current instance subsequently passed the exact authorization check. Timing
is consistent with an old embedded worker during Render's documented 60-second
drain interval. Do not repeat the allowance or an uncertain provider request.

The recovery candidate validates one deterministic replacement for a proven
unsubmitted authorization failure, with identical input, approval and credit
amount under the same admitted plan. Its operator-only PostgreSQL library
commits reservation, job and plan projection atomically, retaining the original
failed job and reserve/release receipts. Concurrent calls deduplicate; changed,
paid, uncertain and chained recoveries fail closed. Full local verification
passes 585 reported tests with no failures/skips plus lint, types and build.
CI/staging/rollout and the single authorized generation remain separate gates.

The live business account is now registered and email-verified. Its quote-only
garden-equipment request is retained in Studio, with no credits reserved or
provider contacted: production rejected it with paid_creation_purchase_required.
The concept upgrade was published through the connected GitHub app at c75820b;
ordinary Git push lacked repository permission. The existing draft PR is #4.

A subsequent local candidate adds an explicitly enabled private live-owner
window: one verified owner, one admitted plan, expiry within 24 hours, existing
quote/credit/job/POST checks, no credit grant or role change. Its configuration
requires IABT_AI_ACCEPTANCE_ONLY and IABT_AI_ACCEPTANCE_LIVE_OWNER_ENABLED.
An empty plan list allows a quote but no execution. It preserves ordinary
purchase requirements for all other accounts and default configurations.
Full local verification of this candidate passes 581 reported tests with no
failures or skips, plus lint, types and build. CI, staging and explicit operator
activation remain separate. CI now also runs on pushes to the canonical
jericho-autonomy-v1 branch: existing PR #4 has merge conflicts with its old base,
which prevents pull-request CI from running. No merge into main is performed.
The selected owner has 10 starter credits;
Terra's current maximum reservation is 54. Any additional operator allowance
must be explicitly authorized with truthful non-Stripe provenance. Do not
change roles, fabricate payments or disable the purchase guard globally.

The owner saved the key privately, first as a Secret File and then as an
environment variable named OPEN_API_KEY. The agent corrected only that variable
name to OPENAI_API_KEY while preserving its masked value. Deploy
`dep-dbkb4eegekts73f9cdag` went live November 2 at 15:54:56 UTC on the unchanged
verified source `dcb59fd4f97ba8de4131e6f3abbaa915717560a8`. Authenticated
production capability discovery now reports `openai_responses.configured=true`.
Only connectivity_not_verified remains. No live provider result or app delivery
is established. The earlier same-source deployment dep-dbkb0tdg1s2s739r76ug
preceded the spelling correction and did not fix the key. A quote before that
correction returned HTTP 409 app_creation_unavailable, with no generation/charge.

Existing AI/model/budget settings were already enabled (gpt-5.6-terra, 20-cent
response estimate, 160-cent job estimate). Public offer switches remain false;
normal-account purchase verification remains enabled. No account role, credit
policy or public gate was changed. The separate secret file remains intact.

An explicit ref fetch found the newer personal workbench and Android work at
`f0a9264` on jericho-autonomy-v1. The old checkout's fetch refspec tracked only
the historical uploaded-file branch; fetch the actual branch explicitly.
Those newer records identify personal app building as the goal, rather than
subscription sales. The concept change was reconciled on that source as
`daa84b5`, preserving both curriculum additions and original line endings.
Full verification there passed **578 reported tests, zero failures/skips**,
lint, types and build with a fresh disposable local PostgreSQL database.
Responses were mocked; no hosted quality acceptance is implied.

The owner chose the business email for future creation. Read-only database
checks found its account in the older database, but not in separate live
production. A registration form was prepared for private owner password entry
and email verification. Confirm that workflow before proceeding. Preserve both
Gmail and older business accounts; do not merge identities by email text.

Next: confirm the live business account, inspect its credit/purchase eligibility,
obtain CI and isolated staging acceptance for the reconciled candidate, then
run one distinct authorized app acceptance job. Keep the provider work within
the accepted quote and existing spending authority. Do not globally disable
purchase guards, change account roles, fabricate Stripe payment provenance or
make a real-card test charge. A configured key does not close app acceptance.

## Historical observations before the repair

## Confirmed production blocker

Authenticated, read-only production capability discovery reported
`openai_key_missing`, `orchestration_budget_not_enabled`, and
`connectivity_not_verified`. `openai_responses.configured` was false; the
per-plan operator estimate was 160 cents. This does not identify every disabled
switch or establish a funded provider account. No new quote, job, provider
request, credit reservation, purchase, email or deployment was initiated.

Render still reports production API deploy `dep-dbcthbom7kps73ct2h0g` on
`dcb59fd4f97ba8de4131e6f3abbaa915717560a8`. The local baseline `57f3e6f`
differs from that source only in line endings. Preserve canonical recovery
branch history and the newer separate browser-companion work.

The owner confirmed Render workspace `tea-dahno64s728c73cqlhg0`, My Workspace.
The connector can read service/deployment information but cannot list existing
environment variables. Dashboard inspection reached Render/GitHub sign-in;
private owner sign-in and secret configuration remain necessary. Never request
an API key in chat or copy staging secrets into production as an assumption.

## Local candidate: concept brief in the existing app call

New signed custom app/website plans bind `concept_brief_v1`. Their existing
`create_web_app` call requires a bounded concept before HTML: purpose, intended
users, workflows with interactions and resulting states, observable manual
acceptance checks and edge cases, data rules, assumptions and limitations.
The ZIP adds `DESIGN.json` with the original objective, proposed design,
revision provenance when applicable, delivered HTML SHA-256 and explicit
untested/semantic-unverified status. Artifact metadata binds its checksum.

This adds no tool, provider request, export workflow, spending allowance or
execution permission. Rejected inputs use the existing graph's repair budget.
Existing signed quotes, checkpointed jobs, starter examples and saved outputs
retain their earlier schema and require no regeneration. The curriculum teaches
the change without retaining raw concept content as learned instructions.

The brief makes intent reviewable; it does not prove understanding, useful
generation, semantic coverage or working browser interactions. No live AI
quality acceptance or staging/production deployment is established.

## Verification completed

`npm run verify` passed with a fresh disposable local PostgreSQL database:
572 reported tests, zero failures and zero skips, plus lint, type checks,
Exchange/creation verification and frontend production build. The existing
large-bundle warning remains. The local test server was stopped afterward.

Regressions cover bounded/nonblank concept fields, rejected authority fields,
exact HTML/ZIP identity, design provenance and checksums, old-job compatibility,
same-job repair, replay without more provider requests and single credit capture.
Provider responses were mocked; these are local software checks.

## Resume here without repeating completed work

1. Finish private Render dashboard sign-in and configure/verify the missing
   production OpenAI credential without exposing it. Inspect the required AI
   enablement, orchestration and budget settings; readiness alone is insufficient.
2. Retain public sales/AI access boundaries. Before enabling any paid window,
   establish exact owner/plan scope, expiry and accepted provider/credit budget.
   Existing test-only acceptance mode cannot be assumed valid for live billing.
3. Review and publish this candidate to the canonical isolated staging branch;
   obtain CI and hosted evidence before considering production rollout. Preserve
   the existing deployed revision guard and inspect deployments after env changes.
4. Run one distinct app acceptance objective, such as a local garden-equipment
   lending app. Verify duplicate-loan prevention, valid dates, return flow,
   empty/corrupt storage, responsive use and import/export integrity; compare
   behavior to the actual concept and supplied requirements. Save job and artifact
   identities, observed provider usage, durable reload and credit settlement.
5. Keep local, mocked, staging, browser and production evidence separate. Reuse
   completed billing, starter, export, source and recovery acceptance. Do not
   rerun old paid outputs to refresh documentation or alter old credit receipts.
