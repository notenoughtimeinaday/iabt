import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { planDefaults, planForPrice } from "./plans.js";
import { billingRecordId, fulfillCredits } from "./fulfillment.js";
import { retrieveStripeSubscription } from "./stripe-read.js";

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
  const user = userId ? byId : (email ? await repository.findUserByEmail(email) : null);
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
  if (["active", "trialing", "past_due", "paused", "unpaid", "incomplete", "canceled"].includes(value)) {
    return value;
  }
  return value === "incomplete_expired" ? "canceled" : "inactive";
};

const idOf = (value) => typeof value === "string" ? value : String(value?.id || "");
const ownerEntitlement = async (repository, user) => (await repository.listRecordsExact("AccountEntitlement", { ...user, role: "user" }, {
  query: { user_id: user.id }, sort: "-updated_date", limit: 1
}))[0];

const upsertSubscription = async ({ repository, config, subscription: snapshot, fetchImpl }) => {
  if (!eventBelongsToIabt(config, metadataFor(snapshot))) {
    return { action: "ignored_other_app" };
  }
  const user = await resolveUser(repository, snapshot);
  const owner = { ...user, role: "user" };
  const subscriptionId = String(snapshot.id || "");
  if (!/^sub_[a-zA-Z0-9_]+$/.test(subscriptionId)) throw stripeError(422, "stripe_subscription_invalid", "Stripe subscription identity is invalid");
  // Stripe snapshots are unordered (even event.created can tie). Claim a local
  // generation, then retrieve current provider state outside the transaction.
  // A slower earlier GET cannot overwrite a newer reconciliation's result.
  const claim = await repository.withRecordTransaction(async (tx) => {
    const id = billingRecordId(`stripe-sync:${config.providers.stripe.mode}:${subscriptionId}`);
    const existing = await tx.getRecord("BillingSubscriptionSync", id, owner);
    const revision = Number(existing?.revision || 0) + 1;
    if (existing) await tx.updateRecord("BillingSubscriptionSync", id, owner, { revision });
    else await tx.createRecord("BillingSubscriptionSync", owner, { user_id: user.id, subscription_id: subscriptionId, revision }, { id });
    return { id, revision };
  });
  const subscription = await retrieveStripeSubscription({ config, subscriptionId, fetchImpl });
  const metadata = metadataFor(subscription);
  if (!eventBelongsToIabt(config, metadata)) {
    throw stripeError(409, "stripe_event_not_iabt", "Stripe event does not belong to this IABT app");
  }
  const reconciledUser = await resolveUser(repository, subscription);
  if (reconciledUser.id !== user.id) throw stripeError(409, "stripe_user_mismatch", "Stripe subscription owner changed during verification");
  const paidPlan = planForPrice(config.providers.stripe, subscriptionPrice(subscription));
  const status = entitlementStatus(subscription.status);
  const grantsPlan = ["active", "trialing", "past_due"].includes(status);
  if (!paidPlan && grantsPlan) {
    throw stripeError(
      503,
      "stripe_price_not_configured",
      "The Stripe subscription price is not mapped to an IABT plan"
    );
  }
  const plan = grantsPlan ? paidPlan : "free";
  const defaults = planDefaults(plan);
  return repository.withRecordTransaction(async (tx) => {
    const sync = await tx.getRecord("BillingSubscriptionSync", claim.id, owner);
    if (sync.revision !== claim.revision) return { user, action: "subscription_sync_superseded" };
    const existing = await ownerEntitlement(tx, user);
    if (existing?.provider_subscription_id && existing.provider_subscription_id !== subscriptionId &&
        !["canceled", "inactive"].includes(existing.status)) {
      // Old subscription cancellation must not revoke a newer subscription.
      if (["canceled", "inactive"].includes(status)) return { user, action: "ignored_other_subscription" };
      throw stripeError(409, "stripe_subscription_conflict", "Multiple subscriptions require billing reconciliation");
    }
    if (existing?.provider_customer_id && existing.provider_customer_id !== idOf(subscription.customer)) {
      throw stripeError(409, "stripe_customer_mismatch", "Stripe customer does not match this account");
    }
    const fields = {
      user_id: user.id,
      user_email: user.email,
      plan,
      status,
      billing_provider: "stripe",
      provider_customer_id: idOf(subscription.customer),
      provider_subscription_id: String(subscription.id || ""),
      current_period_end: periodEnd(subscription),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      ...defaults,
      bonus_ai_credits: Number(existing?.bonus_ai_credits || 0)
    };
    const entitlement = existing
      ? await tx.updateRecord("AccountEntitlement", existing.id, owner, fields)
      : await tx.createRecord("AccountEntitlement", owner, fields);
    return { user, entitlement, action: "subscription_entitlement_updated" };
  });
};

const grantCreditPack = async ({ repository, config, event, session }) => {
  const metadata = metadataFor(session);
  if (!eventBelongsToIabt(config, metadata) || metadata.product_type !== "ai_credit_pack") {
    throw stripeError(409, "stripe_event_not_iabt", "Stripe credit event does not belong to IABT");
  }
  if (session.payment_status === "unpaid") return { action: "credit_pack_payment_pending" };
  if (session.mode !== "payment" || session.payment_status !== "paid" || !/^cs_[a-zA-Z0-9_]+$/.test(String(session.id || ""))) {
    throw stripeError(422, "stripe_payment_not_complete", "Stripe credit purchase has no verified completed payment");
  }
  const user = await resolveUser(repository, session);
  const amount = Number(metadata.credits);
  if (!/^\d+$/.test(String(metadata.credits || "")) || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) {
    throw stripeError(422, "stripe_credit_quantity_invalid", "Stripe credit purchase quantity requires reconciliation");
  }
  const credits = await fulfillCredits({
    repository, user, amount, key: `stripe:${config.providers.stripe.mode}:checkout:${session.id}`,
    source: {
      event_id: event.id,
      checkout_session_id: String(session.id || ""),
      product_type: "ai_credit_pack"
    }
  });
  return { user, credits, action: "credit_pack_granted" };
};

const grantSubscriptionCredits = async ({ repository, config, event, invoice }) => {
  const details = invoice.parent?.subscription_details || invoice.subscription_details || {};
  const metadata = details.metadata || {};
  if (!eventBelongsToIabt(config, metadata)) return { action: "ignored_other_app" };
  if (invoice.status !== "paid" || !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason)) {
    return { action: "subscription_invoice_no_allowance" };
  }
  const subscriptionId = idOf(details.subscription || invoice.subscription);
  if (!/^in_[a-zA-Z0-9_]+$/.test(String(invoice.id || "")) || !/^sub_[a-zA-Z0-9_]+$/.test(subscriptionId)) {
    throw stripeError(422, "stripe_invoice_invalid", "Stripe invoice identity is invalid");
  }
  if (invoice.lines?.has_more) throw stripeError(422, "stripe_invoice_incomplete", "Stripe invoice lines require reconciliation");
  const lines = (invoice.lines?.data || []).filter((line) =>
    (line.type === "subscription" || line.parent?.type === "subscription_item_details") &&
    !(line.proration ?? line.parent?.subscription_item_details?.proration));
  const eligible = lines.filter((line) => Number(line.amount) > 0);
  if (!eligible.length && lines.length) return { action: "subscription_invoice_no_allowance" }; // trial
  if (eligible.length !== 1) throw stripeError(422, "stripe_invoice_plan_ambiguous", "Stripe invoice must identify one monthly plan");
  const line = eligible[0];
  const plan = planForPrice(config.providers.stripe, idOf(line.price || line.pricing?.price_details?.price));
  const start = Number(line.period?.start);
  const end = Number(line.period?.end);
  const days = (end - start) / 86400;
  const lineSubscription = idOf(line.subscription || line.parent?.subscription_item_details?.subscription);
  if (!plan || line.quantity !== 1 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || days < 27 || days > 32 ||
      (lineSubscription && lineSubscription !== subscriptionId)) {
    throw stripeError(422, "stripe_invoice_plan_invalid", "Stripe invoice does not match a supported monthly IABT plan");
  }
  const user = await resolveUser(repository, { metadata });
  const existing = await ownerEntitlement(repository, user);
  if (existing?.provider_customer_id && existing.provider_customer_id !== idOf(invoice.customer)) {
    throw stripeError(409, "stripe_customer_mismatch", "Stripe invoice customer does not match this account");
  }
  const credits = await fulfillCredits({
    repository, user, amount: planDefaults(plan).ai_monthly_limit,
    key: `stripe:${config.providers.stripe.mode}:cycle:${subscriptionId}:${start}`,
    source: { event_id: event.id, invoice_id: invoice.id, subscription_id: subscriptionId, plan,
      period_start: start, period_end: end, product_type: "subscription_allowance" }
  });
  return { user, credits, action: "subscription_credits_granted" };
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
  }, { id: billingRecordId("billing-event:" + event.id) });
};

export const processStripeWebhook = async ({
  rawBody,
  signatureHeader,
  repository,
  config,
  nowSeconds,
  fetchImpl
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
    if (started.event?.status !== "succeeded") {
      // A 2xx stops Stripe retrying. Only a completed event may be acknowledged;
      // a live or interrupted processing claim must be retried until reclaimable.
      throw Object.assign(stripeError(503, "stripe_event_processing", "Stripe event processing is still pending; retry delivery"), { retryable: true });
    }
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
      result = await upsertSubscription({ repository, config, subscription: object, fetchImpl });
    } else if (eventType === "invoice.paid") {
      result = await grantSubscriptionCredits({ repository, config, event, invoice: object });
    }
    await recordBillingEvent({ repository, result, event });
    const finished = await repository.finishStripeEvent(event.id, { claimToken: started.event.claim_token });
    if (!finished) throw Object.assign(stripeError(503, "stripe_event_claim_lost", "Stripe event processing must be retried"), { retryable: true });
    return {
      received: true,
      reused: false,
      type: eventType,
      action: result.action,
      credits_granted: Number(result.credits || 0)
    };
  } catch (error) {
    await repository.failStripeEvent(event.id, error.code || "stripe_event_failed", { claimToken: started.event.claim_token });
    throw error;
  }
};
