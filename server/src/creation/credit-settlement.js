// Versioned retail policy. Rates are conservative usage weights, not an invoice:
// Terra input includes the cache-write premium; output includes reasoning tokens.
// https://developers.openai.com/api/docs/models/gpt-5.6-terra (2026-10-16)
const POLICY = Object.freeze({ version: "terra-usage-2026-10-16.1", model: "gpt-5.6-terra",
  input_nano_usd: 2500, output_nano_usd: 12000, long_context_threshold: 272000,
  long_input_multiplier: 2, long_output_multiplier: 1.5, nano_usd_per_credit: 30000000 });

export const creationCreditPolicy = (model) => model === POLICY.model ? { ...POLICY } : null;

export function settleCreationCredits(job) {
  const reserved = job.credit_amount;
  const policy = job.input?.credit_settlement;
  if (!policy) return { version: "fixed-quote", reserved, captured: reserved, returned: 0, reason: "fixed_quote" };
  if (job.job_type !== "creation.orchestrated" || JSON.stringify(Object.keys(policy).sort().map(k => [k, policy[k]])) !==
      JSON.stringify(Object.keys(POLICY).sort().map(k => [k, POLICY[k]]))) {
    throw Object.assign(new Error("Unknown credit settlement policy"), { code: "credit_policy_invalid" });
  }
  const receipt = { version: policy.version, reserved, captured: 0, returned: reserved, reason: "usage_unverified" };
  const state = job.output?.orchestration;
  const rows = state?.response_usage;
  // Only the worker's persisted provider checkpoint is authoritative. Neither
  // client input nor completion metadata may supply a charge or token count.
  if (state?.phase !== "complete" || state.usage_model !== policy.model || !Array.isArray(rows) ||
      !Number.isSafeInteger(state.turn) || state.turn < 1 || state.turn > 8 || rows.length !== state.turn ||
      new Set(rows.map(row => row.response_id)).size !== rows.length) return receipt;
  let cost = 0;
  for (const row of rows) {
    if (!/^resp_[a-zA-Z0-9_-]{1,200}$/.test(row.response_id || "") ||
        !/^gpt-5\.6-terra(?:-\d{4}-\d{2}-\d{2})?$/.test(row.model || "") ||
        !Number.isSafeInteger(row.input_tokens) || row.input_tokens < 0 ||
        !Number.isSafeInteger(row.output_tokens) || row.output_tokens < 0) return receipt;
    const long = row.input_tokens > policy.long_context_threshold;
    cost += row.input_tokens * policy.input_nano_usd * (long ? policy.long_input_multiplier : 1) +
      row.output_tokens * policy.output_nano_usd * (long ? policy.long_output_multiplier : 1);
    if (!Number.isSafeInteger(cost)) return receipt;
  }
  const captured = Math.min(reserved, Math.ceil(cost / policy.nano_usd_per_credit));
  return { ...receipt, captured, returned: reserved - captured, reason: "verified_usage", usage_cost_nano_usd: cost };
}
