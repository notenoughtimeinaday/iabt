import { createHash } from "node:crypto";
import { billingRecordId } from "./fulfillment.js";
import { ensureBillingEnvironment } from "./environment.js";

export const REFUND_CREDIT_POLICY = "retain_existing_credits_v1";
const failure = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const requireFact = (condition, code = "refund_association_conflict") => {
  if (!condition) throw failure(code, "Refund evidence requires operator reconciliation");
};
const idOf = (value) => typeof value === "string" ? value : value?.id;
const providerId = (value, prefix) => {
  const id = idOf(value);
  requireFact(typeof id === "string" && id.length <= 255 && new RegExp(`^${prefix}_[a-zA-Z0-9_]+$`).test(id), "refund_identity_invalid");
  return id;
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const amount = (value) => Number.isSafeInteger(value) && value >= 0;
const terminal = new Set(["succeeded", "failed", "canceled"]);
const known = new Set([...terminal, "pending", "requires_action"]);

// This adapter can only GET fixed Stripe API paths. Errors never expose provider
// bodies or headers, and account verification precedes all payment reads.
const stripeReader = ({ config, fetchImpl }) => async (path) => {
  const mode = config.providers.stripe.mode;
  const key = config.providers.stripe.secretKey;
  requireFact(new RegExp(`^[sr]k_${mode}_`).test(key), "refund_provider_unavailable");
  try {
    const response = await fetchImpl("https://api.stripe.com/v1/" + path, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: "Bearer " + key, "Stripe-Version": "2026-08-26.dahlia" }
    });
    if (!response.ok) throw new Error("read failed");
    return await response.json();
  } catch {
    throw failure("refund_provider_unavailable", "Stripe refund verification is temporarily unavailable", 503);
  }
};

const sourceFacts = async ({ repository, config, ownerId, fulfillmentId, eventId, refundId, expectedAccountId, fetchImpl }) => {
  await ensureBillingEnvironment({ repository, config });
  const mode = config.providers.stripe.mode;
  const live = mode === "live";
  const owner = { id: ownerId, role: "user" };
  const fulfillment = await repository.getRecord("BillingFulfillment", fulfillmentId, owner);
  requireFact(fulfillment?.owner_id === ownerId && fulfillment.user_id === ownerId &&
    fulfillment.status === "granted" && fulfillment.billing_mode === mode &&
    Number.isSafeInteger(fulfillment.credits) && fulfillment.credits > 0, "refund_fulfillment_unverified");
  const grant = await repository.findBillingCreditGrant({ ownerId,
    idempotencyKey: fulfillment.legacy_event_id ? "stripe:" + fulfillment.legacy_event_id : fulfillment.fulfillment_key });
  requireFact(grant?.owner_id === ownerId && Number(grant.amount) === fulfillment.credits &&
    grant.metadata?.product_type === fulfillment.product_type &&
    (!fulfillment.legacy_grant_id || fulfillment.legacy_grant_id === grant.id), "refund_grant_unverified");
  const observation = (await repository.getStripeRefundObservation(providerId(eventId, "evt")))?.observation;
  requireFact(observation && observation.livemode === live, "refund_observation_unverified");
  // Connect cross-account graphs need their own reviewed implementation.
  requireFact(!observation.connected_account_id, "refund_connected_account_unsupported");
  const selectedRefund = providerId(refundId || observation.refund_id, "re");
  requireFact(!observation.refund_id || observation.refund_id === selectedRefund);
  const read = stripeReader({ config, fetchImpl });
  const account = await read("account");
  requireFact(account.id === providerId(expectedAccountId, "acct"), "refund_account_mismatch");
  const checkObject = (value, id) => {
    requireFact(value?.id === id && value.livemode === live, "refund_provider_identity_mismatch");
    return value;
  };
  // Refund itself has no livemode field; mode is proved by the signed inbox,
  // credential namespace and freshly retrieved charge/intent/source objects.
  const refund = await read("refunds/" + selectedRefund);
  requireFact(refund?.id === selectedRefund && (refund.livemode == null || refund.livemode === live), "refund_provider_identity_mismatch");
  const chargeId = providerId(refund.charge, "ch");
  const charge = checkObject(await read("charges/" + chargeId), chargeId);
  const intentId = providerId(charge.payment_intent, "pi");
  const intent = checkObject(await read("payment_intents/" + intentId), intentId);
  requireFact(idOf(refund.payment_intent) === intentId && idOf(intent.latest_charge) === chargeId &&
    (!observation.charge_id || observation.charge_id === chargeId) &&
    (!observation.payment_intent_id || observation.payment_intent_id === intentId));
  requireFact(charge.paid === true && charge.status === "succeeded" && intent.status === "succeeded");
  requireFact(amount(refund.amount) && refund.amount > 0 && amount(charge.amount) && charge.amount > 0 &&
    refund.amount <= charge.amount && amount(charge.amount_refunded) && charge.amount_refunded <= charge.amount &&
    amount(intent.amount_received) && intent.amount_received === charge.amount &&
    /^[a-z]{3}$/.test(refund.currency) && refund.currency === charge.currency && charge.currency === intent.currency);
  requireFact(known.has(refund.status), "refund_status_unknown");
  if (refund.status === "succeeded") requireFact(charge.amount_refunded >= refund.amount);
  requireFact(observation.currency === refund.currency);
  if (observation.refund_id) requireFact(observation.amount === refund.amount);
  const customerId = providerId(charge.customer, "cus");
  requireFact(idOf(intent.customer) === customerId);
  const entitlements = await repository.listRecordsExact("AccountEntitlement", owner, { query: { user_id: ownerId }, limit: 2 });
  requireFact(entitlements.length === 1 && entitlements[0].provider_customer_id === customerId &&
    entitlements[0].billing_mode === mode, "refund_customer_unverified");
  let sourceId;
  if (fulfillment.product_type === "ai_credit_pack") {
    sourceId = providerId(fulfillment.checkout_session_id, "cs");
    requireFact(grant.metadata.checkout_session_id === sourceId &&
      fulfillment.fulfillment_key === `stripe:${mode}:checkout:${sourceId}`, "refund_grant_unverified");
    const session = checkObject(await read("checkout/sessions/" + sourceId), sourceId);
    requireFact(session.mode === "payment" && session.payment_status === "paid" && session.status === "complete" &&
      idOf(session.payment_intent) === intentId && idOf(session.customer) === customerId &&
      session.currency === refund.currency && session.amount_total === charge.amount);
  } else {
    requireFact(fulfillment.product_type === "subscription_allowance", "refund_product_unsupported");
    sourceId = providerId(fulfillment.invoice_id, "in");
    requireFact(grant.metadata.invoice_id === sourceId && grant.metadata.subscription_id === fulfillment.subscription_id &&
      fulfillment.fulfillment_key === `stripe:${mode}:cycle:${fulfillment.subscription_id}:${fulfillment.period_start}`, "refund_grant_unverified");
    const invoice = checkObject(await read("invoices/" + sourceId + "?expand%5B%5D=payments"), sourceId);
    const payments = invoice.payments;
    const payment = payments?.data?.[0];
    requireFact(invoice.status === "paid" && idOf(invoice.customer) === customerId && invoice.currency === refund.currency &&
      idOf(invoice.parent?.subscription_details?.subscription || invoice.subscription) === fulfillment.subscription_id &&
      payments?.has_more === false && payments.data.length === 1 && payment.status === "paid" &&
      payment.payment?.type === "payment_intent" && idOf(payment.payment.payment_intent) === intentId &&
      idOf(payment.invoice) === sourceId && payment.livemode === live && payment.currency === refund.currency &&
      payment.amount_paid === charge.amount && invoice.amount_paid === charge.amount,
    "refund_invoice_payment_unsupported");
  }
  return {
    owner_id: ownerId, fulfillment_id: fulfillment.id, fulfillment_key: fulfillment.fulfillment_key,
    original_grant_id: grant.id, original_credits: fulfillment.credits, product_type: fulfillment.product_type,
    billing_mode: mode, stripe_account_id: account.id, provider_customer_id: customerId,
    source_id: sourceId, refund_id: selectedRefund, charge_id: chargeId, payment_intent_id: intentId,
    refund_amount: refund.amount, currency: refund.currency, charge_amount: charge.amount,
    charge_cumulative_refunded: charge.amount_refunded, refund_status: refund.status,
    // A charge total is evidence only. It is never added to an individual refund.
    credit_policy: REFUND_CREDIT_POLICY, proposed_credit_adjustment: 0, proposed_access_change: "none",
    cash_action: "none", cash_receipt_by_customer: "not_established"
  };
};

export const reviewStripeRefund = async ({ repository, config, ownerId, fulfillmentId, eventId, refundId,
  expectedAccountId, fetchImpl = globalThis.fetch }) => {
  const evidence = await sourceFacts({ repository, config, ownerId, fulfillmentId, eventId, refundId, expectedAccountId, fetchImpl });
  const evidenceDigest = digest(evidence);
  const owner = { id: ownerId, role: "user" };
  const id = billingRecordId("refund-review:" + evidenceDigest);
  return repository.withRecordTransaction(async (tx) => {
    const existing = await tx.getRecord("BillingRefundReview", id, owner);
    if (existing) return existing;
    const balance = await tx.getCreditAccount(ownerId);
    return tx.createRecord("BillingRefundReview", owner, {
      evidence, evidence_digest: evidenceDigest, event_id: eventId,
      reviewed_at: new Date().toISOString(),
      balance_at_review: { available: balance.available_credits, reserved: balance.reserved_credits },
      status: terminal.has(evidence.refund_status) ? "awaiting_operator_approval" : "provider_pending",
      limitation: "Credits are fungible; no per-grant unused-credit attribution or automatic clawback. Provider success does not prove customer receipt."
    }, { id });
  });
};

// No API route calls this method. Host-level operators must supply both the
// exact review digest and an explicit approved policy. It never calls Stripe
// writes, grant/debit/reserve methods, or entitlement mutation.
export const approveStripeRefundReview = async ({ repository, config, ownerId, reviewId, evidenceDigest,
  operatorId, approvePolicy, fetchImpl = globalThis.fetch }) => {
  requireFact(approvePolicy === REFUND_CREDIT_POLICY && typeof operatorId === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{1,99}$/.test(operatorId), "refund_operator_approval_required");
  const owner = { id: ownerId, role: "user" };
  const review = await repository.getRecord("BillingRefundReview", reviewId, owner);
  requireFact(review && review.evidence_digest === evidenceDigest && digest(review.evidence) === evidenceDigest,
    "refund_review_mismatch");
  requireFact(terminal.has(review.evidence.refund_status), "refund_provider_pending");
  const current = await sourceFacts({ repository, config, ownerId, fulfillmentId: review.evidence.fulfillment_id,
    eventId: review.event_id, refundId: review.evidence.refund_id,
    expectedAccountId: review.evidence.stripe_account_id, fetchImpl });
  requireFact(digest(current) === evidenceDigest, "refund_review_stale");
  const id = billingRecordId("refund-decision:" + evidenceDigest);
  return repository.withRecordTransaction(async (tx) => {
    const existing = await tx.getRecord("BillingRefundDecision", id, owner);
    if (existing) return { ...existing, reused: true };
    const balance = await tx.getCreditAccount(ownerId);
    const decision = await tx.createRecord("BillingRefundDecision", owner, {
      review_id: reviewId, evidence_digest: evidenceDigest, evidence: current,
      approved_policy: approvePolicy, operator_id: operatorId, approved_at: new Date().toISOString(),
      status: "reconciled_retain_credits", credit_adjustment: 0, access_changed: false, cash_action: "none",
      balance_at_approval: { available: balance.available_credits, reserved: balance.reserved_credits }
    }, { id });
    return { ...decision, reused: false };
  });
};
