import { createHash } from "node:crypto";
import { planDefaults } from "./plans.js";
import { ensureBillingEnvironment } from "./environment.js";

const tiers = ["builder", "pro", "agency"];
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 503 }); };
const invalid = () => fail("billing_catalog_invalid", "Stripe price catalog is invalid or ambiguous. Each monthly price must have one immutable version, tier and credit allowance.");
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, allowed) => plain(value) && Object.keys(value).every((key) => allowed.includes(key));

export const normalizePriceContract = (input) => {
  if (!plain(input) || typeof input.price_id !== "string" || !/^price_[a-zA-Z0-9_]{1,240}$/.test(input.price_id) || !tiers.includes(input.plan) ||
      typeof input.catalog_version !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(input.catalog_version) ||
      !Number.isSafeInteger(input.monthly_credits) || input.monthly_credits < 1 || input.monthly_credits > 1000000 ||
      input.interval !== "month") invalid();
  const fields = { price_id: input.price_id, plan: input.plan, catalog_version: input.catalog_version,
    monthly_credits: input.monthly_credits, interval: "month" };
  return Object.freeze({ ...fields, contract_sha256: createHash("sha256").update(JSON.stringify(fields)).digest("hex") });
};

export const validatePriceContracts = (contracts) => {
  if (!Array.isArray(contracts) || contracts.length > 103) invalid();
  const normalized = contracts.map(normalizePriceContract);
  if (new Set(normalized.map((item) => item.price_id)).size !== normalized.length) invalid();
  return normalized;
};

export const assertSamePriceContract = (existing, proposed) => {
  if (normalizePriceContract(existing).contract_sha256 !== normalizePriceContract(proposed).contract_sha256) {
    fail("billing_price_contract_conflict", "A Stripe price already has different billing terms. Keep its original contract and use a new verified price for a new offer.");
  }
};

// Existing environment price IDs always retain their original allowances. A new
// offer is additive and explicit; it cannot replace a legacy price's contract.
export const loadStripePriceCatalog = ({ legacyPrices, creditPackPriceId, json }) => {
  const contracts = tiers.filter((plan) => legacyPrices[plan]).map((plan) => normalizePriceContract({
    price_id: legacyPrices[plan], plan, catalog_version: "legacy-v1", monthly_credits: planDefaults(plan).ai_monthly_limit, interval: "month"
  }));
  const prices = { ...legacyPrices };
  if (json) {
    if (typeof json !== "string" || json.length > 32768) invalid();
    let catalog;
    try { catalog = JSON.parse(json); } catch { invalid(); }
    if (!exactKeys(catalog, ["version", "prices", "checkout"]) || catalog.version === "legacy-v1" ||
        typeof catalog.version !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(catalog.version) ||
        !Array.isArray(catalog.prices) || !catalog.prices.length || catalog.prices.length > 100 ||
        (catalog.checkout !== undefined && !exactKeys(catalog.checkout, tiers))) invalid();
    for (const price of catalog.prices) {
      if (!exactKeys(price, ["price_id", "plan", "monthly_credits", "catalog_version"]) || price.catalog_version === "legacy-v1") invalid();
      // The default version applies only to new definitions. Keep an earlier
      // entry's explicit version when another tier moves to a later offer.
      contracts.push(normalizePriceContract({ ...price, catalog_version: price.catalog_version === undefined ? catalog.version : price.catalog_version, interval: "month" }));
    }
    for (const [plan, priceId] of Object.entries(catalog.checkout || {})) {
      if (typeof priceId !== "string" || !contracts.some((item) => item.price_id === priceId && item.plan === plan)) invalid();
      prices[plan] = priceId;
    }
  }
  const normalized = validatePriceContracts(contracts);
  if (creditPackPriceId && normalized.some((item) => item.price_id === creditPackPriceId)) invalid();
  return { prices: Object.freeze(prices), contracts: Object.freeze(normalized) };
};

export const ensureBillingPriceCatalog = async ({ repository, config }) => {
  await ensureBillingEnvironment({ repository, config });
  const stripe = config.providers.stripe;
  if (typeof repository.registerBillingPriceContracts !== "function" || typeof repository.getBillingPriceContract !== "function") {
    fail("billing_price_registry_unavailable", "Durable Stripe price contract protection is unavailable.");
  }
  const contracts = validatePriceContracts(stripe.priceContracts || []);
  for (const [plan, priceId] of Object.entries(stripe.prices || {})) {
    if (priceId && !contracts.some((contract) => contract.price_id === priceId && contract.plan === plan)) invalid();
  }
  await repository.registerBillingPriceContracts({ mode: stripe.mode, contracts });
};

export const resolvePriceContract = async ({ repository, config, priceId }) => {
  if (!/^price_[a-zA-Z0-9_]{1,240}$/.test(String(priceId || ""))) return null;
  const stored = await repository.getBillingPriceContract({ mode: config.providers.stripe.mode, priceId });
  return stored ? normalizePriceContract(stored) : null;
};
