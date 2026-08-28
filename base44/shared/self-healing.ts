export const SELF_HEALING_VERSION = "iabt-self-healing-2026-08-28.3";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SETUP_CODES = new Set([
  "luma_insufficient_balance",
  "luma_authentication_failed",
  "luma_access_denied",
  "elevenlabs_insufficient_balance",
  "elevenlabs_paid_subscription_required",
  "elevenlabs_subscription_inactive",
  "elevenlabs_authentication_failed",
  "elevenlabs_access_denied",
  "managed_audio_renderer_unavailable",
  "managed_renderer_unavailable",
]);

function clean(value: unknown, max = 1000) {
  return String(value || "")
    .replace(/(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]+/gi, "[redacted]")
    .replace(/((?:api[_-]?key|authorization|token|secret|password))\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function integer(value: unknown, fallback: number, min = 0, max = 10) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function compactCode(value: unknown) {
  return clean(value, 120).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function classifySystemFailure(error: any, fallbackMessage = "The operation did not complete.") {
  const status = Number(error?.status || error?.response?.status || 0);
  const code = compactCode(error?.code || error?.response?.data?.code);
  const rawMessage = clean(
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage,
    1000,
  );
  const lower = (code + " " + rawMessage).toLowerCase();

  let category = "unknown";
  let retryable = error?.retryable === true || TRANSIENT_STATUS.has(status);
  let severity = "error";
  let recovery_action = retryable ? "automatic_retry" : "manual_review";
  let safe_message = "IABT detected an internal production failure and protected the job for review.";

  if (code === "elevenlabs_authentication_failed") {
    category = "configuration";
    retryable = false;
    recovery_action = "manual_setup";
    safe_message = "ElevenLabs rejected the configured API key (HTTP 401). Replace or rotate ELEVENLABS_API_KEY, then run a new owner audio test. Reserved IABT credits were protected.";
  } else if (code === "elevenlabs_access_denied") {
    category = "authorization";
    retryable = false;
    recovery_action = "manual_setup";
    safe_message = "The ElevenLabs key authenticated but does not have permission for this audio request. Update the key permissions or account access before retrying.";
  } else if (code === "elevenlabs_paid_subscription_required") {
    category = "billing";
    retryable = false;
    recovery_action = "manual_setup";
    safe_message = "The ElevenLabs key is valid, but Music API access requires a paid ElevenLabs subscription. Upgrade the provider account before requesting a new playable-audio plan.";
  } else if (code === "elevenlabs_subscription_inactive") {
    category = "billing";
    retryable = false;
    recovery_action = "manual_setup";
    safe_message = "The ElevenLabs key is valid, but its paid subscription is inactive. Restore the subscription before requesting a new playable-audio plan.";
  } else if (code === "elevenlabs_insufficient_balance") {
    category = "billing";
    retryable = false;
    recovery_action = "manual_setup";
    safe_message = "ElevenLabs reported insufficient paid-plan quota or provider funds. Add eligible provider capacity before retrying.";
  } else if (status === 429 || /rate.?limit|too many requests/.test(lower)) {
    category = "rate_limit";
    retryable = true;
    severity = "warning";
    recovery_action = "automatic_retry";
    safe_message = "IABT detected temporary capacity throttling and can retry the safe internal step.";
  } else if (SETUP_CODES.has(code) || /insufficient balance|credential|api key|not configured|needs setup/.test(lower)) {
    category = "configuration";
    retryable = false;
    recovery_action = "manual_setup";
    safe_message = "IABT detected a provider or configuration requirement that needs administrator setup.";
  } else if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|access denied/.test(lower)) {
    category = "authorization";
    retryable = false;
    recovery_action = "manual_setup";
    safe_message = "IABT detected an authorization requirement and stopped without bypassing it.";
  } else if (/validation|invalid|schema|syntax|integrity|acceptance criteria|incomplete/.test(lower)) {
    category = "validation";
    retryable = false;
    recovery_action = "manual_review";
    safe_message = "IABT rejected an output that did not satisfy its verification contract.";
  } else if (/storage|upload|file uri|persist|artifact/.test(lower)) {
    category = "storage";
    retryable = TRANSIENT_STATUS.has(status) || /temporar|timeout|network/.test(lower);
    recovery_action = retryable ? "automatic_retry" : "artifact_reconciliation";
    safe_message = "IABT detected a durable-storage or artifact-integrity problem.";
  } else if (/credit|billing|payment|charge|reservation|ledger/.test(lower)) {
    category = "billing";
    retryable = false;
    severity = "critical";
    recovery_action = "manual_review";
    safe_message = "IABT detected a billing-control issue and stopped automatic execution.";
  } else if (/provider|renderer|upstream/.test(lower) || status >= 500) {
    category = "provider";
    retryable = TRANSIENT_STATUS.has(status);
    recovery_action = retryable ? "automatic_retry" : "manual_setup";
    safe_message = retryable
      ? "IABT detected a temporary upstream failure and can retry the safe internal step."
      : "IABT detected a provider failure that requires setup or review.";
  } else if (/timeout|timed out|network|connection reset|temporar|unavailable/.test(lower)) {
    category = "transient";
    retryable = true;
    severity = "warning";
    recovery_action = "automatic_retry";
    safe_message = "IABT detected a temporary internal failure and can retry the safe step.";
  }

  return {
    category,
    severity,
    retryable,
    recovery_action,
    error_code: code || (status ? "http_" + status : "unclassified_failure"),
    safe_message,
    technical_summary: rawMessage || fallbackMessage,
    status,
  };
}

export function incidentFingerprint(input: { source?: string; category?: string; error_code?: string; technical_summary?: string }) {
  const normalized = [
    clean(input.source, 120).toLowerCase(),
    clean(input.category, 80).toLowerCase(),
    clean(input.error_code, 120).toLowerCase(),
    clean(input.technical_summary, 300).toLowerCase().replace(/\b[0-9a-f]{8,}\b/g, "{id}").replace(/\b\d+\b/g, "{n}"),
  ].join("|");
  return "iabt-" + hash(normalized);
}

export async function recordSystemIncident(service: any, input: any) {
  if (!service || !input?.user_id || !input?.user_email) return null;
  const now = new Date().toISOString();
  const diagnosis = input.diagnosis || classifySystemFailure(input.error);
  const fingerprint = input.fingerprint || incidentFingerprint({
    source: input.source,
    category: diagnosis.category,
    error_code: diagnosis.error_code,
    technical_summary: diagnosis.technical_summary,
  });
  const open = await service.entities.SystemIncident.filter(
    {
      user_id: String(input.user_id),
      fingerprint,
      status: { "$in": ["detected", "retrying", "needs_setup", "needs_review"] },
    },
    "-last_seen_at",
    1,
  ).catch(() => []);
  const status = clean(input.status || (
    diagnosis.recovery_action === "manual_setup" ? "needs_setup" :
    diagnosis.retryable ? "retrying" : "needs_review"
  ), 40);
  const values = {
    user_id: String(input.user_id),
    user_email: String(input.user_email),
    ...(input.plan_id ? { plan_id: String(input.plan_id) } : {}),
    ...(input.job_id ? { job_id: String(input.job_id) } : {}),
    ...(input.conversation_id ? { conversation_id: String(input.conversation_id) } : {}),
    fingerprint,
    source: clean(input.source || "iabt", 160),
    category: diagnosis.category,
    severity: clean(input.severity || diagnosis.severity, 40),
    status,
    error_code: diagnosis.error_code,
    safe_message: clean(input.safe_message || diagnosis.safe_message, 1000),
    technical_summary: clean(input.technical_summary || diagnosis.technical_summary, 2000),
    retryable: Boolean(diagnosis.retryable),
    retry_count: integer(input.retry_count, 0),
    max_retry_count: integer(input.max_retry_count, 0),
    recovery_action: clean(input.recovery_action || diagnosis.recovery_action, 80),
    recovery_result: clean(input.recovery_result, 1000),
    credits_protected: input.credits_protected === true,
    evidence: {
      self_healing_version: SELF_HEALING_VERSION,
      http_status: Number(diagnosis.status || 0),
      ...(input.evidence && typeof input.evidence === "object" ? input.evidence : {}),
    },
    last_seen_at: now,
    ...(status === "recovered" || status === "resolved" ? { resolved_at: now } : {}),
  };
  if (open?.[0]?.id) {
    return service.entities.SystemIncident.update(open[0].id, {
      ...values,
      occurrence_count: Math.max(1, Number(open[0].occurrence_count || 1) + 1),
      first_seen_at: open[0].first_seen_at || now,
    });
  }
  return service.entities.SystemIncident.create({
    ...values,
    occurrence_count: 1,
    first_seen_at: now,
  });
}

export async function withSelfHealingRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (details: any) => Promise<void> | void;
    onRecovered?: (details: any) => Promise<void> | void;
  } = {},
): Promise<T> {
  const maxRetries = integer(options.maxRetries, 2);
  const baseDelayMs = integer(options.baseDelayMs, 400, 100, 2000);
  let lastDiagnosis: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await operation();
      if (attempt > 0 && options.onRecovered) {
        await options.onRecovered({ attempt, retry_count: attempt, diagnosis: lastDiagnosis });
      }
      return result;
    } catch (error) {
      const diagnosis = classifySystemFailure(error);
      lastDiagnosis = diagnosis;
      if (!diagnosis.retryable || attempt >= maxRetries) throw error;
      if (options.onRetry) {
        await options.onRetry({ attempt: attempt + 1, retry_count: attempt + 1, diagnosis, error });
      }
      const delay = Math.min(4000, baseDelayMs * (2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("IABT retry controller reached an impossible state.");
}
