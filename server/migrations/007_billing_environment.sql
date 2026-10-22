BEGIN;

-- A database's owner-only entitlements and credit bank cannot be converted by
-- changing IABT_STRIPE_MODE. This private singleton is bound after inspecting
-- existing provenance; there is no public entity endpoint or runtime reset.
CREATE TABLE IF NOT EXISTS iabt_billing_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  bound_from text NOT NULL CHECK (bound_from IN ('first_runtime', 'verified_history')),
  bound_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
