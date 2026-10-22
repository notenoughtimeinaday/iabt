import { isDeepStrictEqual } from "node:util";

const eventTypes = new Set([
  "refund.created", "refund.updated", "refund.failed", "charge.refund.updated", "charge.refunded"
]);
const statuses = new Set(["pending", "requires_action", "succeeded", "failed", "canceled"]);
const error = (code, message, status = 503) => Object.assign(new Error(message), { code, status });
const idOf = (value, prefix, optional = false) => {
  if (optional && value == null) return null;
  const id = typeof value === "string" ? value : value?.id;
  if (typeof id !== "string" || id.length > 255 || !new RegExp(`^${prefix}_[a-zA-Z0-9_]+$`).test(id)) {
    throw error("stripe_refund_identity_invalid", "Refund observation has an invalid provider identity", 422);
  }
  return id;
};

export const isStripeRefundEvent = (type) => eventTypes.has(type);

// A signed snapshot is evidence for an operator, not current provider state or
// proof of account ownership. Keep every event immutable rather than guessing a
// latest refund state from arrival order. Never persist raw metadata or card data.
export const prepareStripeRefundObservation = ({ event, config }) => {
  if (!isStripeRefundEvent(event.type)) throw error("stripe_refund_event_invalid", "Unsupported refund event", 422);
  const object = event.data?.object || {};
  const charge = event.type === "charge.refunded";
  const amount = charge ? object.amount_refunded : object.amount;
  if (!Number.isSafeInteger(amount) || amount < 0 || typeof object.currency !== "string" || !/^[a-z]{3}$/.test(object.currency)) {
    throw error("stripe_refund_amount_invalid", "Refund observation has an invalid amount or currency", 422);
  }
  if (event.created != null && (!Number.isSafeInteger(event.created) || event.created <= 0)) {
    throw error("stripe_refund_timestamp_invalid", "Refund event timestamp is invalid", 422);
  }
  const chargeId = charge ? idOf(object.id, "ch") : idOf(object.charge, "ch", true);
  const paymentIntentId = idOf(object.payment_intent, "pi", true);
  if (!chargeId && !paymentIntentId) throw error("stripe_refund_payment_missing", "Refund requires payment reconciliation", 422);
  const marker = object.metadata?.iabt_app_id ?? object.metadata?.base44_app_id;
  return {
    event_id: idOf(event.id, "evt"), event_type: event.type, livemode: event.livemode === true,
    connected_account_id: idOf(event.account, "acct", true),
    event_created: event.created ?? null,
    object_id: charge ? chargeId : idOf(object.id, "re"),
    refund_id: charge ? null : idOf(object.id, "re"),
    charge_id: chargeId, payment_intent_id: paymentIntentId,
    amount, currency: object.currency,
    // Charge totals are cumulative and must never be added to per-refund amounts.
    amount_kind: charge ? "charge_cumulative_refunded" : "individual_refund",
    observed_status: charge ? "charge_refunded" : (statuses.has(object.status) ? object.status : "unknown"),
    app_attribution: marker == null || marker === "" ? "unattributed"
      : marker === config.providers.stripe.metadataAppId ? "matching_metadata" : "other_metadata"
  };
};

const result = () => ({ action: "refund_reconciliation_required", reconciliation_required: true });
export const recordStripeRefundObservation = async ({ repository, observation, claimToken }) => {
  if (typeof repository.recordStripeRefundObservation !== "function") {
    throw error("stripe_refund_inbox_unavailable", "Durable refund observation storage is unavailable");
  }
  const recorded = await repository.recordStripeRefundObservation({ observation, claimToken });
  if (!recorded) throw error("stripe_event_claim_lost", "Refund event processing must be retried");
  if (!isDeepStrictEqual(recorded.observation, observation)) {
    throw error("stripe_refund_observation_conflict", "Refund event differs from its durable observation", 409);
  }
  return result();
};

export const replayStripeRefundObservation = async ({ repository, observation }) => {
  const recorded = await repository.getStripeRefundObservation?.(observation.event_id);
  if (!recorded) {
    // Older binaries acknowledged these events without retaining a snapshot.
    // Do not silently turn that transport receipt into refund acceptance.
    throw error("stripe_refund_receipt_missing", "Previously received refund needs operator reconciliation");
  }
  if (!isDeepStrictEqual(recorded.observation, observation)) {
    throw error("stripe_refund_observation_conflict", "Refund event differs from its durable observation", 409);
  }
  return result();
};
