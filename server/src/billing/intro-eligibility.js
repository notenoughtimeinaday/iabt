import { billingRecordId } from "./fulfillment.js";
import { INTRO_OFFER_ID, configuredOffer, offerAcceptance } from "./offers.js";

const fail = (code = "billing_intro_ineligible") => { throw Object.assign(new Error(
  code === "billing_intro_ineligible" ? "The introductory offer is unavailable for this account. Choose Starter or manage the existing subscription."
    : "The introductory purchase requires reconciliation before another attempt."), { code, status: 409 }); };
const ownerOf = (user) => ({ ...user, role: "user" });
const claimId = (config, user) => billingRecordId(`intro:${config.providers.stripe.mode}:${config.providers.stripe.metadataAppId}:${INTRO_OFFER_ID}:${user.id}`);

export async function introEligibility({ repository, user, config }) {
  const owner = ownerOf(user);
  if (!user.email_verified) return { eligible: false, reason: "verified_account_required" };
  const claim = await repository.getRecord("BillingIntroClaim", claimId(config, user), owner);
  if (claim && claim.status !== "released") return { eligible: false, reason: claim.status === "redeemed" ? "already_redeemed" : "purchase_pending" };
  // Filter before limiting; a current Free entitlement cannot erase history.
  const receipts = await repository.listRecordsExact("BillingFulfillment", owner, { query: { product_type: "subscription_allowance" }, limit: 1 });
  if (receipts.length) return { eligible: false, reason: "subscription_history" };
  const subscription = await repository.listRecordsExact("AccountEntitlement", owner, { query: { billing_provider: "stripe" }, limit: 1 });
  const sync = await repository.listRecordsExact("BillingSubscriptionSync", owner, { limit: 1 });
  const [entitlement] = await repository.listRecordsExact("AccountEntitlement", owner, { limit: 1 });
  if (subscription.length || sync.length || (entitlement?.plan && entitlement.plan !== "free")) {
    return { eligible: false, reason: "history_requires_reconciliation" };
  }
  return { eligible: true, reason: "no_subscription_history" };
}

// Called inside Checkout admission's existing transaction, never before it.
// Private record types are deliberately absent from generic entity routes.
export async function admitOfferAttempt({ tx, config, user, attemptId, offerTerms, now }) {
  if (!offerTerms) return;
  const current = offerAcceptance(configuredOffer(config, offerTerms.offer_id), { accepted: true, version: offerTerms.disclosure_version });
  if (current.terms_sha256 !== offerTerms.terms_sha256) fail("billing_intro_reconciliation_required");
  const owner = ownerOf(user);
  if (offerTerms.offer_id === INTRO_OFFER_ID) {
    if (!(await introEligibility({ repository: tx, config, user })).eligible) fail();
    const id = claimId(config, user);
    const fields = { user_id: user.id, billing_mode: config.providers.stripe.mode,
      app_id: config.providers.stripe.metadataAppId, attempt_id: attemptId, status: "reserved",
      offer_terms: offerTerms, reserved_at: new Date(now()).toISOString(), invoice_id: null, customer_id: null };
    const existing = await tx.getRecord("BillingIntroClaim", id, owner);
    if (existing) await tx.updateRecord("BillingIntroClaim", id, owner, fields);
    else await tx.createRecord("BillingIntroClaim", owner, fields, { id });
  }
  await tx.createRecord("BillingOfferAcceptance", owner, { user_id: user.id,
    billing_mode: config.providers.stripe.mode, attempt_id: attemptId, ...offerTerms,
    accepted_at: new Date(now()).toISOString() }, { id: billingRecordId("offer-acceptance:" + attemptId) });
}

// Release only after provider-confirmed expiry without a subscription or a
// definite rejected create. Timeouts, failed payments and browser returns do not.
export async function releaseExpiredIntro({ tx, config, user, row, session, rejected = false }) {
  if (row.offer_terms?.offer_id !== INTRO_OFFER_ID || (!rejected && (session?.status !== "expired" || session.subscription_id))) return;
  const owner = ownerOf(user);
  const claim = await tx.getRecord("BillingIntroClaim", claimId(config, user), owner);
  if (claim?.status === "reserved" && claim.attempt_id === row.attempt_id) {
    await tx.updateRecord("BillingIntroClaim", claim.id, owner, { status: "released",
      release_reason: rejected ? "provider_request_rejected" : "provider_session_expired", expired_session_id: session?.session_id || null });
  }
}

export async function redeemIntroInvoice({ repository, config, user, invoice, metadata, priceContract }) {
  if (metadata.billing_offer_id !== INTRO_OFFER_ID || invoice.billing_reason !== "subscription_create") return;
  const owner = ownerOf(user);
  await repository.withRecordTransaction(async (tx) => {
    const claim = await tx.getRecord("BillingIntroClaim", claimId(config, user), owner);
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    const terms = claim?.offer_terms;
    if (!claim || !["reserved", "redeemed"].includes(claim.status) || claim.attempt_id !== metadata.checkout_attempt_id ||
        terms?.terms_sha256 !== metadata.billing_offer_terms_sha256 || terms?.price_id !== priceContract.price_id ||
        !/^cus_[a-zA-Z0-9_]+$/.test(customerId || "") ||
        (claim.invoice_id && claim.invoice_id !== invoice.id)) fail("billing_intro_reconciliation_required");
    const customerRecordId = billingRecordId(`intro-customer:${config.providers.stripe.mode}:${terms.stripe_account_id}:${INTRO_OFFER_ID}:${customerId}`);
    // Exact internal lookup protects a previously linked customer across users.
    const used = await tx.getRecord("BillingIntroCustomer", customerRecordId, { ...owner, role: "admin" });
    if (used && (used.owner_id !== user.id || used.attempt_id !== claim.attempt_id)) fail("billing_intro_reconciliation_required");
    if (!used) await tx.createRecord("BillingIntroCustomer", owner, { user_id: user.id,
      billing_mode: config.providers.stripe.mode, customer_id: customerId, attempt_id: claim.attempt_id }, { id: customerRecordId });
    await tx.updateRecord("BillingIntroClaim", claim.id, owner, { status: "redeemed", invoice_id: invoice.id,
      customer_id: customerId, redeemed_at: claim.redeemed_at || new Date().toISOString() });
  });
}
