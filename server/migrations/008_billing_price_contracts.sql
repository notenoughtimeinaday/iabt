BEGIN;

-- Server-owned, append-only price-to-allowance history. Checkout selection may
-- change while old subscriptions/invoices retain their original contract.
-- Stripe account identity remains an independent operator verification gate.
CREATE TABLE IF NOT EXISTS iabt_billing_price_contracts (
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  price_id text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('builder', 'pro', 'agency')),
  catalog_version text NOT NULL,
  monthly_credits integer NOT NULL CHECK (monthly_credits BETWEEN 1 AND 1000000),
  interval text NOT NULL CHECK (interval = 'month'),
  contract_sha256 text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, price_id)
);

COMMIT;
