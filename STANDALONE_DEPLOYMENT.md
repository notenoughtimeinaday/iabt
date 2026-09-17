# Standalone IABT Staging Runbook

This runbook prepares IABT-JERICHO for an independent staging environment. It
does not change GoDaddy DNS, publish the application, enable live Stripe, or
submit paid provider work.

## Runtime layout

### Existing Render target

The independent frontend is `https://iabt-staging-web.onrender.com`; its API is
`https://iabt-api-insured-spending.onrender.com`. Both deploy the GitHub `main`
branch automatically. The API uses Neon PostgreSQL, private S3-compatible
storage, Resend, and an embedded worker (`IABT_JOB_WORKER_ENABLED=true`).

The current API service is on Render's free plan. Idle suspension can delay
requests and pause background processing; this is not an always-on production
worker. Moving to an always-on API/worker requires a separately approved
hosting plan. Preserve the current paid-provider gates during release checks.

Build the web service with `VITE_IABT_BACKEND=standalone`, the API origin above,
and `VITE_IABT_ROUTING=hash` when no SPA rewrite is configured. Hash links such
as `/#/login` and `/#/studio` stay on the static host's root document. Browser
routing instead requires a Render rewrite from `/*` to `/index.html`.

For this Render target, run smoke checks with `IABT_STAGING_ROUTING=hash` and
`IABT_STAGING_TIMEOUT_MS=60000`. Hash-mode smoke checks verify the declared
application shell; verify interactive routes and refreshes in a browser too.
Readiness checks do not prove inbox delivery, supplier balance, or completion
of a live creation job. See `JERICHO_OPERATIONS.md` for diagnostic boundaries
and `BASE44_IMPORT.md` for the remaining data import requirements.

### Portable stack

- `web`: static React/Vite frontend
- `api`: authentication, entities, planning, approvals, billing, downloads,
  health, and Stripe webhooks
- `worker`: isolated background execution for document, app, image, audio,
  and asynchronous video jobs
- `postgres`: durable users, sessions, plans, jobs, credits, artifacts,
  incidents, and billing events
- external S3-compatible private object storage: durable artifacts and
  short-lived signed downloads

The API and worker use the same source image but run as separate processes.
A provider delay or retry therefore cannot stop the public HTTP process.

## 1. Prepare staging values

Copy `staging.env.example` to `.env.staging`. Keep `.env.staging` out of
source control.

Generate independent staging-only values for:

- `IABT_DATABASE_PASSWORD`
- `IABT_AUTH_SECRET` (at least 32 random bytes)
- S3-compatible bucket credentials with access limited to the staging bucket
- Stripe test credentials and test-mode price identifiers, when ready

Use dedicated staging origins, for example:

- `https://staging.insuredspending.org`
- `https://api-staging.insuredspending.org`

Keep every paid provider gate set to `false` for the first boot. Adding an API
key alone never authorizes spending.

The frontend now defaults to standalone mode. Its build requires
`VITE_IABT_API_URL`; Compose supplies it from `IABT_API_ORIGIN`. It must be an
absolute HTTP(S) origin without credentials, a path, query, or fragment.
This is compiled into the browser bundle, so changing it requires rebuilding
the web image. The build rejects Base44 SDK/bootstrap imports and injected
Base44 runtime scripts. The frontend image installs from `package-lock.json`.

The temporary legacy build requires explicit `VITE_IABT_BACKEND=base44` and
the existing Base44 app settings. Before merging this default change into a
still-Base44-hosted production branch, configure that legacy deployment
explicitly. An independent staging build must use `standalone` (or omit the
selector); never use the legacy setting to work around a missing API origin.

## 2. Validate and start the portable stack

From the repository root:

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml config
docker compose --env-file .env.staging -f docker-compose.staging.yml build
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d
```

No DNS change is needed to run these steps on an isolated host.

## 3. Database migrations

The API and worker automatically load `server/migrations/*.sql` in filename
order. Each migration is recorded in `iabt_schema_migrations` with a SHA-256
checksum.

- concurrent API/worker starts are serialized by a PostgreSQL advisory lock
- an already-applied migration is skipped
- altered migration history causes startup to fail closed
- migration SQL and its checksum are committed together

A migration-only process is also available:

```sh
cd server
npm run migrate
```

Never edit an applied migration. Add a new numbered migration.

## 4. Health and smoke checks

- `GET /healthz`: process liveness
- `GET /readyz`: database, private object storage, email configuration/observed delivery, and migration readiness
- `GET /v1/public-settings`: confirms the standalone public contract

Run the non-mutating remote check:

```sh
IABT_STAGING_API_URL=https://api-staging.insuredspending.org \
IABT_STAGING_WEB_URL=https://staging.insuredspending.org \
npm run verify:staging
```

The smoke test performs only HTTP GET requests. It does not create users,
charge Stripe, spend provider credits, or modify data.

## 5. PostgreSQL backup and restore validation

The backup command requires an explicit non-root directory and creates a custom
PostgreSQL dump plus a SHA-256 manifest:

```sh
cd server
IABT_BACKUP_DIR=/srv/iabt-backups npm run backup
```

Validate recovery only against a disposable database. The restore command
refuses to run unless the exact confirmation phrase is provided:

```sh
cd server
IABT_RESTORE_CONFIRM=RESTORE_DISPOSABLE_DATABASE \
IABT_RESTORE_DATABASE_URL=postgresql://.../iabt_restore_test \
IABT_BACKUP_MANIFEST=/srv/iabt-backups/iabt-postgres-....dump.manifest.json \
npm run restore:test
```

After restore, run `/readyz` and the staging smoke test against the disposable
environment. Never point the restore validation command at production.

For object storage, enable bucket versioning and provider-side lifecycle rules.
A database backup is not a backup of uploaded or generated files; both systems
must be protected and tested.

## 6. Staging acceptance gate

Before any production cutover:

1. run the full repository verification suite
2. import a real Base44 export package into staging
3. reconcile user, project, artifact, job, credit, and file counts
4. complete Stripe test checkout, webhook, portal, cancellation, failed
   payment, and refund/credit-restoration scenarios
5. complete 20 consecutive golden-path creation runs with no unresolved
   incident and no lost artifact
6. complete a database restore and private-file retrieval test
7. review logs and alerts without exposing prompts, credentials, or payment
   details

Only after these checks should Base44 be placed in read-only maintenance mode
and GoDaddy DNS be considered for cutover.
