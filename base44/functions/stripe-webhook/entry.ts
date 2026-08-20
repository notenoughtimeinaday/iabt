import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { secrets } from "base44:runtime";
import { getPlanDefaults, mapStripeStatus, stripeGet } from "../../shared/stripe.ts";

async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parts = {};
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=");
    parts[key] = value;
  }
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) throw new Error("Invalid Stripe signature header.");

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) throw new Error("Stripe webhook timestamp outside tolerance.");

  const signedPayload = timestamp + "." + payload;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(expectedBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signature.length) throw new Error("Signature length mismatch.");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) throw new Error("Signature verification failed.");

  return JSON.parse(payload);
}

async function findEntitlement(service, { email, subscriptionId, customerId }) {
  if (email) {
    const byEmail = await service.entities.AccountEntitlement.filter({ user_email: email }, "-updated_date", 5);
    if (byEmail?.[0]) return byEmail[0];
  }
  if (subscriptionId) {
    const bySub = await service.entities.AccountEntitlement.filter({ provider_subscription_id: subscriptionId }, "-updated_date", 5);
    if (bySub?.[0]) return bySub[0];
  }
  if (customerId) {
    const byCust = await service.entities.AccountEntitlement.filter({ provider_customer_id: customerId }, "-updated_date", 5);
    if (byCust?.[0]) return byCust[0];
  }
  return null;
}

async function upsertEntitlement(base44, data) {
  const service = base44.asServiceRole;
  const existing = await findEntitlement(service, {
    email: data.user_email,
    subscriptionId: data.provider_subscription_id,
    customerId: data.provider_customer_id,
  });
  const defaults = getPlanDefaults(data.plan || (existing?.plan) || "free");

  const fields = {
    plan: data.plan || existing?.plan || "free",
    status: data.status || existing?.status || "active",
    billing_provider: "stripe",
    provider_customer_id: data.provider_customer_id || existing?.provider_customer_id,
    provider_subscription_id: data.provider_subscription_id || existing?.provider_subscription_id,
    current_period_end: data.current_period_end || existing?.current_period_end,
    cancel_at_period_end: data.cancel_at_period_end ?? existing?.cancel_at_period_end ?? false,
    ai_hourly_limit: defaults.ai_hourly_limit,
    project_limit: defaults.project_limit,
    react_export_enabled: defaults.react_export_enabled,
  };

  if (existing) {
    return service.entities.AccountEntitlement.update(existing.id, fields);
  }
  return service.entities.AccountEntitlement.create({
    user_id: data.user_id || data.user_email,
    user_email: data.user_email,
    ...fields,
    notes: "Created by Stripe webhook",
  });
}

async function downgradeToFree(base44, subscriptionId) {
  const service = base44.asServiceRole;
  const records = await service.entities.AccountEntitlement.filter(
    { provider_subscription_id: subscriptionId },
    "-updated_date",
    5,
  );
  if (!records?.[0]) return;
  await service.entities.AccountEntitlement.update(records[0].id, {
    status: "canceled",
    plan: "free",
    cancel_at_period_end: false,
    ai_hourly_limit: 5,
    project_limit: 3,
    react_export_enabled: false,
  });
}

async function setSubscriptionStatus(base44, subscriptionId, patch) {
  const service = base44.asServiceRole;
  const records = await service.entities.AccountEntitlement.filter(
    { provider_subscription_id: subscriptionId },
    "-updated_date",
    5,
  );
  if (!records?.[0]) return;
  await service.entities.AccountEntitlement.update(records[0].id, patch);
}

function isoFromTimestamp(ts) {
  if (!ts) return null;
  return new Date(ts * 1000).toISOString();
}

export default async function(req: Request): Promise<Response> {
  // Create the base44 client up front (reads request headers) before signature validation.
  const base44 = createClientFromRequest(req);
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const secret = secrets.get("STRIPE_WEBHOOK_SECRET");
    if (!secret) {
      console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET not configured");
      return Response.json({ error: "Webhook not configured." }, { status: 500 });
    }

    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Stripe-Signature") || "";

    let event;
    try {
      event = await verifyStripeSignature(rawBody, signatureHeader, secret);
    } catch (err) {
      console.error("stripe-webhook signature verification failed:", err?.message || err);
      return Response.json({ error: "Invalid signature." }, { status: 400 });
    }

    const type = event.type;
    const data = event.data?.object || {};
    console.log("stripe-webhook received:", type);

    if (type === "checkout.session.completed") {
      const plan = data.metadata?.plan || "free";
      const email = data.metadata?.user_email || data.customer_email || data.customer_details?.email;
      const userId = data.metadata?.user_id || null;
      await upsertEntitlement(base44, {
        user_id: userId,
        user_email: email,
        plan,
        status: "active",
        provider_customer_id: data.customer,
        provider_subscription_id: data.subscription,
        current_period_end: isoFromTimestamp(data.current_period_end),
        cancel_at_period_end: false,
      });
    } else if (type === "customer.subscription.created" || type === "customer.subscription.updated") {
      const plan = data.metadata?.plan || "builder";
      const customerId = data.customer;
      let email = data.metadata?.user_email || null;
      if (!email && customerId) {
        try {
          const customer = await stripeGet("/customers/" + customerId);
          email = customer?.email || null;
        } catch (err) {
          console.error("stripe-webhook: failed to fetch customer:", err?.message || err);
        }
      }
      await upsertEntitlement(base44, {
        user_id: data.metadata?.user_id || null,
        user_email: email,
        plan,
        status: mapStripeStatus(data.status),
        provider_customer_id: customerId,
        provider_subscription_id: data.id,
        current_period_end: isoFromTimestamp(data.current_period_end),
        cancel_at_period_end: data.cancel_at_period_end ?? false,
      });
    } else if (type === "customer.subscription.deleted") {
      await downgradeToFree(base44, data.id);
    } else if (type === "invoice.paid") {
      if (data.subscription) {
        await setSubscriptionStatus(base44, data.subscription, {
          status: "active",
          current_period_end: isoFromTimestamp(data.period_end),
        });
      }
    } else if (type === "invoice.payment_failed") {
      if (data.subscription) {
        await setSubscriptionStatus(base44, data.subscription, { status: "past_due" });
      }
    }

    return Response.json({ received: true, type });
  } catch (error) {
    console.error("stripe-webhook error:", error?.message || error);
    return Response.json({ error: error?.message || "Webhook handler failed." }, { status: 500 });
  }
}