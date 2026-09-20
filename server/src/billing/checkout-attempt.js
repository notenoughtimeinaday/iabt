import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { billingRecordId } from "./fulfillment.js";

const error = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const entity = "BillingCheckoutAttempt"; // Deliberately outside generic entity routes.
const leaseMs = 45000;
const retryWindowMs = 23 * 60 * 60 * 1000;
const pending = () => error("stripe_checkout_pending", "Checkout preparation is still pending. Retry to resume the same purchase.", 503);
const reconcile = () => error("stripe_checkout_reconciliation_required", "The previous Checkout outcome needs reconciliation before another subscription can be created.");
const idOf = (value) => typeof value === "string" ? value : value?.id;

export const hasManagedSubscription = (entitlement) => entitlement?.billing_provider === "stripe" &&
  /^cus_[a-zA-Z0-9_]+$/.test(entitlement.provider_customer_id || "") &&
  /^sub_[a-zA-Z0-9_]+$/.test(entitlement.provider_subscription_id || "") &&
  !["canceled", "incomplete_expired"].includes(entitlement.status);

const readEntitlement = async (tx, owner) => (await tx.listRecordsExact("AccountEntitlement", owner, {
  query: { user_id: owner.id }, sort: "-updated_date", limit: 1
}))[0];

const publicCheckout = (row, reused) => ({ ok: true, kind: "checkout", url: row.url, session_id: row.session_id, expires_at: row.expires_at, reused });

function validateSession(session, row) {
  if (!/^cs_[a-zA-Z0-9_]+$/.test(session?.id || "") || row.session_id && session.id !== row.session_id ||
      session.mode !== "subscription" || session.livemode !== (row.mode === "live") ||
      session.client_reference_id !== row.user_id || !["open", "complete", "expired"].includes(session.status) ||
      !Number.isSafeInteger(session.expires_at) || session.expires_at !== Number(row.params.expires_at)) throw reconcile();
  for (const [key, value] of Object.entries(row.params)) {
    const metadata = /^metadata\[([^\]]+)\]$/.exec(key);
    if (metadata && session.metadata?.[metadata[1]] !== value) throw reconcile();
  }
  if (row.params.customer && idOf(session.customer) !== row.params.customer) throw reconcile();
  if (session.status === "open") {
    let url;
    try { url = new URL(session.url); } catch { throw reconcile(); }
    if (url.protocol !== "https:" || url.username || url.password || session.url.length > 8192) throw reconcile();
  }
  return { status: session.status, session_id: session.id, url: session.status === "open" ? session.url : null,
    expires_at: session.expires_at, subscription_id: idOf(session.subscription) || null };
}

// The transaction owns admission, not network I/O. Ambiguous requests retain
// the exact parameters and provider key. A caller-supplied request key cannot
// create another payable subscription while this account has a pending one.
export async function subscriptionCheckoutAttempt({ repository, user, config, plan, params, submit, retrieve, now = Date.now }) {
  const owner = { ...user, role: "user" };
  const mode = config.providers.stripe.mode === "live" ? "live" : "test";
  const appId = config.providers.stripe.metadataAppId;
  const recordId = billingRecordId(`subscription-checkout:${mode}:${owner.id}`);
  const credential = digest(config.providers.stripe.secretKey);
  const terms = digest(JSON.stringify({ mode, appId, plan, params }));
  let waiting = 0;
  for (let transitions = 0; transitions < 50; transitions += 1) {
    const claim = await repository.withRecordTransaction(async (tx) => {
      const entitlement = await readEntitlement(tx, owner);
      if (hasManagedSubscription(entitlement)) return { kind: "portal_required" };
      let row = await tx.getRecord(entity, recordId, owner);
      if (row && (row.owner_id !== owner.id || row.user_id !== owner.id || row.mode !== mode || row.app_id !== appId)) throw reconcile();
      const canceled = row?.status === "complete" && row.subscription_id &&
        entitlement?.provider_subscription_id === row.subscription_id && ["canceled", "incomplete_expired"].includes(entitlement.status);
      if (!row || ["expired", "rejected"].includes(row.status) || canceled) {
        const attemptId = randomUUID();
        // One minute of transmission margin above Stripe's 30 minute minimum.
        // This timestamp is frozen even if the POST must be retried.
        const frozen = { ...params, expires_at: String(Math.floor(now() / 1000) + 31 * 60),
          integration_identifier: "iabt-subscription-" + [...attemptId.replaceAll("-", "").slice(0, 8)].map((character) => String.fromCharCode(97 + parseInt(character, 16))).join(""),
          "metadata[checkout_attempt_id]": attemptId, "subscription_data[metadata][checkout_attempt_id]": attemptId };
        const fields = { user_id: owner.id, mode, app_id: appId, plan, price_id: params["line_items[0][price]"],
          terms_sha256: terms, credential_sha256: credential, attempt_id: attemptId, started_at_ms: now(),
          idempotency_key: "iabt:subscription-checkout:" + attemptId, params: frozen, status: "creating",
          lease_token: randomUUID(), lease_expires_at_ms: now() + leaseMs, session_id: null, url: null,
          expires_at: null, subscription_id: null };
        row = row ? await tx.updateRecord(entity, row.id, owner, fields) : await tx.createRecord(entity, owner, fields, { id: recordId });
        return { kind: "submit", row };
      }
      if (row.status === "complete") throw reconcile();
      if (!row.params || typeof row.params !== "object" || !Number.isSafeInteger(row.started_at_ms) ||
          typeof row.idempotency_key !== "string" || !row.idempotency_key.startsWith("iabt:subscription-checkout:") ||
          typeof row.attempt_id !== "string" || !["creating", "open", "uncertain"].includes(row.status)) throw reconcile();
      const sameTerms = row.terms_sha256 === terms && row.plan === plan && row.price_id === params["line_items[0][price]"];
      if (row.session_id && row.status === "open" && row.expires_at * 1000 > now() && sameTerms && row.credential_sha256 === credential &&
          !["canceled", "incomplete_expired"].includes(entitlement?.status)) {
        return { kind: "reuse", row };
      }
      if (row.lease_token && row.lease_expires_at_ms > now()) return { kind: "wait" };
      if (!row.session_id && (!sameTerms || row.credential_sha256 !== credential || now() - row.started_at_ms >= retryWindowMs)) throw reconcile();
      row = await tx.updateRecord(entity, row.id, owner, { lease_token: randomUUID(), lease_expires_at_ms: now() + leaseMs });
      return { kind: row.session_id ? "retrieve" : "submit", row, sameTerms };
    });
    if (claim.kind === "portal_required") return claim;
    if (claim.kind === "reuse") return publicCheckout(claim.row, true);
    if (claim.kind === "wait") {
      if (++waiting >= 40) throw pending();
      await delay(50);
      continue;
    }
    let session;
    try {
      session = claim.kind === "submit" ? await submit(claim.row.params, claim.row.idempotency_key) : await retrieve(claim.row.session_id);
      const validated = validateSession(session, claim.row);
      const saved = await repository.withRecordTransaction(async (tx) => {
        const row = await tx.getRecord(entity, recordId, owner);
        if (row?.attempt_id !== claim.row.attempt_id || row.lease_token !== claim.row.lease_token || row.lease_expires_at_ms <= now()) throw pending();
        return tx.updateRecord(entity, row.id, owner, { ...validated, credential_sha256: credential, lease_token: null, lease_expires_at_ms: null });
      });
      if (saved.status === "expired") continue;
      if (saved.status === "complete") continue; // Recheck authoritative entitlement.
      if (saved.expires_at * 1000 <= now()) throw reconcile(); // Local time never establishes provider expiry.
      if (saved.terms_sha256 !== terms) throw error("stripe_checkout_terms_conflict", "An existing Checkout uses another plan or price. Complete it or wait for Stripe-confirmed expiry before changing plans.");
      return publicCheckout(saved, claim.kind !== "submit");
    } catch (failure) {
      await repository.withRecordTransaction(async (tx) => {
        const row = await tx.getRecord(entity, recordId, owner);
        if (row?.attempt_id !== claim.row.attempt_id || row.lease_token !== claim.row.lease_token) return;
        // Only a definite Stripe request rejection permits a fresh attempt.
        // Transport errors, 5xx, parse failures and missing fields are ambiguous.
        const rejected = claim.kind === "submit" && !session &&
          ["stripe_invalid_request", "stripe_authentication_failed", "stripe_access_denied"].includes(failure.code) && [400, 401, 403].includes(failure.status);
        await tx.updateRecord(entity, row.id, owner, { ...(rejected ? { status: "rejected" } : row.session_id ? { status: "uncertain" } : {}), lease_token: null, lease_expires_at_ms: null });
      });
      if (["stripe_checkout_terms_conflict", "stripe_checkout_reconciliation_required", "stripe_checkout_pending"].includes(failure.code)) throw failure;
      throw error("stripe_checkout_unavailable", "Checkout could not be confirmed. Retry to reconcile the existing purchase attempt.", 503);
    }
  }
  throw pending();
}

export async function retrieveSubscriptionCheckout({ config, sessionId, fetchImpl = globalThis.fetch }) {
  const mode = config.providers.stripe.mode === "live" ? "live" : "test";
  const key = config.providers.stripe.secretKey;
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId) || !new RegExp(`^[sr]k_${mode}_`).test(key)) throw reconcile();
  try {
    const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions/" + sessionId, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: "Bearer " + key, "Stripe-Version": "2026-08-26.dahlia" }
    });
    if (!response.ok) throw reconcile();
    return await response.json();
  } catch { throw error("stripe_checkout_unavailable", "The existing Checkout could not be verified. Retry before starting another purchase.", 503); }
}
