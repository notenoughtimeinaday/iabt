export const STARTER_CREDIT_AMOUNT = 10;
export const STARTER_CREDIT_KEY = "signup:free:v1";

// Eligibility comes from a verified persisted identity and the absence of a
// previous starter grant, never from the current (possibly spent) balance.
export const ensureStarterCredits = async ({ repository, user }) => {
  const accountOwner = user?.id ? await repository.getUser(user.id) : null;
  if (!accountOwner?.email_verified) {
    throw Object.assign(new Error("Verify your account before receiving starter credits"), {
      status: 403, code: "email_verification_required"
    });
  }
  if (typeof repository.findStarterCreditGrant !== "function") {
    throw Object.assign(new Error("Starter credit reconciliation is temporarily unavailable"), {
      status: 503, code: "starter_credit_reconciliation_unavailable"
    });
  }
  const existing = await repository.findStarterCreditGrant(accountOwner.id);
  if (existing) return repository.getCreditAccount(accountOwner.id);
  return repository.grantCredits({
    ownerId: accountOwner.id,
    amount: STARTER_CREDIT_AMOUNT,
    idempotencyKey: STARTER_CREDIT_KEY,
    metadata: { source: "initial_free_allowance" }
  });
};

// Authentication proof and its one-time challenge have already succeeded. A
// temporary ledger fault must not discard the new session or burn the user's
// recovery path; the normal entitlement read retries the same allowance.
export const withStarterCredits = async ({ repository, user, payload }) => {
  try {
    await ensureStarterCredits({ repository, user });
    return payload;
  } catch {
    return { ...payload, starter_credits_pending: true };
  }
};
