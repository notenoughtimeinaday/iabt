# JERICHO standalone operational support

JERICHO's operational knowledge is generated from implemented standalone capabilities, current non-secret configuration flags, and the signed-in account's latest 50 jobs and incidents. It is refreshed on each support question. Repeated failure codes are grouped to expose recurring problems. No model training or autonomous source-code modification takes place.

Ask “What can you do?”, “Check system health”, or “Why did my audio fail?” in Studio. These requests read operational records without creating a plan, spending credits, calling a generation provider, or executing a fix. Ordinary creation requests continue through server-owned planning and explicit quote approval. The Exchange assistant explains the authenticated profile, matching, mutual-introduction, and private-room workflows; this support chat does not perform those changes or contact other people.

The snapshot excludes raw prompts, provider error bodies, credentials, incident details, and other accounts' records, including when the signed-in user is an administrator. Technical provider configuration, commercial approval, recorded artifact verification, and recorded credit restoration remain separate facts. A configuration snapshot cannot verify supplier balance, worker liveness, email delivery, public reachability, or deployment success.

## Failure recovery

1. Check the job ID, status, attempt count, associated incident, and artifact verification. A queued job may already be scheduled for retry; avoid duplicate submissions.
2. For configuration, supplier balance, authentication, or approval failures, correct the underlying requirement with the administrator. Do not paste credentials into chat or bypass approval gates.
3. For uncertain paid submissions, reconcile the supplier outcome and job ledger before approving a replacement. Retrying after a worker crash can require human investigation; an idempotency key alone does not prove every external provider deduplicates requests.
4. Claim credit restoration only when the persisted job explicitly records it. IABT credit restoration does not imply a supplier refund or cash refund.
5. Verify any code fix with focused regression tests and the normal verification pipeline, then deploy through the authorized release process. Update capability facts alongside implementation changes.

Generic entity writes remain forbidden for PolicyAcceptance. The authenticated `accept-policies` function records the signed-in user's explicit boolean acknowledgements of the shared current policy version. Identity, timestamp, agreement text, source, and ownership are determined by the server. Repeated completed requests reuse the current acceptance record.

## Uploaded-file source review

Standalone Studio supports a bounded, deterministic source-review document flow:

1. Upload a file with authenticated `POST /v1/files` (multipart `file`). The response includes a durable `file_id`, byte count, SHA-256, and a temporary private download URL. Retain the file ID; renew downloads through authenticated `GET /v1/files/:id/access`, since URLs expire after five minutes.
2. Submit top-level `file_ids` with a conversation message or `plan-creation`. For example: “Create a report from the attached files listing their verification markers and requirements.” The backend reads each source from its configured private storage and verifies ownership, size, checksum, and UTF-8 decoding before creating a quote. Browser-supplied file URLs and content descriptions are not source evidence.
3. Review and explicitly approve the quoted one-credit document plan. Source references are bound into the quote signature, preserved in the message/plan/job, and rechecked at approval and worker execution. A terminal processing failure restores the reserved IABT credit through the existing job ledger.
4. Receive a source inventory, line-referenced candidate requirement checklist, and source evidence in private Markdown, DOCX, and PDF artifacts. The Markdown companion preserves the complete decoded source text; the portable PDF is a reading copy with limited character support. Artifact metadata records the source IDs, SHA-256 values, and verification result.

Limits: at most 12 files, 128 KiB and 2,000 lines per source, and 256 KiB and 4,000 lines total. Supported extensions are TXT, MD/Markdown, JSON, CSV/TSV, JS/JSX/MJS/CJS, TS/TSX, Python, HTML, CSS, Java, C/H/C++/HPP, Go, Rust, Ruby, PHP, SH/Bash, SQL, YAML/YML, XML, and TOML. Sources must contain valid UTF-8 text without binary control characters. Unsupported formats, unreadable or changed files, and bounds violations fail explicitly; they are never silently omitted. Opaque PDF/Office/archive/media uploads may be stored but cannot participate in source review yet. File URLs can be shared by anyone possessing a valid signed link until its expiry; creating a new link requires the signed-in file owner, including for administrator accounts.

This flow performs no model call, paid-provider operation, uploaded-code execution, external-link fetch, or repository modification. It extracts literal candidate requirement lines rather than claiming general semantic analysis, implementation verification, or software advancement. Requests with attachments for other creation intents are rejected. The source review is the file-handling milestone; isolated-branch software changes remain a separate workflow.

Local regression evidence covers real HTTP upload/conversation/approval/worker/download, a marker present only in source content, fresh storage-adapter reads, expired-link renewal, account isolation including administrators, corrupt/missing/oversized/unsupported sources, credit restoration, and bounded S3 stream reads. These checks use local storage and test repositories or an S3 transport double; they do not establish live S3 persistence, deployed frontend behavior, or a completed customer workflow.
