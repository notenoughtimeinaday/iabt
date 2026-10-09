import { createHash } from "node:crypto";
import { JERICHO_OFFER_CATALOG_VERSION, planEntitlementsForContract } from "./plans.js";

export const OFFER_CATALOG_VERSION = JERICHO_OFFER_CATALOG_VERSION;
export const OFFER_TERMS_VERSION = "jericho-2026-10-review-1";
export const INTRO_OFFER_ID = "meet-jericho-2026-10";
const definition = (id, plan, name, cents, credits, intro = false) => Object.freeze({
  id, plan, name, currency: "usd", interval: "month", amount_cents: cents,
  monthly_credits: credits, introductory: intro, renewal_amount_cents: intro ? 1200 : cents,
  disclosure_version: OFFER_TERMS_VERSION,
  disclosure: intro
    ? "Meet Jericho costs $4.99 for your first monthly billing period and includes 100 credits after successful payment. It automatically renews as Starter at $12 per month, with 100 credits after each successful monthly payment, until canceled. Cancel through Manage billing before your next renewal. Applicable taxes are shown before payment. Available once per verified account with no previous paid subscription; prior credit-pack purchases alone do not disqualify you."
    : `${name} costs $${cents / 100} per month and automatically renews until canceled. Each successful monthly payment adds ${credits} credits. Cancel through Manage billing before your next renewal. Applicable taxes are shown before payment.`
});
export const BILLING_OFFERS = Object.freeze([
  definition(INTRO_OFFER_ID, "starter", "Meet Jericho", 499, 100, true),
  definition("starter-2026-10", "starter", "Starter", 1200, 100),
  definition("builder-2026-10", "builder", "Builder", 2900, 300),
  definition("pro-2026-10", "pro", "Pro", 5900, 650)
]);
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const enabled = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());

export const loadOfferConfig = (env) => Object.freeze({
  enabled: enabled(env.IABT_NEW_OFFERS_ENABLED),
  introEnabled: enabled(env.IABT_MEET_JERICHO_ENABLED),
  acceptedTerms: env.IABT_NEW_OFFER_TERMS_VERSION || "",
  accountId: env.IABT_STRIPE_ACCOUNT_ID || "",
  couponId: env.IABT_MEET_JERICHO_COUPON_ID || "",
  priceIds: Object.freeze({ starter: env.IABT_STRIPE_STARTER_PRICE_ID || "",
    builder: env.IABT_STRIPE_BUILDER_V2_PRICE_ID || "", pro: env.IABT_STRIPE_PRO_V2_PRICE_ID || "" })
});

// This candidate deliberately cannot sell the new offers in live mode.
// Registration/fulfillment remain independent from new-purchase activation.
export const newOffersAvailable = (config) => config.providers.stripe.mode === "test" &&
  config.providers.stripe.offers?.enabled === true &&
  config.providers.stripe.offers.acceptedTerms === OFFER_TERMS_VERSION;

export const configuredOffer = (config, id) => {
  if (!newOffersAvailable(config)) fail("billing_offer_disabled", "The new offer has not been activated for accepted test billing.");
  const offer = BILLING_OFFERS.find((item) => item.id === id);
  if (!offer) fail("billing_offer_unknown", "Select a current versioned offer.", 400);
  const settings = config.providers.stripe.offers;
  if (offer.introductory && !settings.introEnabled) fail("billing_offer_disabled", "The introductory offer is unavailable.");
  const priceId = settings.priceIds[offer.plan];
  const contract = config.providers.stripe.priceContracts.find((item) => item.price_id === priceId);
  if (!/^acct_[a-zA-Z0-9]+$/.test(settings.accountId) || !contract ||
      contract.catalog_version !== OFFER_CATALOG_VERSION || contract.plan !== offer.plan ||
      contract.monthly_credits !== offer.monthly_credits ||
      (offer.introductory && !/^[a-zA-Z0-9_-]{1,240}$/.test(settings.couponId))) {
    fail("billing_offer_not_configured", "The selected offer has no complete verified configuration.", 503);
  }
  return { ...offer, price_id: priceId, price_contract: contract, stripe_account_id: settings.accountId,
    coupon_id: offer.introductory ? settings.couponId : null };
};

export const offerAcceptance = (offer, acceptance) => {
  if (acceptance?.accepted !== true || acceptance?.version !== offer.disclosure_version) {
    fail("billing_disclosure_required", "Review and accept the current price and automatic-renewal disclosure.");
  }
  const terms = { offer_id: offer.id, disclosure_version: offer.disclosure_version,
    disclosure: offer.disclosure, amount_cents: offer.amount_cents,
    renewal_amount_cents: offer.renewal_amount_cents, currency: offer.currency,
    interval: offer.interval, monthly_credits: offer.monthly_credits,
    entitlements: planEntitlementsForContract(offer.plan, offer.price_contract),
    price_id: offer.price_id, contract_sha256: offer.price_contract.contract_sha256,
    stripe_account_id: offer.stripe_account_id, coupon_id: offer.coupon_id };
  return Object.freeze({ ...terms, terms_sha256: createHash("sha256").update(JSON.stringify(terms)).digest("hex") });
};

export const publicBillingOffers = (config) => {
  if (!newOffersAvailable(config)) return [];
  return BILLING_OFFERS.flatMap((item) => {
    try {
      const offer = configuredOffer(config, item.id);
      const rights = planEntitlementsForContract(offer.plan, offer.price_contract);
      return [{ id: offer.id, plan: offer.plan, name: offer.name, currency: offer.currency,
        amount_cents: offer.amount_cents, renewal_amount_cents: offer.renewal_amount_cents,
        monthly_credits: offer.monthly_credits, introductory: offer.introductory,
        disclosure_version: offer.disclosure_version, disclosure: offer.disclosure,
        project_limit: rights.project_limit, static_zip_export_enabled: rights.static_zip_export_enabled,
        react_export_enabled: rights.react_export_enabled, commercial_use_enabled: rights.commercial_use_enabled }];
    } catch (error) {
      if (["billing_offer_not_configured", "billing_offer_disabled"].includes(error.code)) return [];
      throw error;
    }
  });
};

// Only bounded, allowlisted metadata reaches operator logs. Never retain the
// response body, provider message, actual resource path, key or request headers.
const verificationFailure = (diagnostic) => Object.assign(new Error(
  "Stripe offer terms could not be verified. No new Checkout was submitted."
), { code: "billing_offer_verification_failed", status: 503,
  billingVerification: Object.freeze(diagnostic) });
const errorTypes = new Set(["invalid_request_error", "authentication_error", "permission_error", "api_error", "rate_limit_error"]);
const errorCodes = new Set(["resource_missing", "api_key_expired", "invalid_api_key", "parameter_unknown", "parameter_missing", "rate_limit"]);
const getStripe = async (config, path, endpoint, fetchImpl) => {
  const stripe = config.providers.stripe;
  const diagnostic = { endpoint, failure: "configuration", http_status: null,
    stripe_request_id: null, stripe_error_type: null, stripe_error_code: null, stripe_error_reason: null, required_permission: null };
  if (!new RegExp(`^[sr]k_${stripe.mode}_`).test(stripe.secretKey)) throw verificationFailure(diagnostic);
  const signal = AbortSignal.timeout(15000);
  let response;
  try {
    response = await fetchImpl("https://api.stripe.com/v1" + path, { method: "GET", redirect: "error",
      signal, headers: { Authorization: "Bearer " + stripe.secretKey, "Stripe-Version": "2026-08-26.dahlia" } });
    const requestId = response.headers?.get?.("request-id");
    diagnostic.stripe_request_id = typeof requestId === "string" && /^req_[a-zA-Z0-9]{1,100}$/.test(requestId) ? requestId : null;
    diagnostic.http_status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
    if (!response.ok) {
      diagnostic.failure = "http";
      // A malformed error body must not hide the upstream HTTP status.
      const body = await response.json().catch(() => null);
      diagnostic.stripe_error_type = errorTypes.has(body?.error?.type) ? body.error.type : null;
      diagnostic.stripe_error_code = errorCodes.has(body?.error?.code) ? body.error.code : null;
      // Classify Stripe's permission explanation without retaining its message,
      // which can contain the credential and account identity.
      const message = typeof body?.error?.message === "string" ? body.error.message : "";
      if (/does not have the required permissions for this endpoint/.test(message)) {
        diagnostic.stripe_error_reason = "insufficient_permissions";
        const permission = message.match(/Having the ['`](rak_[a-z_]{1,60})['`] permission/);
        diagnostic.required_permission = permission?.[1] || null;
      }
      throw verificationFailure(diagnostic);
    }
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyntaxError("invalid response");
    return body;
  } catch (error) {
    if (error?.billingVerification === diagnostic) throw error;
    diagnostic.failure = signal.aborted || error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "timeout" : response ? "invalid_response" : "network";
    throw verificationFailure(diagnostic);
  }
};

export const verifyOfferProviderTerms = async ({ config, offer, fetchImpl = globalThis.fetch }) => {
  const account = await getStripe(config, "/account", "/v1/account", fetchImpl);
  if (account.id !== offer.stripe_account_id) fail("billing_offer_account_mismatch", "The configured Stripe account does not match this offer.");
  const price = await getStripe(config, "/prices/" + offer.price_id, "/v1/prices/:id", fetchImpl);
  if (price.id !== offer.price_id || price.livemode !== false || price.active !== true ||
      price.type !== "recurring" || price.currency !== offer.currency ||
      price.unit_amount !== offer.renewal_amount_cents || price.billing_scheme !== "per_unit" ||
      price.recurring?.interval !== "month" || price.recurring?.interval_count !== 1 ||
      price.recurring?.usage_type !== "licensed" || price.transform_quantity || price.custom_unit_amount) {
    fail("billing_offer_price_mismatch", "Stripe price terms differ from the selected offer.");
  }
  if (offer.introductory) {
    const coupon = await getStripe(config, "/coupons/" + offer.coupon_id + "?expand%5B%5D=applies_to", "/v1/coupons/:id", fetchImpl);
    const productId = typeof price.product === "string" ? price.product : price.product?.id;
    if (coupon.id !== offer.coupon_id || coupon.livemode !== false || coupon.valid !== true ||
        coupon.duration !== "once" || coupon.amount_off !== 701 || coupon.currency !== "usd" ||
        coupon.percent_off != null || coupon.applies_to?.products?.length !== 1 || coupon.applies_to.products[0] !== productId) {
      fail("billing_offer_discount_mismatch", "The introductory discount does not match the accepted offer.");
    }
  }
};

// Optional host-only probe for free staging hosts without Shell/SSH. No
// repository, provider executor or Checkout operation is reachable here.
export const probeOfferProviderTerms = async ({ config, offerId, fetchImpl = globalThis.fetch }) => {
  if (!offerId || !newOffersAvailable(config)) return { status: "skipped" };
  try {
    const offer = configuredOffer(config, offerId);
    await verifyOfferProviderTerms({ config, offer, fetchImpl });
    return { status: "verified" };
  } catch (error) {
    const codes = ["billing_offer_verification_failed", "billing_offer_account_mismatch", "billing_offer_price_mismatch",
      "billing_offer_discount_mismatch", "billing_offer_disabled", "billing_offer_unknown", "billing_offer_not_configured"];
    return { status: "failed", code: codes.includes(error.code) ? error.code : "internal_error",
      ...(error.billingVerification ? { verification: error.billingVerification } : {}) };
  }
};
