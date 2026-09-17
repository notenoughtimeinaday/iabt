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
