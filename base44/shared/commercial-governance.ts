export const COMMERCIAL_POLICY_VERSION = "iabt-commercial-2026-08-24.1";

export const DEFAULT_COMMERCIAL_POLICY = {
  policy_id: "default-paid-production",
  provider_id: "*",
  capability_id: "*",
  status: "active",
  pricing_version: COMMERCIAL_POLICY_VERSION,
  retail_credit_value_cents: 10,
  provider_cost_per_credit_cents: 3,
  target_margin_bps: 7000,
  minimum_margin_bps: 6000,
  maximum_job_cost_cents: 500,
  daily_spend_limit_cents: 2500,
  monthly_spend_limit_cents: 10000,
  purchased_credits_required: true,
};

function nonNegativeInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function periodKeys(now = new Date()) {
  const iso = now.toISOString();
  return { day_key: iso.slice(0, 10), month_key: iso.slice(0, 7) };
}

function approvedAgreement(agreement: any) {
  return Boolean(
    agreement &&
    ["standard_terms_approved", "contract_approved"].includes(String(agreement.status || "")) &&
    agreement.embedded_use_allowed === true &&
    agreement.white_label_allowed === true &&
    agreement.commercial_output_allowed === true &&
    agreement.customer_data_allowed === true &&
    ["accepted", "not_required"].includes(String(agreement.dpa_status || "")),
  );
}

export async function getProviderAgreement(base44: any, providerId: string) {
  const records = await base44.asServiceRole.entities.ProviderAgreement.filter(
    { provider_id: providerId },
    "-updated_date",
    10,
  );
  return records?.[0] || null;
}

export async function getCommercialPolicy(base44: any, providerId: string, capabilityId: string) {
  const records = await base44.asServiceRole.entities.CommercialPolicy.filter(
    { provider_id: providerId, capability_id: capabilityId, status: "active" },
    "-updated_date",
    10,
  );
  const record = records?.[0];
  if (!record) return { ...DEFAULT_COMMERCIAL_POLICY, provider_id: providerId, capability_id: capabilityId };
  return {
    ...DEFAULT_COMMERCIAL_POLICY,
    ...record,
    provider_id: providerId,
    capability_id: capabilityId,
  };
}

async function providerSpend(base44: any, providerId: string) {
  const service = base44.asServiceRole;
  const keys = periodKeys();
  const [daily, monthly] = await Promise.all([
    service.entities.ProviderSpendLedger.filter(
      { provider_id: providerId, day_key: keys.day_key },
      "-occurred_at",
      1000,
    ),
    service.entities.ProviderSpendLedger.filter(
      { provider_id: providerId, month_key: keys.month_key },
      "-occurred_at",
      1000,
    ),
  ]);
  const total = (records: any[]) => (records || []).reduce((sum, record) => {
    if (record.status === "reversed" || record.event_type === "refunded") return sum;
    return sum + nonNegativeInteger(record.amount_cents);
  }, 0);
  return {
    ...keys,
    daily_committed_cents: total(daily),
    monthly_committed_cents: total(monthly),
  };
}

export async function evaluateCommercialExecution(
  base44: any,
  input: {
    provider: string;
    capabilityId: string;
    providerCostCents: number;
    creditCost: number;
  },
) {
  const providerId = String(input.provider || "");
  const capabilityId = String(input.capabilityId || "");
  const providerCostCents = nonNegativeInteger(input.providerCostCents);
  const creditCost = Math.max(1, nonNegativeInteger(input.creditCost, 1));

  if (providerCostCents === 0 || providerId === "iabt-preproduction") {
    return {
      allowed: true,
      paid_provider: false,
      policy: { ...DEFAULT_COMMERCIAL_POLICY, provider_id: providerId, capability_id: capabilityId },
      margin: {
        estimated_retail_value_cents: creditCost * DEFAULT_COMMERCIAL_POLICY.retail_credit_value_cents,
        provider_cost_cents: 0,
        estimated_margin_bps: 10000,
        target_met: true,
        floor_met: true,
      },
      agreement: null,
      spend: { ...periodKeys(), daily_committed_cents: 0, monthly_committed_cents: 0 },
      blockers: [],
    };
  }

  const [policy, agreement, spend] = await Promise.all([
    getCommercialPolicy(base44, providerId, capabilityId),
    getProviderAgreement(base44, providerId),
    providerSpend(base44, providerId),
  ]);
  const estimatedRetailValue = creditCost * nonNegativeInteger(policy.retail_credit_value_cents, 10);
  const estimatedMarginBps = estimatedRetailValue > 0
    ? Math.floor(((estimatedRetailValue - providerCostCents) / estimatedRetailValue) * 10000)
    : -1;
  const blockers: string[] = [];
  const requiredCredits = Math.max(
    1,
    Math.ceil(providerCostCents / Math.max(1, nonNegativeInteger(policy.provider_cost_per_credit_cents, 3))),
  );

  if (!approvedAgreement(agreement)) blockers.push("provider_agreement_not_approved");
  if (creditCost < requiredCredits) blockers.push("quote_below_policy_rate");
  if (providerCostCents > nonNegativeInteger(policy.maximum_job_cost_cents, 500)) {
    blockers.push("provider_job_cost_limit");
  }
  if (estimatedMarginBps < nonNegativeInteger(policy.minimum_margin_bps, 6000)) {
    blockers.push("minimum_margin_not_met");
  }
  if (
    spend.daily_committed_cents + providerCostCents >
    nonNegativeInteger(policy.daily_spend_limit_cents, 2500)
  ) {
    blockers.push("daily_provider_spend_limit");
  }
  if (
    spend.monthly_committed_cents + providerCostCents >
    nonNegativeInteger(policy.monthly_spend_limit_cents, 10000)
  ) {
    blockers.push("monthly_provider_spend_limit");
  }

  return {
    allowed: blockers.length === 0,
    paid_provider: true,
    policy,
    margin: {
      estimated_retail_value_cents: estimatedRetailValue,
      provider_cost_cents: providerCostCents,
      estimated_margin_bps: estimatedMarginBps,
      target_met: estimatedMarginBps >= nonNegativeInteger(policy.target_margin_bps, 7000),
      floor_met: estimatedMarginBps >= nonNegativeInteger(policy.minimum_margin_bps, 6000),
      required_credits: requiredCredits,
    },
    agreement: agreement
      ? {
          provider_id: agreement.provider_id,
          display_name: agreement.display_name,
          status: agreement.status,
          embedded_use_allowed: agreement.embedded_use_allowed,
          white_label_allowed: agreement.white_label_allowed,
          commercial_output_allowed: agreement.commercial_output_allowed,
          customer_data_allowed: agreement.customer_data_allowed,
          dpa_status: agreement.dpa_status,
          billing_mode: agreement.billing_mode,
          reviewed_at: agreement.reviewed_at || null,
          next_review_at: agreement.next_review_at || null,
        }
      : null,
    spend,
    blockers,
  };
}

export function commercialBlockResponse(assessment: any) {
  const messages: Record<string, string> = {
    provider_agreement_not_approved: "The production supplier has not passed IABT commercial and privacy approval.",
    quote_below_policy_rate: "The quote no longer meets IABT production pricing policy.",
    provider_job_cost_limit: "This job exceeds the approved supplier cost ceiling.",
    minimum_margin_not_met: "This job does not meet IABT's minimum commercial margin.",
    daily_provider_spend_limit: "IABT's daily supplier spending limit has been reached.",
    monthly_provider_spend_limit: "IABT's monthly supplier spending limit has been reached.",
  };
  const first = String(assessment?.blockers?.[0] || "");
  return new Response(JSON.stringify({
    error: messages[first] || "Paid production is not commercially approved.",
    code: first || "commercial_policy_block",
    commercial_ready: false,
  }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
}

export async function recordProviderCommitment(base44: any, job: any, plan: any) {
  const providerId = String(job?.provider || plan?.provider || "");
  const amount = nonNegativeInteger(plan?.provider_cost_cents);
  if (!job?.id || !providerId || amount < 1) return null;
  const service = base44.asServiceRole;
  const eventId = "provider-commit:" + job.id;
  const existing = await service.entities.ProviderSpendLedger.filter(
    { event_id: eventId },
    "-occurred_at",
    1,
  );
  if (existing?.[0]) return existing[0];
  const now = new Date();
  const keys = periodKeys(now);
  return service.entities.ProviderSpendLedger.create({
    event_id: eventId,
    provider_id: providerId,
    capability_id: String(plan?.capability_id || ""),
    plan_id: String(plan?.id || ""),
    job_id: String(job.id),
    event_type: "committed",
    amount_cents: amount,
    currency: "USD",
    pricing_version: String(plan?.pricing_version || COMMERCIAL_POLICY_VERSION),
    day_key: keys.day_key,
    month_key: keys.month_key,
    status: "pending",
    occurred_at: now.toISOString(),
    description: "Supplier cost committed after the provider accepted an explicitly approved IABT production job.",
  });
}

export async function settleProviderCommitment(base44: any, job: any) {
  if (!job?.id) return null;
  const service = base44.asServiceRole;
  const records = await service.entities.ProviderSpendLedger.filter(
    { event_id: "provider-commit:" + job.id },
    "-occurred_at",
    1,
  );
  const commitment = records?.[0];
  if (!commitment || commitment.status === "settled") return commitment || null;
  return service.entities.ProviderSpendLedger.update(commitment.id, {
    event_type: "settled",
    status: "settled",
    description: "Supplier cost settled after IABT secured and verified the durable production artifact.",
  });
}

export async function commercialControlSnapshot(base44: any) {
  const service = base44.asServiceRole;
  const [agreements, policies, spend] = await Promise.all([
    service.entities.ProviderAgreement.list("-updated_date", 250),
    service.entities.CommercialPolicy.list("-updated_date", 250),
    service.entities.ProviderSpendLedger.list("-occurred_at", 1000),
  ]);
  const keys = periodKeys();
  const activeSpend = (spend || []).filter((item: any) =>
    item.status !== "reversed" && item.event_type !== "refunded"
  );
  const sum = (items: any[]) => items.reduce(
    (total, item) => total + nonNegativeInteger(item.amount_cents),
    0,
  );
  return {
    policy_version: COMMERCIAL_POLICY_VERSION,
    default_policy: DEFAULT_COMMERCIAL_POLICY,
    agreements,
    policies,
    spend: {
      day_key: keys.day_key,
      month_key: keys.month_key,
      daily_committed_cents: sum(activeSpend.filter((item: any) => item.day_key === keys.day_key)),
      monthly_committed_cents: sum(activeSpend.filter((item: any) => item.month_key === keys.month_key)),
      lifetime_recorded_cents: sum(activeSpend),
      recent_events: (spend || []).slice(0, 25),
    },
  };
}
