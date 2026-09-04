import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { planDefaults, planForPrice } from "./plans.js";

const stripeError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

const signatureParts = (header) => {
  const values = new Map();
  for (const part of String(header || "").split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
  }
  return values;
};

export const verifyStripeEvent = ({
  rawBody,
  signatureHeader,
  webhookSecret,
  nowSeconds = Math.floor(Date.now() / 1000)
}) => {
  if (!String(webhookSecret || "").startsWith("whsec_")) {
    throw stripeError(503, "stripe_webhook_not_configured", "Stripe webhook signing is not configured");
  }
  const values = signatureParts(signatureHeader);
  const timestamp = Number(values.get("t")?.[0]);
  const signatures = values.get("v1") || [];
  if (!Number.isFinite(timestamp) || !signatures.length) {
    throw stripeError(400, "stripe_signature_invalid", "Stripe signature header is invalid");
  }
  if (Math.abs(nowSeconds - timestamp) > 300) {
    throw stripeError(400, "stripe_signature_expired", "Stripe webhook timestamp is outside tolerance");
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expectedHex = createHmac("sha256", webhookSecret)
    .update(Buffer.concat([Buffer.from(timestamp + ".", "utf8"), body]))
    .digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const valid = signatures.some((value) => {
    if (!/^[a-f0-9]{64}$/i.test(value)) return false;
    const candidate = Buffer.from(value, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!valid) {
    throw stripeError(400, "stripe_signature_invalid", "Stripe signature verification failed");
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw stripeError(400, "stripe_payload_invalid", "Stripe webhook payload is invalid JSON");
  }
};

const metadataFor = (object) => object?.metadata || {};
const eventBelongsToIabt = (config, metadata) =>
  String(metadata?.iabt_app_id || metadata?.base44_app_id || "") ===
  String(config.providers.stripe.metadataAppId);

const resolveUser = async (repository, object) => {
  const metadata = metadataFor(object);
  const userId = String(metadata.user_id || object?.client_reference_id || "");
  const email = String(
    metadata.user_email ||
    object?.customer_details?.email ||
    object?.customer_email ||
    ""
  ).trim().toLowerCase();
  const byId = userId ? await repository.getUser(userId) : null;
  const user = byId || (email ? await repository.findUserByEmail(email) : null);
  if (!user) {
    throw stripeError(
      422,
      "stripe_user_not_found",
      "The verified Stripe event does not identify an existing IABT user"
    );
  }
  if (email && user.email.toLowerCase() !== email) {
    throw stripeError(
      409,
      "stripe_user_mismatch",
      "Stripe user identity does not match the IABT account"
    );
  }
  return user;
};

const periodEnd = (subscription) => {
  const direct = Number(subscription?.current_period_end || 0);
  const itemEnds = (subscription?.items?.data || [])
    .map((item) => Number(item?.current_period_end || 0))
    .filter(Boolean);
  const seconds = direct || (itemEnds.length ? Math.max(...itemEnds) : 0);
  return seconds ? new Date(seconds * 1000).toISOString() : null;
};

const subscriptionPrice = (subscription) =>
  String(subscription?.items?.data?.[0]?.price?.id || "");

const entitlementStatus = (status) => {
  const value = String(status || "").toLowerCase();
  if (["active", "trialing", "past_due", "paused", "unpaid", "canceled"].includes(value)) {
    return value;
  }
  return value === "incomplete_expired" ? "canceled" : "inactive";
};

const upsertSubscription = async ({ repository, config, subscription }) => {
  const metadata = metadataFor(subscription);
  if (!eventBelongsToIabt(config, metadata)) {
    throw stripeError(409, "stripe_event_not_iabt", "Stripe event does not belong to this IABT app");
  }
  const user = await resolveUser(repository, subscription);
  const paidPlan = planForPrice(config.providers.stripe, subscriptionPrice(subscription));
  if (!paidPlan) {
    throw stripeError(
      503,
      "stripe_price_not_configured",
      "The Stripe subscription price is not mapped to an IABT plan"
    );
  }
  const status = entitlementStatus(subscription.status);
  const plan = ["active", "trialing", "past_due"].includes(status) ? paidPlan : "free";
  const defaults = planDefaults(plan);
  const existing = (
    await repository.listRecords("AccountEntitlement", user, {
      query: { user_id: user.id },
      sort: "-updated_date",
      limit: 1
    })
  )[0];
  const fields = {
    user_id: user.id,
    user_email: user.email,
    plan,
    status,
    billing_provider: "stripe",
    provider_customer_id:
      typeof subscription.customer === "string"
        ? subscription.customer
        : String(subscription.customer?.id || ""),
    provider_subscription_id: String(subscription.id || ""),
    current_period_end: periodEnd(subscription),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    ...defaults,
    bonus_ai_credits: Number(existing?.bonus_ai_credits || 0)
  };
  const entitlement = existing
    ? await repository.updateRecord("AccountEntitlement", existing.id, user, fields)
    : await repository.createRecord("AccountEntitlement", user, {
        ...fields,
        notes: "Created by verified standalone Stripe webhook"
      });
  return { user, entitlement, action: "subscription_entitlement_updated" };
};

const grantCreditPack = async ({ repository, config, event, session }) => {
  const metadata = metadataFor(session);
  if (!eventBelongsToIabt(config, metadata) || metadata.product_type !== "ai_credit_pack") {
    throw stripeError(409, "stripe_event_not_iabt", "Stripe credit event does not belong to IABT");
  }
  if (session.payment_status !== "paid") {
    throw stripeError(409, "stripe_payment_not_complete", "Stripe credit purchase is not paid");
  }
  const user = await resolveUser(repository, session);
  const credits = config.providers.stripe.creditPackSize;
  await repository.grantCredits({
    ownerId: user.id,
    amount: credits,
    idempotencyKey: "stripe:" + event.id,
    metadata: {
      event_id: event.id,
      checkout_session_id: String(session.id || ""),
      product_type: "ai_credit_pack"
    }
  });
  return { user, credits, action: "credit_pack_granted" };
};

const recordBillingEvent = async ({ repository, result, event }) => {
  if (!result?.user) return;
  await repository.createRecord("BillingEvent", result.user, {
    event_id: String(event.id),
    event_type: String(event.type),
    user_id: result.user.id,
    user_email: result.user.email,
    action: result.action,
    credits_granted: Number(result.credits || 0),
    processed_at: new Date().toISOString()
  });
};

export const processStripeWebhook = async ({
  rawBody,
  signatureHeader,
  repository,
  config,
  nowSeconds
}) => {
  const event = verifyStripeEvent({
    rawBody,
    signatureHeader,
    webhookSecret: config.providers.stripe.webhookSecret,
    nowSeconds
  });
  if (!/^evt_[a-zA-Z0-9_]+$/.test(String(event?.id || ""))) {
    throw stripeError(400, "stripe_event_invalid", "Stripe event ID is invalid");
  }
  const expectedLive = config.providers.stripe.mode === "live";
  if (Boolean(event.livemode) !== expectedLive) {
    throw stripeError(
      400,
      "stripe_mode_mismatch",
      "Stripe event mode does not match the configured billing mode"
    );
  }

  const eventType = String(event.type || "");
  const started = await repository.startStripeEvent({
    eventId: event.id,
    eventType,
    livemode: Boolean(event.livemode),
    payloadSha256: createHash("sha256").update(rawBody).digest("hex")
  });
  if (!started.claimed) {
    return {
      received: true,
      reused: true,
      type: eventType,
      action: started.event?.status || "already_received"
    };
  }

  try {
    const object = event?.data?.object || {};
    let result = { action: "ignored" };
    if (
      ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(eventType) &&
      metadataFor(object).product_type === "ai_credit_pack"
    ) {
      result = await grantCreditPack({ repository, config, event, session: object });
    } else if ([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed"
    ].includes(eventType)) {
      result = await upsertSubscription({ repository, config, subscription: object });
    }
    await recordBillingEvent({ repository, result, event });
    await repository.finishStripeEvent(event.id);
    return {
      received: true,
      reused: false,
      type: eventType,
      action: result.action,
      credits_granted: Number(result.credits || 0)
    };
  } catch (error) {
    await repository.failStripeEvent(event.id, error.code || "stripe_event_failed");
    throw error;
  }
};
