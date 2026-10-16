BEGIN;

-- Operator-only immutable event evidence. No account ownership or cash/credit
-- adjustment is inferred from refund metadata; reconciliation stays pending.
CREATE TABLE IF NOT EXISTS iabt_stripe_refund_observations (
  event_id text PRIMARY KEY REFERENCES iabt_stripe_events(event_id),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  reconciliation_status text NOT NULL DEFAULT 'required' CHECK (reconciliation_status = 'required'),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iabt_stripe_refund_observations_received_idx
  ON iabt_stripe_refund_observations(received_at);

COMMIT;
