export const SERVER_MANAGED_ENTITIES = Object.freeze([
  "AccountEntitlement",
  "AiUsage",
  "AutomationRun",
  "BillingEvent",
  "ConsentGrant",
  "CreationArtifact",
  "CreationPlan",
  "GenerationJob",
  "PolicyAcceptance",
  "ProviderSpendLedger",
  "SystemIncident",
  "UsageLedger"
]);

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

const asBoolean = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());

const freezeProvider = (value) => Object.freeze(value);

export const loadConfig = (env = process.env) => {
  const environment = env.NODE_ENV || "development";
  const authSecret = env.IABT_AUTH_SECRET || "development-only-change-me";
  if (environment === "production" && authSecret === "development-only-change-me") {
    throw new Error("IABT_AUTH_SECRET must be configured in production");
  }

  const apiOrigin = env.IABT_API_ORIGIN || "http://localhost:8787";
  const storageProvider = String(env.IABT_STORAGE_PROVIDER || "").trim().toLowerCase() ||
    (environment === "production" ? "s3" : "local");
  const costPerMinuteCents = Number(env.IABT_ELEVENLABS_COST_PER_MINUTE_CENTS);
  const lumaCostPerFiveSecondsCents = Number(env.IABT_LUMA_COST_PER_5_SECONDS_CENTS);

  return Object.freeze({
    environment,
    port: asPositiveInteger(env.PORT, 8787),
    publicOrigin: env.IABT_PUBLIC_ORIGIN || "http://localhost:5173",
    apiOrigin,
    databaseUrl: env.IABT_DATABASE_URL || "",
    authSecret,
    sessionTtlMs: asPositiveInteger(env.IABT_SESSION_TTL_MS, 1000 * 60 * 60 * 24 * 14),
    challengeTtlMs: asPositiveInteger(env.IABT_CHALLENGE_TTL_MS, 1000 * 60 * 15),
    exposeDevelopmentOtp: environment !== "production" && env.IABT_EXPOSE_DEV_OTP !== "false",
    maxUploadBytes: asPositiveInteger(env.IABT_MAX_UPLOAD_BYTES, 25 * 1024 * 1024),
    worker: Object.freeze({
      enabled: asBoolean(env.IABT_JOB_WORKER_ENABLED),
      pollMs: asPositiveInteger(env.IABT_JOB_POLL_MS, 1500),
      leaseMs: asPositiveInteger(env.IABT_JOB_LEASE_MS, 5 * 60 * 1000)
    }),
    storage: Object.freeze({
      provider: storageProvider,
      localDirectory: env.IABT_LOCAL_STORAGE_DIR || ".iabt-storage",
      endpoint: env.IABT_STORAGE_ENDPOINT || "",
      region: env.IABT_STORAGE_REGION || "us-east-1",
      bucket: env.IABT_STORAGE_BUCKET || "",
      accessKeyId: env.IABT_STORAGE_ACCESS_KEY_ID || "",
      secretAccessKey: env.IABT_STORAGE_SECRET_ACCESS_KEY || ""
    }),
    providers: Object.freeze({
      openai: freezeProvider({
        apiKey: env.OPENAI_API_KEY || "",
        model: env.OPENAI_MODEL || "gpt-4o-mini",
        paidEnabled: asBoolean(env.IABT_ENABLE_PAID_AI)
      }),
      elevenlabs: freezeProvider({
        apiKey: env.ELEVENLABS_API_KEY || "",
        paidEnabled: asBoolean(env.IABT_ENABLE_PAID_AUDIO),
        billingReady: asBoolean(env.IABT_AUDIO_BILLING_READY),
        commercialApproved: asBoolean(env.IABT_ELEVENLABS_COMMERCIAL_APPROVED),
        costPerMinuteCents:
          Number.isInteger(costPerMinuteCents) && costPerMinuteCents > 0
            ? costPerMinuteCents
            : 0
      }),
      luma: freezeProvider({
        apiKey: env.LUMA_API_KEY || env.LUMA_AGENTS_API_KEY || "",
        paidEnabled: asBoolean(env.IABT_ENABLE_PAID_MEDIA),
        billingReady: asBoolean(env.IABT_MEDIA_BILLING_READY),
        commercialApproved: asBoolean(env.IABT_LUMA_COMMERCIAL_APPROVED),
        costPerFiveSecondsCents:
          Number.isInteger(lumaCostPerFiveSecondsCents) && lumaCostPerFiveSecondsCents > 0
            ? lumaCostPerFiveSecondsCents
            : 0
      }),
      stripe: freezeProvider({
        secretKey: env.STRIPE_SECRET_KEY || "",
        webhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
        mode: env.IABT_STRIPE_MODE === "live" ? "live" : "test"
      })
    }),
    allowedEntities: new Set(ALLOWED_ENTITIES),
    serverManagedEntities: new Set(SERVER_MANAGED_ENTITIES)
  });
};
