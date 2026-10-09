const modes = new Set(["test", "live"]);
const failure = (code, message) => Object.assign(new Error(message), { code, status: 503 });
export const assertBillingMode = (mode) => {
  if (!modes.has(mode)) throw failure("billing_environment_invalid", "Billing mode must be explicitly test or live.");
};
export const assertBillingBinding = (binding, mode) => {
  assertBillingMode(mode);
  if (binding.mode !== mode) throw failure("billing_environment_conflict", "This database is bound to another Stripe mode. Use a separately reconciled database; changing configuration cannot convert its credits or entitlements.");
  return binding;
};

// Only normalized mode facts leave the repository. Unknown Stripe-associated
// history is not permission to select a mode from today's environment variables.
export const validateBillingEvidence = (facts, requestedMode) => {
  assertBillingMode(requestedMode);
  const observed = new Set();
  const subscriptionModes = new Map();
  const needsSubscription = [];
  let unresolved = false;
  for (const fact of facts) {
    const candidates = [fact.explicit_mode, fact.key_mode, fact.event_mode, fact.checkout_mode]
      .filter((value) => value !== null && value !== undefined);
    if (candidates.some((value) => !modes.has(value))) unresolved = true;
    const known = candidates.filter((value) => modes.has(value));
    for (const mode of known) observed.add(mode);
    const subscriptionKey = fact.owner_id && /^sub_[a-zA-Z0-9_]+$/.test(fact.subscription_id || "")
      ? JSON.stringify([fact.owner_id, fact.subscription_id]) : null;
    if (fact.owner_provenance && subscriptionKey && known.length) {
      const values = subscriptionModes.get(subscriptionKey) || new Set();
      known.forEach((mode) => values.add(mode));
      subscriptionModes.set(subscriptionKey, values);
    }
    if (!candidates.length) {
      if (fact.owner_inference) needsSubscription.push(subscriptionKey);
      else unresolved = true;
    }
  }
  if (observed.size > 1) throw failure("billing_environment_conflict", "This database contains conflicting Stripe modes. Reconcile its billing history in an isolated environment before enabling billing.");
  if (needsSubscription.some((key) => !key || subscriptionModes.get(key)?.size !== 1)) unresolved = true;
  if (unresolved) throw failure("billing_environment_reconciliation_required", "Existing Stripe billing history has no unambiguous mode provenance. Reconcile it before binding this database; configuration cannot supply missing evidence.");
  if (observed.size && !observed.has(requestedMode)) throw failure("billing_environment_conflict", "Existing Stripe billing history conflicts with the configured mode. Use a separately reconciled database.");
  return observed.size ? "verified_history" : "first_runtime";
};

export const ensureBillingEnvironment = async ({ repository, config }) => {
  const mode = config?.providers?.stripe?.mode;
  assertBillingMode(mode);
  if (typeof repository.ensureBillingEnvironment !== "function") {
    throw failure("billing_environment_unavailable", "Durable billing environment protection is unavailable.");
  }
  return repository.ensureBillingEnvironment(mode);
};

const keyMode = (key) => /^stripe:(test|live):(checkout|cycle):/.exec(String(key || ""))?.[1] ?? null;
const stripeEntitlement = (record) => record.billing_provider === "stripe" ||
  /^cus_/.test(record.provider_customer_id || "") || /^sub_/.test(record.provider_subscription_id || "");
const stripeGrant = (entry) => entry.entry_type === "grant" && (
  String(entry.idempotency_key || "").startsWith("stripe:") || entry.metadata?.billing_mode !== undefined ||
  /^evt_/.test(entry.metadata?.event_id || "") || ["ai_credit_pack", "subscription_allowance"].includes(entry.metadata?.product_type)
);

export const memoryBillingEvidence = (repository) => {
  const eventMode = (eventId) => {
    const event = repository.stripeEvents.get(eventId);
    return event ? (event.livemode ? "live" : "test") : null;
  };
  const facts = [...repository.stripeEvents.values()].map((event) => ({ explicit_mode: event.livemode ? "live" : "test" }));
  for (const entry of repository.creditEntries.filter(stripeGrant)) {
    facts.push({ owner_id: entry.owner_id, explicit_mode: entry.metadata?.billing_mode ?? null,
      key_mode: keyMode(entry.idempotency_key), event_mode: eventMode(entry.metadata?.event_id),
      subscription_id: entry.metadata?.subscription_id, owner_provenance: entry.metadata?.product_type === "subscription_allowance" });
  }
  for (const entity of ["AccountEntitlement", "BillingCheckoutAttempt", "BillingFulfillment", "BillingSubscriptionSync", "BillingEvent"]) {
    for (const record of repository.records.get(entity)?.values() || []) {
      if (entity === "AccountEntitlement" && !stripeEntitlement(record)) continue;
      if (entity === "BillingEvent" && !/^evt_/.test(record.event_id || "") && record.billing_provider !== "stripe" && record.billing_mode === undefined) continue;
      facts.push({ owner_id: record.owner_id, explicit_mode: record.billing_mode ?? null,
        key_mode: entity === "BillingFulfillment" ? keyMode(record.fulfillment_key) : null,
        event_mode: eventMode(record.event_id), checkout_mode: entity === "BillingCheckoutAttempt" ? record.mode ?? null : null,
        subscription_id: entity === "AccountEntitlement" ? record.provider_subscription_id : record.subscription_id,
        owner_provenance: entity === "BillingFulfillment" && record.product_type === "subscription_allowance",
        owner_inference: ["AccountEntitlement", "BillingSubscriptionSync"].includes(entity) });
    }
  }
  return facts;
};

// DISTINCT reduces history to normalized owner/mode facts instead of loading
// event bodies, customer identities, ledger contents or arbitrary record data.
// Mode-less entitlements require durable allowance evidence for that exact
// owner's subscription. Credit packs and unrelated subscriptions cannot help.
export const BILLING_EVIDENCE_SQL = `
SELECT DISTINCT NULL::uuid AS owner_id, CASE WHEN livemode THEN 'live' ELSE 'test' END AS explicit_mode,
 NULL::text AS key_mode, NULL::text AS event_mode, NULL::text AS checkout_mode,
 false AS owner_provenance, false AS owner_inference, NULL::text AS subscription_id FROM iabt_stripe_events
UNION
SELECT DISTINCT c.owner_id, c.metadata->>'billing_mode',
 substring(c.idempotency_key from '^stripe:(test|live):(?:checkout|cycle):'),
 CASE WHEN e.event_id IS NOT NULL THEN CASE WHEN e.livemode THEN 'live' ELSE 'test' END END,
 NULL::text, c.metadata->>'product_type' = 'subscription_allowance', false, c.metadata->>'subscription_id'
FROM iabt_credit_entries c LEFT JOIN iabt_stripe_events e ON e.event_id = c.metadata->>'event_id'
WHERE c.entry_type = 'grant' AND (c.idempotency_key LIKE 'stripe:%' OR c.metadata ? 'billing_mode'
 OR c.metadata->>'event_id' LIKE 'evt\\_%' ESCAPE '\\'
 OR c.metadata->>'product_type' IN ('ai_credit_pack', 'subscription_allowance'))
UNION
SELECT DISTINCT r.owner_id, r.payload->>'billing_mode',
 CASE WHEN r.entity_name = 'BillingFulfillment' THEN substring(r.payload->>'fulfillment_key' from '^stripe:(test|live):(?:checkout|cycle):') END,
 CASE WHEN e.event_id IS NOT NULL THEN CASE WHEN e.livemode THEN 'live' ELSE 'test' END END,
 CASE WHEN r.entity_name = 'BillingCheckoutAttempt' THEN r.payload->>'mode' END,
 r.entity_name = 'BillingFulfillment' AND r.payload->>'product_type' = 'subscription_allowance',
 r.entity_name IN ('AccountEntitlement', 'BillingSubscriptionSync'),
 CASE WHEN r.entity_name = 'AccountEntitlement' THEN r.payload->>'provider_subscription_id' ELSE r.payload->>'subscription_id' END
FROM iabt_entity_records r LEFT JOIN iabt_stripe_events e ON e.event_id = r.payload->>'event_id'
WHERE r.entity_name IN ('BillingCheckoutAttempt', 'BillingFulfillment', 'BillingSubscriptionSync')
 OR (r.entity_name = 'BillingEvent' AND (r.payload->>'event_id' LIKE 'evt\\_%' ESCAPE '\\'
 OR r.payload->>'billing_provider' = 'stripe' OR r.payload ? 'billing_mode'))
 OR (r.entity_name = 'AccountEntitlement' AND (r.payload->>'billing_provider' = 'stripe'
 OR r.payload->>'provider_customer_id' LIKE 'cus\\_%' ESCAPE '\\'
 OR r.payload->>'provider_subscription_id' LIKE 'sub\\_%' ESCAPE '\\'))`;
