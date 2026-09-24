# Durable Jericho maintenance

Jericho's application worker performs bounded account maintenance independently
of Codex and the browser. Migration `005_maintenance.sql` stores schedules,
leases, cursors, summaries and failure counts in PostgreSQL. Verified accounts
are enrolled automatically in bounded batches; existing paused schedules remain
paused. Studio exposes the authenticated account's status, findings and pause or
resume control. Administrators cannot target a different account through these
functions.

## Work that can continue

The existing worker has a separate maintenance lane. For each due account it
claims a renewable lease, visits terminal jobs using a stable cursor and saves
progress after each bounded step. It can:

- Reconcile a linked CreationPlan's status with its authoritative terminal job.
- Ensure a typed execution lesson exists for that persisted outcome, preserving
  the learning service's provenance and withdrawal rules.
- Read eligible private artifacts and compare owner, job, byte count and SHA-256
  against their manifest; record missing, corrupt, unavailable or oversized
  artifacts as findings instead of destroying evidence.

Default limits are 25 jobs and 8 MB of attempted artifact reads per pass, with a
2 MB limit per artifact. A cooperative 30-second pass deadline stops new steps;
an in-flight storage read is also subject to the storage adapter's timeout.
Checkpointed work resumes in later passes.
Temporary read failures have bounded retries; permanent/unknown failures remain
findings. A pause revokes the current lease; future mutations must stop. Repeated
passes are idempotent. Maintenance neither captures nor grants credits.

Remote byte readback is disabled by default because GET requests and data
transfer can be metered. Enable `IABT_MAINTENANCE_REMOTE_READBACK_ENABLED=true`
only after accepting those costs. Metadata checks, plan reconciliation and
lesson retention continue with it disabled; remote integrity remains unverified.
Local artifact readback is enabled within the same bounds.

These checks use existing hosting, PostgreSQL and private storage; normal
infrastructure usage can still be billed by those providers. They do not call
paid generation, send messages, purchase services, rerun paid jobs, delete files,
edit source, merge changes or deploy. A successful file checksum is evidence of
integrity, not functional correctness or acceptance of the user's whole goal.

## Operation

Use the normal embedded worker (`IABT_JOB_WORKER_ENABLED=true`) or the standalone
worker process. Both start the same maintenance implementation. Configure limits
through the `IABT_MAINTENANCE_*` entries in `standalone.env.example`; server clamps
prevent callers from raising the code's maximum limits. The global
`IABT_MAINTENANCE_ENABLED=false` disables maintenance. The owner can change their
interval between 5 and 1,440 whole minutes or pause in Studio.

Authenticated POST functions:

| Function | Input and result |
| --- | --- |
| `get-jericho-maintenance` | Enroll if missing, then return own safe status |
| `configure-jericho-maintenance` | Strict boolean `enabled`, optional integer `interval_minutes`; returns own safe status |

Jericho's support knowledge includes this same account-scoped snapshot. Its
versioned curriculum explains the maintenance boundaries and remaining
acceptance work. Findings expose typed codes and record references, never raw
source text, credentials, storage keys or provider bodies.

## Availability and release evidence

Schedules survive a worker or server restart, but execution requires a running
host. Render's free web service can suspend during inactivity. Always-on
continuity therefore needs an approved paid web instance or an independently
running worker. Do not label a configured schedule as proof of uninterrupted
operation. After deploying, observe a completed pass, restart/reclaim behavior,
and a later pass without an open browser before claiming continuity.

The repository's readiness runner provides separate commit-bound verification
artifacts. It never marks staging, payments, inbox delivery, restoration or
functional output acceptance passed based on unit tests. Keep the upgrade on
`jericho-autonomy-v1` and retain the production cutover gate until those checks
have actual evidence.
