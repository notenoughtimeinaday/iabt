# JERICHO standalone operational support

JERICHO reads implemented capability facts, current non-secret configuration and the signed-in account's jobs, incidents and learning records. It distinguishes available configuration, recorded delivery and live operational evidence. Read-only support questions such as “What can you do?”, “Check system health” and “Why did my audio fail?” do not submit paid generation or contact other people.

Ordinary objectives use server-owned planning. Supported reversible internal routes with zero external provider cost can queue automatically; the response discloses the IABT credit reservation. Quote-only requests remain available. Paid Responses or media work and consequential external actions require the applicable approval. Unknown capabilities fail closed instead of inheriting authority from a prompt, attachment or past lesson.

The support snapshot excludes raw prompts, provider error bodies, credentials and other accounts' records, including when the signed-in user is an administrator. Configuration cannot prove supplier balance, worker liveness, inbox delivery, public reachability or deployment success. See [docs/AUTONOMY_V1.md](docs/AUTONOMY_V1.md) for the implementation and acceptance matrix.

## Durable execution and recovery

The worker claims a leased job, renews its lease while executing, and checkpoints durable state through the repository. Normal Responses polling and tool continuations yield back to the queue without consuming a failure attempt. Transient read/poll/storage failures use the existing bounded retry budget; terminal failures release reserved IABT credits through the job ledger.

Responses execution uses background requests and saved response IDs. Before a potentially billable submission, the worker records that submission is in progress. If the outcome is uncertain after interruption, it does not issue another paid POST. Known response IDs are polled again; saved tool outcomes are reused. Legacy paid-provider results small enough for the bounded checkpoint are also saved before artifact storage, while ambiguous or oversized unfinished submissions require reconciliation rather than a second generation.

A model-proposed execution graph must pass server validation before tools run. Graphs contain at most 16 registered-tool nodes, dependency depth 8 and three attempts per node. Only ready nodes may execute. Replanning cannot remove or rewrite attempted evidence; repeated calls retain identity and result digests. The graph coordinates the registered internal tools—it is not permission to execute arbitrary code or infrastructure operations.

Artifact objects use deterministic identities derived from their job, position and content. The worker reads stored bytes back and compares their size and SHA-256 before capturing credits. A storage adapter without readback cannot complete a job. This verifies delivery and integrity, not software behavior or factual correctness. A labeled template or partial result can be durably delivered while the original objective remains incomplete.

When investigating a failure:

1. Inspect the existing job's status, phase, attempt count, incident, recorded recovery and artifacts before submitting replacement work.
2. Let a queued retry finish within its original authorization. Configuration, authentication, supplier balance and approval problems need the corresponding requirement repaired.
3. Reconcile uncertain paid submissions with the provider and ledger before approving a replacement. An idempotency key alone does not prove provider deduplication.
4. Claim credit restoration only when the persisted job records it. IABT credit restoration is not a supplier or cash refund.
5. Record the reproducer, focused regression test and staging evidence for a software fix; update the curriculum alongside the changed capability.

Public job responses expose progress, graph state and limitations. Private tool arguments, inspected source text, base64 checkpoints and provider response bodies are not public job fields.

## Teaching JERICHO from evidence

The teaching layer is retrieval of a checked-in, versioned curriculum plus account-owned observations. It does not train model weights, rewrite its own instructions from user text, grant new capabilities or commit/deploy code.

The curriculum in `server/src/learning/curriculum.js` teaches objective tracking, avoiding duplicate work, checking capabilities, preserving approval boundaries, bounded repair, source ownership, identity continuity and truthful verification. Each implemented capability identifies its source, regression suite and limitations. Update this curriculum when implementation changes; a curriculum entry alone is not deployment evidence.

After a terminal job, the learning service reloads the persisted outcome and checks artifact metadata against owner-scoped records. It stores typed observations and evidence links. Duplicate observations deduplicate transactionally. Failure to write a learning projection cannot retry or reverse a completed paid operation.

Users can record a structured correction: incorrect output, missing requirement, format mismatch, unreadable artifact, duplicate work or account access. A correction begins as a candidate. Resolving it requires a succeeded job of the same workflow with artifact evidence and explicit account-owner acceptance. That acceptance is an owner attestation, not a machine proof of functional correctness. Withdrawn lessons no longer feed active retrieval or proposals.

Improvement proposals retain source-job evidence and checkpoints for artifact delivery, owner acceptance, regression verification and staging acceptance. They identify work to reproduce and verify; they do not authorize execution or claim the software has changed. This gives a developer and JERICHO a shared record for continued work without repeating completed investigation.

Authenticated function endpoints under `/v1/functions/`:

| Function | Purpose |
|---|---|
| `get-jericho-learning` | Read curriculum, account lessons and improvement proposals |
| `record-jericho-correction` | Record a typed correction with a stable request ID and owned job |
| `resolve-jericho-correction` | Attach evidenced resolution and explicit owner acceptance |
| `withdraw-jericho-lesson` | Remove a lesson from active use |
| `propose-jericho-improvement` | Create or refresh a proposal linked to a lesson |
| `get-capability-registry` | Read server-owned configuration, blockers, fallbacks and observed local health |

Responses initially receive at most eight relevant typed lessons with compact evidence references. Historical observations are explicitly marked as reference data, not instructions or authorization. The account dashboard can retrieve up to 50 lessons. Raw correction prose and arbitrary prompts are not promoted into the teaching curriculum.

For identity continuity, recommend the same verified email across services where practical. Matching email text never authorizes account linking or merging; each service must prove ownership separately.

## Uploaded-file source review

Standalone Studio supports a private, deterministic source-review document flow:

1. Upload through authenticated `POST /v1/files` with multipart `file`. Retain the durable `file_id`, byte count and SHA-256. Renew expiring links through authenticated `GET /v1/files/:id/access`.
2. Submit top-level `file_ids` with a conversation message or `plan-creation`. For example: “Create a report from the attached files listing their verification markers and requirements.” The backend checks owner, storage adapter, size, checksum and UTF-8 content. Browser-supplied URLs or descriptions are not source evidence.
3. A normal safe objective can automatically reserve the disclosed one-credit source-review job. Explicit quote-only flows still require accepting that quote. Source references are signed into the plan and rechecked at execution; a terminal failure restores the reservation through the ledger.
4. Receive a source inventory, line-referenced candidate requirement checklist and source evidence as private Markdown, DOCX and PDF. The Markdown companion preserves the complete decoded source; the portable PDF has limited character support. Artifact metadata links the source IDs and checksums.

Limits: 12 files; 128 KiB and 2,000 lines per source; 256 KiB and 4,000 lines total. Supported extensions: TXT, MD/Markdown, JSON, CSV/TSV, JS/JSX/MJS/CJS, TS/TSX, Python, HTML, CSS, Java, C/H/C++/HPP, Go, Rust, Ruby, PHP, SH/Bash, SQL, YAML/YML, XML and TOML. Sources must be valid UTF-8 without binary control characters. Unsupported, missing, changed or oversized sources fail explicitly; they are not silently omitted.

Opaque PDF, Office, archive and media files may be stored but are not parsed for source review yet. Anyone possessing a valid signed download link can use it until expiry; issuing a new link requires the file owner's account, including for administrators.

This flow performs no model call, paid-provider operation, uploaded-code execution, external-link fetch or repository edit. It extracts literal candidate requirements, not general semantic conclusions or proof of implementation. Attached-file requests for other creation intents remain unsupported by the current planner. The lower-level orchestration inspection tool also uses the verified text reader, but this is not a claim that all uploaded formats or creation modes work together.

## Access, email and policy acceptance

Standalone access uses the IABT account and verified email. Recovery must preserve the existing account identity and associated projects/credits; do not create duplicate accounts merely to work around a delivery failure. Current service-specific credentials remain independent even when the preferred email address is shared.

The observed Resend HTTP 403 was traced to missing sender-domain DNS records. On 2026-09-20, owner-approved email-only additions resulted in a verified Resend domain and observed provider acceptance of an IABT reset email. Inbox receipt, code redemption and sign-in remain owner acceptance steps. A configured sender, accepted email or healthy database does not demonstrate that a code reached the inbox. Acceptance also covers expiration, reuse and throttling checks.

Generic entity writes cannot create `PolicyAcceptance`. The authenticated `accept-policies` function requires explicit boolean acknowledgements for the shared current version; identity, time, agreement text and ownership come from the server. Repeated completed requests reuse the current acceptance record.

## Verification boundaries and release

`npm run verify` is the complete existing repository suite. Run PostgreSQL integration tests with a disposable database, not production credentials. Focused suites include `orchestration.test.js`, `execution-graph.test.js`, `autonomy-policy.test.js`, `durable-autonomy.test.js`, `learning.test.js`, `learning-http.test.js`, `source-review.test.js` and existing account, billing, provider, Exchange and worker tests.

Paid-provider tests use mocked network transports. Local storage and S3 transport doubles do not establish live file durability. Passing tests do not establish live inbox delivery, Stripe revenue, arbitrary code execution, backup recovery or release readiness.

Keep the reviewed branch unmerged and production/DNS unchanged until the staging acceptance requirements in [STANDALONE_DEPLOYMENT.md](STANDALONE_DEPLOYMENT.md) pass. Those include account access, file-to-artifact journeys, billing test scenarios, migration reconciliation and restore/retrieval exercises. Record the tested commit and environment for every result. The free Render service's idle suspension remains a background availability limit until hosting is explicitly addressed.
