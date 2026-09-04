BEGIN;

CREATE TABLE IF NOT EXISTS iabt_credit_accounts (
  owner_id uuid PRIMARY KEY REFERENCES iabt_users(id) ON DELETE CASCADE,
  available_credits integer NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  reserved_credits integer NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iabt_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES iabt_users(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'needs_setup')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  credit_amount integer NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS iabt_jobs_claim_idx
  ON iabt_jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS iabt_jobs_owner_idx
  ON iabt_jobs(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS iabt_stored_objects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES iabt_users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES iabt_jobs(id) ON DELETE SET NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iabt_stored_objects_owner_idx
  ON iabt_stored_objects(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS iabt_incidents (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES iabt_users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES iabt_jobs(id) ON DELETE SET NULL,
  category text NOT NULL,
  error_code text NOT NULL,
  safe_message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iabt_incidents_owner_idx
  ON iabt_incidents(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS iabt_credit_entries (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES iabt_users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES iabt_jobs(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('grant', 'reserve', 'capture', 'release', 'adjustment')),
  amount integer NOT NULL CHECK (amount > 0),
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, entry_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS iabt_credit_entries_owner_idx
  ON iabt_credit_entries(owner_id, created_at DESC);

COMMIT;