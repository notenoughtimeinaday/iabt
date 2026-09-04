export const ALLOWED_ENTITIES = Object.freeze([
  "AccountEntitlement",
  "AiUsage",
  "Asset",
  "AutomationRun",
  "AutomationRunbook",
  "AutonomyPolicy",
  "BillingEvent",
  "CollaborationProfile",
  "CollaborationRoom",
  "CommercialPolicy",
  "ConnectionAdapter",
  "ConsentGrant",
  "CreationArtifact",
  "CreationPlan",
  "CredentialClaim",
  "ExchangeAuditEvent",
  "ExchangeBlock",
  "ExchangeSafetyReport",
  "GenerationJob",
  "IntegrationConnection",
  "IntroductionRequest",
  "MatchRecord",
  "PolicyAcceptance",
  "Project",
  "ProjectNeed",
  "ProviderAgreement",
  "ProviderSpendLedger",
  "RoomMessage",
  "SystemIncident",
  "UsageLedger",
  "AgentConversation"
]);

const asPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const loadConfig = (env = process.env) => {
  const environment = env.NODE_ENV || "development";
  const authSecret = env.IABT_AUTH_SECRET || "development-only-change-me";
  if (environment === "production" && authSecret === "development-only-change-me") {
    throw new Error("IABT_AUTH_SECRET must be configured in production");
  }

  return Object.freeze({
    environment,
    port: asPositiveInteger(env.PORT, 8787),
    publicOrigin: env.IABT_PUBLIC_ORIGIN || "http://localhost:5173",
    databaseUrl: env.IABT_DATABASE_URL || "",
    authSecret,
    sessionTtlMs: asPositiveInteger(env.IABT_SESSION_TTL_MS, 1000 * 60 * 60 * 24 * 14),
    challengeTtlMs: asPositiveInteger(env.IABT_CHALLENGE_TTL_MS, 1000 * 60 * 15),
    exposeDevelopmentOtp: environment !== "production" && env.IABT_EXPOSE_DEV_OTP !== "false",
    allowedEntities: new Set(ALLOWED_ENTITIES)
  });
};
