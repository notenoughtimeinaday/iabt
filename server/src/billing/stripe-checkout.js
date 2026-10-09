import { ensureBillingPriceCatalog, resolvePriceContract } from "./price-catalog.js";
import { configuredOffer, offerAcceptance, verifyOfferProviderTerms, OFFER_CATALOG_VERSION } from "./offers.js";
import { billingRecordId } from "./fulfillment.js";

const billingError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

const customerId = (entitlement) =>
  entitlement?.billing_provider === "stripe"
    ? String(entitlement.provider_customer_id || "")
    : "";

const currentEntitlement = async (repository, user) =>
  (
    await repository.listRecordsExact("AccountEntitlement", { ...user, role: "user" }, {
      query: { user_id: user.id },
      sort: "-updated_date",
      limit: 1
    })
  )[0] || null;

export const pendingOfferSummary = async ({ repository, config, user }) => {
  const row = await repository.getRecord("BillingCheckoutAttempt",
    billingRecordId(`subscription-checkout:${config.providers.stripe.mode}:${user.id}`), { ...user, role: "user" });
  if (!row?.offer_terms || !["creating", "open", "uncertain"].includes(row.status)) return null;
  return { id: row.offer_terms.offer_id, disclosure: row.offer_terms.disclosure,
    disclosure_version: row.offer_terms.disclosure_version };
};

const executionContext = ({ user, action, idempotencyKey, live }) => ({
  idempotencyKey,
  approval: {
    approved: true,
    approval_id: "billing:" + action + ":" + user.id,
    max_cost_cents: 0,
    live_confirmed: Boolean(live)
  }
});

const createStripeSession = async ({
  providers,
  config,
  user,
  path,
  params,
  action,
  idempotencyKey
}) => {
  const result = await providers.execute(
    "stripe",
    "post",
    { path, params, estimated_cost_cents: 0 },
    executionContext({
      user,
      action,
      idempotencyKey,
      live: config.providers.stripe.mode === "live"
    })
  );
  if (!result?.data?.url) {
    throw billingError(502, "stripe_invalid_session", "Stripe returned no secure session URL");
  }
  return result.data;
};

const assertCheckoutReady = (providers) => {
  const readiness = providers?.readiness?.().stripe;
  if (!readiness?.checkout_ready) {
    throw billingError(
      503,
      "stripe_checkout_not_ready",
      "Stripe checkout is not fully configured in the selected test or live mode"
    );
  }
};

export const createSubscriptionCheckout = async ({
  repository,
  providers,
  config,
  user,
  plan,
  offerId,
  acceptance,
  idempotencyKey,
  now = Date.now
}) => {
  if (!offerId && !["builder", "pro", "agency"].includes(plan)) {
    throw billingError(400, "invalid_subscription_plan", "Plan must be builder, pro, or agency");
  }
  await ensureBillingPriceCatalog({ repository, config });
  const entitlement = await currentEntitlement(repository, user);
  const customer = customerId(entitlement);
  const hasSubscription = hasManagedSubscription(entitlement);

  if (hasSubscription) {
    const portal = await createCustomerPortal({ repository, providers, config, user, idempotencyKey });
    return {
      ok: true,
      kind: "portal",
      url: portal.url,
      message: "An existing subscription must be changed through the customer portal."
    };
  }

  // A disabled/changed sale configuration must not strand an already issued
  // offer. Resume its exact saved request; admission still rejects a fresh
  // attempt if Stripe confirms expiry and the offer has since been disabled.
  const saved = offerId ? await repository.getRecord("BillingCheckoutAttempt",
    billingRecordId(`subscription-checkout:${config.providers.stripe.mode}:${user.id}`), { ...user, role: "user" }) : null;
  const resume = Boolean(offerId && saved?.offer_terms?.offer_id === offerId && ["creating", "open", "uncertain"].includes(saved.status));
  if (resume) {
    if (acceptance?.accepted !== true || acceptance.version !== saved.offer_terms.disclosure_version || !saved.request_params || !saved.price_contract) {
      throw billingError(409, "billing_disclosure_required", "Review the saved purchase disclosure before resuming Checkout.");
    }
    return subscriptionCheckoutAttempt({ repository, user, config, plan: saved.plan, params: saved.request_params,
      priceContract: saved.price_contract, offerTerms: saved.offer_terms, now,
      submit: async (frozenParams, providerKey) => {
        const result = await providers.execute("stripe", "post", { path: "/checkout/sessions", params: frozenParams, estimated_cost_cents: 0 },
          executionContext({ user, action: "subscription-checkout-" + saved.plan, idempotencyKey: providerKey, live: config.providers.stripe.mode === "live" }));
        return result?.data;
      },
      retrieve: (sessionId) => retrieveSubscriptionCheckout({ config, sessionId, fetchImpl: providers.fetch || globalThis.fetch }) });
  }

  assertCheckoutReady(providers);

  const offer = offerId ? configuredOffer(config, offerId) : null;
  const offerTerms = offer ? offerAcceptance(offer, acceptance) : null;
  if (offer) plan = offer.plan;
  const selectedPrice = offer?.price_id || config.providers.stripe.prices[plan];
  const priceContract = await resolvePriceContract({ repository, config, priceId: selectedPrice });
  if (!priceContract || priceContract.plan !== plan) {
    throw billingError(503, "stripe_price_not_configured", "The selected Stripe price has no verified billing contract");
  }
  if (!offer && priceContract.catalog_version === OFFER_CATALOG_VERSION) {
    throw billingError(409, "billing_offer_required", "Reload billing and accept the versioned offer before purchasing.");
  }
  if (offer) await verifyOfferProviderTerms({ config, offer, fetchImpl: providers.fetch || globalThis.fetch });

  const metadata = {
    iabt_app_id: config.providers.stripe.metadataAppId,
    base44_app_id: config.providers.stripe.metadataAppId,
    plan,
    user_id: user.id,
    user_email: user.email,
    ...(offerTerms ? { billing_offer_id: offerTerms.offer_id, billing_offer_terms_sha256: offerTerms.terms_sha256 } : {}),
    // Keep legacy provider parameters stable for existing pending attempts.
    ...(priceContract.catalog_version !== "legacy-v1" ? {
      billing_catalog_version: priceContract.catalog_version,
      billing_contract_sha256: priceContract.contract_sha256
    } : {})
  };
  const params = {
    mode: "subscription",
    "line_items[0][price]": selectedPrice,
    "line_items[0][quantity]": "1",
    success_url: config.publicOrigin + "/?billing=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: config.publicOrigin + "/?billing=canceled",
    client_reference_id: user.id,
    ...(offerTerms ? {
      currency: offerTerms.currency,
      "adaptive_pricing[enabled]": "false",
      "custom_text[submit][message]": offerTerms.disclosure,
      ...(offerTerms.coupon_id ? { "discounts[0][coupon]": offerTerms.coupon_id } : {})
    } : { allow_promotion_codes: "true" }),
    ...(customer.startsWith("cus_") ? { customer } : { customer_email: user.email })
  };
  for (const [key, value] of Object.entries(metadata)) {
    params["metadata[" + key + "]"] = value;
    params["subscription_data[metadata][" + key + "]"] = value;
  }
  const pending = await subscriptionCheckoutAttempt({ repository, user, config, plan, params, priceContract, offerTerms, now,
    submit: async (frozenParams, providerKey) => {
      const result = await providers.execute("stripe", "post", { path: "/checkout/sessions", params: frozenParams, estimated_cost_cents: 0 },
        executionContext({ user, action: "subscription-checkout-" + plan, idempotencyKey: providerKey, live: config.providers.stripe.mode === "live" }));
      return result?.data;
    },
    retrieve: (sessionId) => retrieveSubscriptionCheckout({ config, sessionId, fetchImpl: providers.fetch || globalThis.fetch })
  });
  if (pending.kind === "portal_required") {
    const portal = await createCustomerPortal({ repository, providers, config, user, idempotencyKey });
    return { ...portal, message: "An existing subscription must be changed through the customer portal." };
  }
  return pending;
};

export const createCreditCheckout = async ({
  repository,
  providers,
  config,
  user,
  idempotencyKey
}) => {
  await ensureBillingPriceCatalog({ repository, config });
  assertCheckoutReady(providers);
  const entitlement = await currentEntitlement(repository, user);
  const customer = customerId(entitlement);
  const metadata = {
    iabt_app_id: config.providers.stripe.metadataAppId,
    base44_app_id: config.providers.stripe.metadataAppId,
    product_type: "ai_credit_pack",
    credits: String(config.providers.stripe.creditPackSize),
    user_id: user.id,
    user_email: user.email
  };
  const params = {
    mode: "payment",
    "line_items[0][price]": config.providers.stripe.creditPackPriceId,
    "line_items[0][quantity]": "1",
    success_url: config.publicOrigin + "/?billing=credits_success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: config.publicOrigin + "/?billing=canceled",
    client_reference_id: user.id,
    ...(customer.startsWith("cus_") ? { customer } : { customer_email: user.email })
  };
  for (const [key, value] of Object.entries(metadata)) {
    params["metadata[" + key + "]"] = value;
    params["payment_intent_data[metadata][" + key + "]"] = value;
  }
  const session = await createStripeSession({
    providers,
    config,
    user,
    path: "/checkout/sessions",
    params,
    action: "credit-pack-checkout",
    idempotencyKey
  });
  return { ok: true, kind: "checkout", url: session.url, session_id: session.id };
};

export const createCustomerPortal = async ({
  repository,
  providers,
  config,
  user,
  idempotencyKey
}) => {
  await ensureBillingPriceCatalog({ repository, config });
  const readiness = providers?.readiness?.().stripe;
  if (!readiness?.configured) {
    throw billingError(503, "stripe_portal_not_ready", "Stripe customer portal is not configured");
  }
  const entitlement = await currentEntitlement(repository, user);
  const customer = customerId(entitlement);
  if (!customer.startsWith("cus_")) {
    throw billingError(409, "stripe_customer_missing", "No Stripe customer is linked to this account");
  }
  const portal = await createStripeSession({
    providers,
    config,
    user,
    path: "/billing_portal/sessions",
    params: {
      customer,
      return_url: config.publicOrigin + "/"
    },
    action: "customer-portal",
    idempotencyKey
  });
  return { ok: true, kind: "portal", url: portal.url };
};
import { hasManagedSubscription, retrieveSubscriptionCheckout, subscriptionCheckoutAttempt } from "./checkout-attempt.js";
