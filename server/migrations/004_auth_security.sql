BEGIN;

ALTER TABLE iabt_auth_challenges
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS iabt_auth_rate_limits (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS iabt_auth_rate_limits_expiry_idx
  ON iabt_auth_rate_limits(expires_at);

COMMIT;
