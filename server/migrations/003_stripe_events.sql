BEGIN;

CREATE TABLE IF NOT EXISTS iabt_stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  payload_sha256 text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS iabt_stripe_events_status_idx
  ON iabt_stripe_events(status, updated_at);

COMMIT;
