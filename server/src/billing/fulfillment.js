import { createHash } from "node:crypto";

export const billingRecordId = (key) => {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

// Receipts and ledger grants use the payment/cycle identity, never delivery IDs.
// Granting is outside the record transaction: the PostgreSQL ledger owns its own
// transaction. A crash between grant and receipt completion safely resumes.
export const fulfillCredits = async ({ repository, user, key, amount, source }) => {
  const owner = { ...user, role: "user" };
  const id = billingRecordId(key);
  const receipt = await repository.withRecordTransaction(async (tx) => {
    const existing = await tx.getRecord("BillingFulfillment", id, owner);
    if (existing) {
      if (existing.credits !== amount || existing.fulfillment_key !== key) {
        throw Object.assign(new Error("Billing fulfillment requires reconciliation"), { status: 409, code: "billing_fulfillment_conflict" });
      }
      if (existing.status === "granted") return existing;
    }
    // Before session-level keys, standalone grants used stripe:<event ID> and
    // retained the Checkout identity in ledger metadata. Bridge only this exact
    // payment; never guess from an account balance or scan/replay past invoices.
    if (source.product_type === "ai_credit_pack") {
      if (typeof tx.findLegacyStripeCreditGrants !== "function") {
        throw Object.assign(new Error("Billing ledger reconciliation is unavailable"), { status: 503, code: "billing_legacy_lookup_unavailable" });
      }
      const grants = await tx.findLegacyStripeCreditGrants({ checkoutSessionId: source.checkout_session_id });
      if (grants.length) {
        const legacy = grants[0];
        if (grants.length !== 1 || legacy.owner_id !== user.id || Number(legacy.amount) !== amount ||
            legacy.metadata?.product_type !== "ai_credit_pack" ||
            legacy.idempotency_key !== "stripe:" + legacy.metadata?.event_id) {
          throw Object.assign(new Error("Historical Stripe fulfillment requires reconciliation"), { status: 409, code: "billing_legacy_fulfillment_conflict" });
        }
        const fields = { user_id: user.id, fulfillment_key: key, credits: amount, ...source,
          status: "granted", legacy_grant_id: legacy.id, legacy_event_id: legacy.metadata.event_id,
          reconciled_at: new Date().toISOString() };
        return existing
          ? tx.updateRecord("BillingFulfillment", id, owner, fields)
          : tx.createRecord("BillingFulfillment", owner, fields, { id });
      }
    }
    if (existing) return existing;
    return tx.createRecord("BillingFulfillment", owner, {
      user_id: user.id, fulfillment_key: key, credits: amount, status: "pending", ...source
    }, { id });
  });
  if (receipt.status === "granted") return 0;
  await repository.grantCredits({ ownerId: user.id, amount, idempotencyKey: key, metadata: source });
  return repository.withRecordTransaction(async (tx) => {
    const latest = await tx.getRecord("BillingFulfillment", id, owner);
    if (latest.status === "granted") return 0;
    await tx.updateRecord("BillingFulfillment", id, owner, { status: "granted", granted_at: new Date().toISOString() });
    return amount;
  });
};
