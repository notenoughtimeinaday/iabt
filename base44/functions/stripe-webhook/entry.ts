import { createClientFromRequest } from "npm:@base44/sdk";
import {
  AI_CREDIT_PACK_SIZE,
  getPlanDefaults,
  getPlanForPriceId,
  getStripeMode,
  getStripeWebhookSecret,
  IABT_APP_ID,
  mapStripeStatus,
  stripeGet,
} from "../../shared/stripe.ts";

function secureEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyStripeSignature(payload, signatureHeader, secret) {
  const values = {};
  for (const part of String(signatureHeader || "").split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    values[key] = [...(values[key] || []), value];
  }

  const timestamp = Number(values.t?.[0]);
  const signatures = values.v1 || [];
  if (!Number.isFinite(timestamp) || !signatures.length) {
    throw new Error("Invalid Stripe signature header.");
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    throw new Error("Stripe webhook timestamp outside tolerance.");
  }

  const signedPayload = timestamp + "." + payload;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expected = Array.from(new Uint8Array(expectedBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (!signatures.some((signature) => secureEqualHex(expected, signature))) {
    throw new Error("Signature verification failed.");
  }
  return JSON.parse(payload);
}

function stringId(value) {
  if (typeof value === "string") return value;
  return value?.id ? String(value.id) : "";
}

function subscriptionPeriodEnd(subscription) {
  const direct = Number(subscription?.current_period_end || 0);
  if (direct) return new Date(direct * 1000).toISOString();
  const itemEnds = (subscription?.items?.data || [])
    .map((item) => Number(item?.current_period_end || 0))
    .filter(Boolean);
  return itemEnds.length ? new Date(Math.max(...itemEnds) * 1000).toISOString() : null;
}

function subscriptionPriceId(subscription) {
  return String(subscription?.items?.data?.[0]?.price?.id || "");
}

function subscriptionMetadata(subscription) {
  const metadata = subscription?.metadata || {};
  if (metadata.base44_app_id !== IABT_APP_ID) {
    throw new Error("Stripe event does not belong to this IABT app.");
  }
  return metadata;
}

async function findEntitlement(service, data) {
  const lookups = [
    ["provider_subscription_id", data.provider_subscription_id],
    ["provider_customer_id", data.provider_customer_id],
    ["user_id", data.user_id],
    ["user_email", data.user_email],
  ];
  for (const [field, value] of lookups) {
    if (!value) continue;
    const records = await service.entities.AccountEntitlement.filter(
      { [field]: value },
      "-updated_date",
      1,
    );
    if (records?.[0]) return records[0];
  }
  return null;
}

async function upsertSubscriptionEntitlement(base44, subscription) {
  const metadata = subscriptionMetadata(subscription);
  const priceId = subscriptionPriceId(subscription);
  const paidPlan = getPlanForPriceId(priceId);
  if (!paidPlan) {
    throw new Error("Stripe subscription price is not configured for an IABT plan.");
  }

  const status = mapStripeStatus(subscription.status);
  const active = status === "active" || status === "trialing";
  const plan = active || status === "past_due" ? paidPlan : "free";
  const customerId = stringId(subscription.customer);
  let email = String(metadata.user_email || "").trim();

  if (!email && customerId) {
    const customer = await stripeGet("/customers/" + encodeURIComponent(customerId));
    email = String(customer?.email || "").trim();
  }

  const data = {
    user_id: String(metadata.user_id || "").trim(),
    user_email: email,
    plan,
    status,
    provider_customer_id: customerId,
    provider_subscription_id: String(subscription.id || "").trim(),
    current_period_end: subscriptionPeriodEnd(subscription),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  };

  const service = base44.asServiceRole;
  const existing = await findEntitlement(service, data);
  if (!existing && (!data.user_id || !data.user_email)) {
    throw new Error("Stripe subscription is missing the authenticated IABT user identity.");
  }

  const defaults = getPlanDefaults(plan);
  const fields = {
    user_id: data.user_id || existing?.user_id,
    user_email: data.user_email || existing?.user_email,
    plan,
    status,
    billing_provider: "stripe",
    provider_customer_id: data.provider_customer_id || existing?.provider_customer_id,
    provider_subscription_id: data.provider_subscription_id || existing?.provider_subscription_id,
    current_period_end: data.current_period_end || existing?.current_period_end,
    cancel_at_period_end: data.cancel_at_period_end,
    ai_hourly_limit: defaults.ai_hourly_limit,
    ai_monthly_limit: defaults.ai_monthly_limit,
    bonus_ai_credits: Number(existing?.bonus_ai_credits || 0),
    project_limit: defaults.project_limit,
    static_zip_export_enabled: defaults.static_zip_export_enabled,
    react_export_enabled: defaults.react_export_enabled,
    commercial_use_enabled: defaults.commercial_use_enabled,
    white_label_exports_enabled: defaults.white_label_exports_enabled,
    team_seat_limit: defaults.team_seat_limit,
  };

  if (existing) {
    return service.entities.AccountEntitlement.update(existing.id, fields);
  }
  return service.entities.AccountEntitlement.create({
    ...fields,
    notes: "Created by verified Stripe webhook",
  });
}

async function processSubscriptionId(base44, subscriptionId) {
  if (!subscriptionId) return;
  const subscription = await stripeGet(
    "/subscriptions/" + encodeURIComponent(subscriptionId) + "?expand[]=items.data.price",
  );
  await upsertSubscriptionEntitlement(base44, subscription);
}

function invoiceSubscriptionId(invoice) {
  return (
    stringId(invoice?.subscription) ||
    stringId(invoice?.parent?.subscription_details?.subscription) ||
    stringId(invoice?.subscription_details?.subscription)
  );
}

async function grantAiCreditPack(base44, eventId, eventType, session) {
  const metadata = session?.metadata || {};
  if (metadata.base44_app_id !== IABT_APP_ID || metadata.product_type !== "ai_credit_pack") {
    throw new Error("Credit checkout does not belong to this IABT app.");
  }
  if (session?.payment_status !== "paid") {
    throw new Error("AI credit checkout is not paid.");
  }

  const service = base44.asServiceRole;
  const checkoutSessionId = String(session?.id || "").trim();
  if (!checkoutSessionId.startsWith("cs_")) {
    throw new Error("AI credit checkout is missing its Stripe Checkout Session ID.");
  }
  const processedSession = await service.entities.BillingEvent.filter(
    { checkout_session_id: checkoutSessionId },
    "-created_date",
    1,
  );
  if (Number(processedSession?.[0]?.credits_granted || 0) >= AI_CREDIT_PACK_SIZE) return;
  const processedEvent = await service.entities.BillingEvent.filter(
    { event_id: eventId },
    "-created_date",
    1,
  );
  if (Number(processedEvent?.[0]?.credits_granted || 0) >= AI_CREDIT_PACK_SIZE) return;

  const userId = String(metadata.user_id || session?.client_reference_id || "").trim();
  const userEmail = String(metadata.user_email || session?.customer_details?.email || "").trim();
  if (!userId || !userEmail) {
    throw new Error("AI credit checkout is missing the authenticated IABT user identity.");
  }

  const eventRecord = await service.entities.BillingEvent.create({
    event_id: eventId,
    event_type: eventType,
    checkout_session_id: checkoutSessionId,
    user_id: userId,
    user_email: userEmail,
    product_type: "ai_credit_pack",
    credits_granted: 0,
    processed_at: new Date().toISOString(),
  });

  try {
    const existing = await findEntitlement(service, { user_id: userId, user_email: userEmail });
    if (existing) {
      await service.entities.AccountEntitlement.updateMany(
        { id: existing.id },
        { $inc: { bonus_ai_credits: AI_CREDIT_PACK_SIZE } },
      );
    } else {
      const defaults = getPlanDefaults("free");
      await service.entities.AccountEntitlement.create({
        user_id: userId,
        user_email: userEmail,
        plan: "free",
        status: "active",
        billing_provider: "none",
        ...defaults,
        bonus_ai_credits: AI_CREDIT_PACK_SIZE,
        notes: "Created by verified Stripe AI credit-pack webhook",
      });
    }
    await service.entities.BillingEvent.update(eventRecord.id, {
      credits_granted: AI_CREDIT_PACK_SIZE,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    await service.entities.BillingEvent.delete(eventRecord.id).catch(() => {});
    throw error;
  }
}

export default async function(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const secret = getStripeWebhookSecret();
    if (!secret.startsWith("whsec_")) {
      console.error("stripe-webhook: signing secret not configured");
      return Response.json({ error: "Webhook not configured." }, { status: 500 });
    }

    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Stripe-Signature") || "";
    let event;
    try {
      event = await verifyStripeSignature(rawBody, signatureHeader, secret);
    } catch (error) {
      console.error("stripe-webhook signature verification failed:", error?.message || error);
      return Response.json({ error: "Invalid signature." }, { status: 400 });
    }

    const stripeMode = getStripeMode();
    const expectsLiveEvent = stripeMode === "live";
    if (Boolean(event?.livemode) !== expectsLiveEvent) {
      console.error(`stripe-webhook: ${event?.livemode ? "live" : "test"} event rejected while billing mode is ${stripeMode}`);
      return Response.json({ error: "Stripe event mode does not match configured billing mode." }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const type = String(event?.type || "");
    const data = event?.data?.object || {};

    if (
      type === "checkout.session.completed" ||
      type === "checkout.session.async_payment_succeeded"
    ) {
      if (data?.metadata?.base44_app_id !== IABT_APP_ID) {
        throw new Error("Checkout session does not belong to this IABT app.");
      }
      if (data?.metadata?.product_type === "ai_credit_pack") {
        if (data?.payment_status === "paid") {
          await grantAiCreditPack(base44, String(event.id || ""), type, data);
        }
      } else if (type === "checkout.session.completed") {
        await processSubscriptionId(base44, stringId(data.subscription));
      }
    } else if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted" ||
      type === "customer.subscription.paused" ||
      type === "customer.subscription.resumed"
    ) {
      await upsertSubscriptionEntitlement(base44, data);
    } else if (type === "invoice.paid" || type === "invoice.payment_failed") {
      await processSubscriptionId(base44, invoiceSubscriptionId(data));
    }

    return Response.json({ received: true, type });
  } catch (error) {
    console.error("stripe-webhook error:", error?.message || error);
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
