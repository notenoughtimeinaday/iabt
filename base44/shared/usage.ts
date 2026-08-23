import { getPlanDefaults } from "./stripe.ts";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function nonNegative(value: unknown, fallback = 0) {
  return Math.max(0, integer(value, fallback));
}

function usageKeys(now = new Date()) {
  const iso = now.toISOString();
  return {
    hour_key: "hour:" + iso.slice(0, 13),
    month_key: "month:" + iso.slice(0, 7),
  };
}

function jsonError(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizeEntitlement(user: any, current: any) {
  const active = ACTIVE_STATUSES.has(String(current?.status || ""));
  const plan = active ? String(current?.plan || "free") : "free";
  const defaults = getPlanDefaults(plan);
  const foundingAdmin = Boolean(
    user?.role === "admin" &&
    active &&
    current?.billing_provider === "none",
  );
  const normalized = foundingAdmin
    ? { ...defaults, ...current, plan }
    : { ...current, ...defaults, plan };

  return {
    ...normalized,
    bonus_ai_credits: nonNegative(current?.bonus_ai_credits),
    ai_hourly_used: nonNegative(current?.ai_hourly_used),
    ai_monthly_used: nonNegative(current?.ai_monthly_used),
    ai_usage_hour: String(current?.ai_usage_hour || ""),
    ai_usage_month: String(current?.ai_usage_month || ""),
  };
}

export async function getOrCreateEntitlement(base44: any, user: any) {
  const service = base44.asServiceRole;
  const records = await service.entities.AccountEntitlement.filter(
    { user_id: user.id },
    "-updated_date",
    1,
  );
  const current = records?.[0];
  if (current) return normalizeEntitlement(user, current);

  const plan = user.role === "admin" ? "pro" : "free";
  const defaults = getPlanDefaults(plan);
  const now = new Date();
  const keys = usageKeys(now);
  const created = await service.entities.AccountEntitlement.create({
    user_id: user.id,
    user_email: user.email,
    plan,
    status: "active",
    billing_provider: "none",
    ...defaults,
    ai_hourly_limit: user.role === "admin" ? 200 : defaults.ai_hourly_limit,
    project_limit: user.role === "admin" ? 0 : defaults.project_limit,
    bonus_ai_credits: 0,
    ai_usage_hour: keys.hour_key,
    ai_hourly_used: 0,
    ai_usage_month: keys.month_key,
    ai_monthly_used: 0,
    notes: user.role === "admin"
      ? "Founding administrator entitlement"
      : "Default free entitlement",
  });
  return normalizeEntitlement(user, created);
}

async function resetUsageWindows(service: any, entitlement: any, now = new Date()) {
  const keys = usageKeys(now);
  const updates: Record<string, unknown> = {};

  if (String(entitlement.ai_usage_hour || "") !== keys.hour_key) {
    updates.ai_usage_hour = keys.hour_key;
    updates.ai_hourly_used = 0;
  }
  if (String(entitlement.ai_usage_month || "") !== keys.month_key) {
    updates.ai_usage_month = keys.month_key;
    updates.ai_monthly_used = 0;
  }

  if (Object.keys(updates).length) {
    const updated = await service.entities.AccountEntitlement.update(entitlement.id, updates);
    return { ...entitlement, ...updated, ...updates };
  }
  return entitlement;
}

export function entitlementUsageSummary(entitlement: any) {
  const defaults = getPlanDefaults(String(entitlement?.plan || "free"));
  const hourlyLimit = Math.max(1, integer(entitlement?.ai_hourly_limit, defaults.ai_hourly_limit));
  const monthlyLimit = Math.max(1, integer(entitlement?.ai_monthly_limit, defaults.ai_monthly_limit));
  const hourlyUsed = nonNegative(entitlement?.ai_hourly_used);
  const monthlyUsed = Math.min(monthlyLimit, nonNegative(entitlement?.ai_monthly_used));
  const bonusRemaining = nonNegative(entitlement?.bonus_ai_credits);
  return {
    plan: String(entitlement?.plan || "free"),
    hourly_limit: hourlyLimit,
    hourly_used: hourlyUsed,
    hourly_remaining: Math.max(0, hourlyLimit - hourlyUsed),
    monthly_limit: monthlyLimit,
    monthly_used: monthlyUsed,
    monthly_remaining: Math.max(0, monthlyLimit - monthlyUsed),
    bonus_remaining: bonusRemaining,
    total_remaining: Math.max(0, monthlyLimit - monthlyUsed) + bonusRemaining,
  };
}

async function recordUsageBuckets(
  service: any,
  user: any,
  reservation: any,
  usageKind: string,
) {
  const now = new Date().toISOString();
  const buckets = [
    { key: reservation.hour_key, amount: 1 },
    { key: reservation.month_key, amount: reservation.amount },
  ];
  for (const bucket of buckets) {
    try {
      const existing = await service.entities.AiUsage.filter(
        { user_id: user.id, window_key: bucket.key },
        "-updated_date",
        1,
      );
      if (existing?.[0]) {
        await service.entities.AiUsage.updateMany(
          { id: existing[0].id },
          {
            $inc: { request_count: bucket.amount },
            $set: { last_request_at: now, usage_kind: usageKind },
          },
        );
      } else {
        await service.entities.AiUsage.create({
          user_id: user.id,
          user_email: user.email,
          usage_kind: usageKind,
          window_key: bucket.key,
          request_count: bucket.amount,
          last_request_at: now,
        });
      }
    } catch (error) {
      console.warn("usage analytics update failed:", error instanceof Error ? error.message : error);
    }
  }
}

async function reverseUsageBuckets(service: any, userId: string, reservation: any) {
  const buckets = [
    { key: reservation.hour_key, amount: 1 },
    { key: reservation.month_key, amount: reservation.amount },
  ];
  for (const bucket of buckets) {
    try {
      const existing = await service.entities.AiUsage.filter(
        { user_id: userId, window_key: bucket.key },
        "-updated_date",
        1,
      );
      const record = existing?.[0];
      if (!record) continue;
      const decrement = Math.min(nonNegative(record.request_count), bucket.amount);
      if (decrement > 0) {
        await service.entities.AiUsage.updateMany(
          { id: record.id, request_count: { $gte: decrement } },
          {
            $inc: { request_count: -decrement },
            $set: { last_request_at: new Date().toISOString() },
          },
        );
      }
    } catch (error) {
      console.warn("usage analytics reversal failed:", error instanceof Error ? error.message : error);
    }
  }
}

export async function reserveIabtCredits(
  base44: any,
  user: any,
  requestedCredits: number,
  options: { usageKind?: string; paidMedia?: boolean } = {},
) {
  const amount = integer(requestedCredits);
  if (amount < 1 || amount > 10000) {
    throw jsonError(400, { error: "The requested IABT credit amount is invalid." });
  }

  const service = base44.asServiceRole;
  for (let attempt = 0; attempt < 5; attempt++) {
    let entitlement = await getOrCreateEntitlement(base44, user);
    entitlement = await resetUsageWindows(service, entitlement);
    const summary = entitlementUsageSummary(entitlement);
    const paidMedia = Boolean(options.paidMedia);

    if (summary.hourly_used >= summary.hourly_limit) {
      throw jsonError(429, {
        error: "Hourly AI safety limit reached. Try again after the hour changes.",
        code: "hourly_ai_limit_reached",
        plan: summary.plan,
        limit: summary.hourly_limit,
      });
    }

    const mayUseIncluded = !(paidMedia && summary.plan === "free");
    const includedAvailable = mayUseIncluded ? summary.monthly_remaining : 0;
    const includedCredits = Math.min(amount, includedAvailable);
    const bonusCredits = amount - includedCredits;
    if (bonusCredits > summary.bonus_remaining) {
      throw jsonError(402, {
        error: paidMedia && summary.plan === "free"
          ? "Paid media rendering requires a paid plan or enough purchased IABT credits."
          : "Your IABT credit allowance is not large enough for this creation.",
        code: paidMedia && summary.plan === "free"
          ? "paid_media_requires_plan_or_credits"
          : "iabt_credits_required",
        plan: summary.plan,
        required_credits: amount,
        included_remaining: includedAvailable,
        bonus_remaining: summary.bonus_remaining,
        total_remaining: includedAvailable + summary.bonus_remaining,
      });
    }

    const query = {
      id: entitlement.id,
      ai_usage_hour: entitlement.ai_usage_hour,
      ai_hourly_used: nonNegative(entitlement.ai_hourly_used),
      ai_usage_month: entitlement.ai_usage_month,
      ai_monthly_used: nonNegative(entitlement.ai_monthly_used),
      bonus_ai_credits: nonNegative(entitlement.bonus_ai_credits),
    };
    const increments: Record<string, number> = {
      ai_hourly_used: 1,
    };
    if (includedCredits) increments.ai_monthly_used = includedCredits;
    if (bonusCredits) increments.bonus_ai_credits = -bonusCredits;

    const result = await service.entities.AccountEntitlement.updateMany(
      query,
      { $inc: increments },
    );
    if (Number(result?.updated || 0) !== 1) continue;

    const reservation = {
      entitlement_id: entitlement.id,
      user_id: user.id,
      amount,
      included_credits: includedCredits,
      bonus_credits: bonusCredits,
      hour_key: entitlement.ai_usage_hour,
      month_key: entitlement.ai_usage_month,
      paid_media: paidMedia,
    };
    const nextEntitlement = {
      ...entitlement,
      ai_hourly_used: nonNegative(entitlement.ai_hourly_used) + 1,
      ai_monthly_used: nonNegative(entitlement.ai_monthly_used) + includedCredits,
      bonus_ai_credits: nonNegative(entitlement.bonus_ai_credits) - bonusCredits,
    };
    await recordUsageBuckets(
      service,
      user,
      reservation,
      String(options.usageKind || "content_generation"),
    );
    return {
      reservation,
      entitlement: nextEntitlement,
      usage: entitlementUsageSummary(nextEntitlement),
    };
  }

  throw jsonError(409, {
    error: "Your credit balance changed while this request was starting. Please try again.",
    code: "credit_reservation_conflict",
  });
}

export async function releaseIabtCredits(base44: any, reservation: any) {
  if (!reservation?.entitlement_id || !reservation?.user_id) return false;
  const service = base44.asServiceRole;
  let entitlement;
  try {
    entitlement = await service.entities.AccountEntitlement.get(reservation.entitlement_id);
  } catch {
    return false;
  }

  const increments: Record<string, number> = {};
  if (
    String(entitlement.ai_usage_hour || "") === String(reservation.hour_key || "") &&
    nonNegative(entitlement.ai_hourly_used) > 0
  ) {
    increments.ai_hourly_used = -1;
  }
  if (
    String(entitlement.ai_usage_month || "") === String(reservation.month_key || "") &&
    nonNegative(entitlement.ai_monthly_used) >= nonNegative(reservation.included_credits)
  ) {
    const included = nonNegative(reservation.included_credits);
    if (included) increments.ai_monthly_used = -included;
  }
  const bonus = nonNegative(reservation.bonus_credits);
  if (bonus) increments.bonus_ai_credits = bonus;

  if (Object.keys(increments).length) {
    await service.entities.AccountEntitlement.updateMany(
      { id: entitlement.id },
      { $inc: increments },
    );
  }
  await reverseUsageBuckets(service, reservation.user_id, reservation);
  return true;
}

async function recordJobLedger(service: any, job: any, eventType: string, description: string, status: string) {
  const existing = await service.entities.UsageLedger.filter(
    { user_id: job.user_id, job_id: job.id, event_type: eventType },
    "-created_date",
    1,
  );
  if (existing?.length) return existing[0];
  return service.entities.UsageLedger.create({
    user_id: job.user_id,
    user_email: job.user_email,
    plan_id: job.plan_id,
    job_id: job.id,
    event_type: eventType,
    unit: "media_credit",
    amount: nonNegative(job.usage_reservation?.amount),
    pricing_version: String(job.quote_snapshot?.pricing_version || "unknown"),
    description,
    status,
    occurred_at: new Date().toISOString(),
  });
}

export async function captureJobCredits(base44: any, job: any, description: string) {
  if (!job?.id || String(job.usage_state || "") === "captured") return false;
  const service = base44.asServiceRole;
  const lock = await service.entities.GenerationJob.updateMany(
    { id: job.id, usage_state: "reserved" },
    { $set: { usage_state: "captured" } },
  );
  if (Number(lock?.updated || 0) !== 1) return false;
  try {
    await recordJobLedger(service, job, "capture", description, "settled");
  } catch (error) {
    console.warn("credit capture ledger failed:", error instanceof Error ? error.message : error);
  }
  return true;
}

export async function releaseJobCredits(base44: any, job: any, description: string) {
  if (!job?.id || String(job.usage_state || "") === "released") return false;
  const service = base44.asServiceRole;
  const currentState = String(job.usage_state || "");
  if (!["reserved", "release_failed"].includes(currentState)) return false;
  const lock = await service.entities.GenerationJob.updateMany(
    { id: job.id, usage_state: currentState },
    { $set: { usage_state: "release_pending" } },
  );
  if (Number(lock?.updated || 0) !== 1) return false;

  try {
    const released = await releaseIabtCredits(base44, job.usage_reservation);
    if (!released) throw new Error("The entitlement reservation could not be found.");
    await service.entities.GenerationJob.update(job.id, { usage_state: "released" });
    try {
      await recordJobLedger(service, job, "release", description, "reversed");
    } catch (ledgerError) {
      console.warn("credit release ledger failed:", ledgerError instanceof Error ? ledgerError.message : ledgerError);
    }
    return true;
  } catch (error) {
    await service.entities.GenerationJob.update(job.id, { usage_state: "release_failed" }).catch(() => {});
    throw error;
  }
}
