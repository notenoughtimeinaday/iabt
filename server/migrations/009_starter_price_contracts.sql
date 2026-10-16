BEGIN;

-- Extend the registry without rewriting purchased terms or migration 008.
ALTER TABLE iabt_billing_price_contracts
  DROP CONSTRAINT iabt_billing_price_contracts_plan_check;
ALTER TABLE iabt_billing_price_contracts
  ADD CONSTRAINT iabt_billing_price_contracts_plan_check
  CHECK (plan IN ('starter', 'builder', 'pro', 'agency'));

COMMIT;
