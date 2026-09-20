# Jericho learning and teamwork

Jericho now has an evidence retrieval loop: reviewed software updates teach a
versioned curriculum; finished jobs contribute account-specific observations;
users record structured corrections; verified delivery and explicit acceptance
can resolve those corrections. Improvement proposals preserve the evidence and
remaining acceptance checkpoints. The orchestrator retrieves these facts for
subsequent work. This is application memory and instruction engineering, not
model training, autonomous source-code modification, or proof of release readiness.

## Server-owned curriculum

`server/src/learning/curriculum.js` provides a copy-on-read curriculum and SHA-256
digest. Each implemented learning capability identifies its source and test file.
Rules cover objective tracking, avoiding duplicate work, server-owned authority,
verification, bounded recovery, provenance, and updating the curriculum when
software changes. The identity rule recommends consistent verified email where
practical but never equates matching addresses with permission to merge accounts.

A reviewed code change is required to change this curriculum. Stored user text,
uploaded files, provider output, and model tool calls cannot edit it. The digest
identifies a version; it is not evidence that tests ran or a release was deployed.

## Durable records and trust boundaries

The service stores `JerichoLesson` and `JerichoImprovementProposal` in the existing
standalone entity table. PostgreSQL's record transaction and advisory lock protect
deduplication across API/worker instances; the memory repository implements the
same contract for tests. No additional table or Base44 service is required.
Learning writes fail closed if the adapter lacks the transaction contract.

All access uses the authenticated owner's ID with a non-administrator scope.
Administrators do not receive other accounts' learning through Studio. Generic
entity CRUD is unavailable for both learning entities; authenticated dedicated
functions own lifecycle transitions. The endpoints ignore client-supplied owner,
status, verification, authority, and instruction fields.

The service does not retain freeform correction text, prompts, uploaded content,
filenames, storage paths, provider error bodies, or credentials. Learning facts
contain known enumerated categories, opaque record IDs, artifact hashes and byte
counts, timestamps, and explicit evidence levels. Context is bounded to 50 retained
lessons, selected from the latest 100 matching records; an orchestrated job scopes
retrieval to its authoritative persisted workflow type. This bounded view is not
a complete lifetime audit. Withdrawn lessons and their proposals are excluded.

## Job observations and recovered work

The worker calls `recordExecutionLesson` after a job reaches a terminal state.
The service reloads the job by ID; a caller's supplied job contents do not count
as evidence. One observation is retained per owner/job, including concurrent
and repeated notifications. Learning failure cannot restart a completed job,
repeat a supplier call, or capture credits again.

`verified_delivery` requires a succeeded job, its persisted verification flag,
and an artifact manifest whose ownership, job binding, checksum, and size match
stored-object records. This checks persisted metadata. It does not read storage
again, execute generated software, or establish semantic correctness.

A matching verified delivery after more than one attempt and a recognized failure
code is recorded as `successful_recovery` with pattern
`retry_within_original_job`. That observed sequence does not establish the root
cause or authorize a new paid retry. Existing spending, retry, tool, and ownership
limits still apply. Unknown error text is reduced to `unclassified_failure`.
Credit restoration is copied only from the persisted credit-release outcome.

The private source reader preserves a safe retry classification for temporary
network, timeout, throttling and object-storage service failures. Those faults
reuse the existing job and credit reservation. Missing, denied, corrupt, oversized
or unsupported sources remain explicit failures. Raw storage errors are not
retained in the public retry message.

Historical jobs are not silently backfilled by reading a snapshot. The internal
observation hook can be replayed by a trusted maintenance process; its job-based
deduplication preserves withdrawals and prevents duplicate lessons.

## Corrections and improvement proposals

Studio includes a collapsed **Jericho learning & teamwork** panel. Users can view
the current curriculum, record a categorized correction tied to a job, review
recent evidence, withdraw a lesson, and prepare an improvement proposal.

Corrections support: incorrect output, missing requirement, wrong format,
unreadable artifact, repeated work, and account access interruptions. They start
as `candidate`: the app records that the user reported a problem, not that it has
proved the cause. A stable request ID prevents duplicates and cannot be reused
for a different category or source job.

Resolving a correction requires the signed-in owner to explicitly accept a
result from the same workflow and identify a succeeded job with matching artifact
metadata. The resulting status is `accepted_by_owner`. Functional correctness is
owner-attested, not machine-verified. Repeated acceptance retains its original
timestamp; conflicting acceptance evidence is rejected. An account-access
correction is job-linked and is not a substitute for email delivery diagnostics.

Each proposal is deduplicated by owner/lesson. Its checkpoints distinguish source
recording, artifact delivery, explicit owner acceptance, regression verification,
and staging acceptance. The last two remain pending until a future trusted
verification integration supplies evidence; users and model text cannot mark them
passed. Proposals do not execute code, grant approval, merge, or deploy. A repeated
proposal updates the evidence projection without creating another work item.

## Authenticated HTTP functions

Use `POST /v1/functions/<name>` with the user's bearer session. Responses wrap
results in `data`. All fields below use JSON snake_case:

| Function | Request fields | Result |
| --- | --- | --- |
| `get-jericho-learning` | none | Curriculum, lessons, recoveries, candidates, proposals |
| `record-jericho-correction` | `job_id`, `category`, `request_id` | Candidate lesson |
| `resolve-jericho-correction` | `lesson_id`, `job_id`, `accepted: true` | Owner-accepted lesson |
| `withdraw-jericho-lesson` | `lesson_id` | Withdrawn lesson |
| `propose-jericho-improvement` | `lesson_id` | Proposal with explicit pending checkpoints |

## Teaching the next advancement

1. Implement the capability under server policy and give it meaningful regression
   coverage. Keep authorization independent from the model's plans and memories.
2. Update the checked-in curriculum with what the new capability can actually do,
   its tests, and its limitations. Do not claim deployment or learning from code
   that has merely been added.
3. Preserve verified job outcomes and explicit corrections as typed account data.
   Include historical context in planning as evidence, never as permission.
4. Track a proposed improvement with its source evidence and durable checkpoints.
   Finish tests and staging validation through the release process before
   promotion. A useful private artifact does not prove the whole product complete.

## Verification

`server/test/learning.test.js` exercises immutable curriculum copies, concurrent
deduplication, evidence integrity, account isolation including admins, omission
of sensitive data, correction/acceptance conflict handling, withdrawals, proposal
checkpoints, scoped retrieval, and refusal of nontransactional writes.
`server/test/learning-http.test.js` exercises the authenticated HTTP lifecycle,
real worker observation, protected generic routes, support retrieval, and account
isolation. These local tests use the memory repository and private local storage;
`server/test/learning-postgres.test.js` uses the explicit disposable local
`IABT_AUTH_TEST_DATABASE_URL` to verify concurrency across independent connections,
reopening persisted evidence, owner isolation and withdrawals. It skips when that
database is not supplied. Deployed acceptance remains separate and must be
reported by the release verification pipeline.
