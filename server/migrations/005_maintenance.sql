BEGIN;

CREATE TABLE IF NOT EXISTS iabt_maintenance (
  owner_id uuid PRIMARY KEY REFERENCES iabt_users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  interval_ms integer NOT NULL DEFAULT 900000 CHECK (interval_ms BETWEEN 300000 AND 86400000),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  locked_by text,
  lease_expires_at timestamptz,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iabt_maintenance_due_idx ON iabt_maintenance(next_run_at) WHERE enabled;
CREATE INDEX IF NOT EXISTS iabt_jobs_maintenance_idx ON iabt_jobs(owner_id, completed_at, id)
  WHERE status IN ('succeeded', 'failed', 'needs_setup');

COMMIT;
