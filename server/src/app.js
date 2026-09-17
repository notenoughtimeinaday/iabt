import { createHash } from "node:crypto";
import {
  createId,
  createOpaqueToken,
  createOtp,
  hashPassword,
  hashToken,
  normalizeEmail,
  validatePassword,
  verifyPassword
} from "./security.js";
import { readSingleFile } from "./multipart.js";
import {
  createCreationPlan,
  executeCreationPlan
} from "./creation/planner.js";
import { processStripeWebhook } from "./billing/stripe-webhook.js";
import { planDefaults } from "./billing/plans.js";
import {
  createCreditCheckout,
  createCustomerPortal,
  createSubscriptionCheckout
} from "./billing/stripe-checkout.js";
import { createTransactionalEmailSender } from "./email/resend.js";
import { recordPolicyAcceptance } from "./operations/policy-acceptance.js";
import { SUPPORTED_AGENT_NAMES, respondToSupportRequest, buildJerichoKnowledge } from "./operations/jericho-support.js";
import { handleExchangeFunction } from "./functions/exchange.js";
import { handleIntegrationFunction } from "./functions/integrations.js";

const WORKFLOW_ENTITIES = new Set([
  "AgentConversation", "CollaborationProfile", "ProjectNeed", "MatchRecord",
  "IntroductionRequest", "CollaborationRoom", "RoomMessage", "CredentialClaim",
  "ExchangeBlock", "ExchangeSafetyReport", "ExchangeAuditEvent",
  "IntegrationConnection", "ConnectionAdapter", "CommercialPolicy", "ProviderAgreement"
]);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const parseLimit = (value, fallback = 50, max = 500) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
};

const readBodyBuffer = async (req) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      throw new HttpError(413, "request_too_large", "Request body exceeds 1 MB");
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
};

const readJson = async (req) => {
  const body = await readBodyBuffer(req);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
};

const responseHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {})
});

const send = (res, status, payload, origin) => {
  res.writeHead(status, responseHeaders(origin));
  res.end(JSON.stringify(payload));
};

const probeHealth = async (component, fallbackAdapter) => {
  if (!component?.health) {
    return {
      ok: false,
      adapter: fallbackAdapter,
      reason: "health_check_missing"
    };
  }
  try {
    return await component.health();
  } catch {
    return {
      ok: false,
      adapter: fallbackAdapter,
      reason: "unavailable"
    };
  }
};

const challengeHash = (config, { email, purpose, code }) =>
  hashToken(`${config.authSecret}:${purpose}:${email}:${code}`);

const requireEmailDelivery = (config, emailSender) => {
  if (!config.exposeDevelopmentOtp && !emailSender?.configured) {
    throw new HttpError(503, "email_not_configured", "Account email is temporarily unavailable. Please try again later.");
  }
};

const issueChallenge = async (repository, config, email, purpose, emailSender) => {
  requireEmailDelivery(config, emailSender);
  const code = createOtp();
  const codeHash = challengeHash(config, { email, purpose, code });
  if (!config.exposeDevelopmentOtp) {
    try {
      await emailSender.sendChallenge({ to: email, code, purpose, idempotencyKey: codeHash });
    } catch {
      // Provider responses may contain configuration details. Keep them out of public errors.
      throw new HttpError(502, "email_delivery_failed", "The email could not be sent. Please try again or request a new code from the login page.");
    }
  }
  // A delivery failure must not replace a code that the user has already received.
  await repository.saveChallenge({
    email,
    purpose,
    codeHash,
    expiresAt: new Date(Date.now() + config.challengeTtlMs).toISOString()
  });
  return config.exposeDevelopmentOtp ? { dev_otp: code } : {};
};

const issueSession = async (repository, config, user, expectedPasswordHash) => {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
  const created = await repository.createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt,
    expectedPasswordHash
  });
  if (!created) throw new HttpError(401, "invalid_credentials", "Account credentials changed. Please sign in again.");
  return { access_token: token, expires_at: expiresAt, user };
};

const limitAuthRequest = async (req, action, email, repository, config) => {
  const deliveryAction = ["register", "resend-otp", "reset-request"].includes(action);
  const operation = deliveryAction ? "email" : action;
  // Socket addresses cannot be forged via an arbitrary X-Forwarded-For header.
  // Account limits remain effective when a deployment uses a shared reverse proxy.
  const limits = [
    { key: `ip:${req.socket.remoteAddress || "unknown"}`, max: 120 },
    { key: `account:${operation}:${email}`, max: deliveryAction ? 5 : 10 }
  ];
  for (const limit of limits) {
    const allowed = await repository.consumeAuthRateLimit({
      keyHash: hashToken(`${config.authSecret}:${limit.key}`),
      maxAttempts: limit.max,
      windowMs: 15 * 60 * 1000
    });
    if (!allowed) throw new HttpError(429, "auth_rate_limited", "Too many attempts. Please wait 15 minutes before trying again.");
  }
};

const authenticate = async (req, repository) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "auth_required", "Authentication required");
  }
  const token = authorization.slice(7).trim();
  const session = await repository.getSession(hashToken(token));
  if (!session) throw new HttpError(401, "invalid_session", "Session is invalid or expired");
  const user = await repository.getUser(session.user_id);
  if (!user) throw new HttpError(401, "invalid_session", "Session user no longer exists");
  return { user, token };
};

const requireEntity = (config, name) => {
  if (!config.allowedEntities.has(name)) {
    throw new HttpError(404, "unknown_entity", "Entity is not registered");
  }
  return name;
};

const handleAuth = async ({
  req,
  segments,
  body,
  repository,
  config,
  emailSender
}) => {
  const action = segments[2];
  if (req.method === "POST" && ["register", "login", "verify-otp", "resend-otp", "reset-request", "reset"].includes(action)) {
    await limitAuthRequest(req, action, normalizeEmail(body.email), repository, config);
  }

  if (req.method === "POST" && action === "register") {
    const email = normalizeEmail(body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new HttpError(400, "invalid_email", "A valid email address is required");
    }
    requireEmailDelivery(config, emailSender);
    const existing = await repository.findUserByEmail(email, { includeSecret: true });
    let user;
    if (existing) {
      // Retry an interrupted signup only with the original password. Never replace it
      // based on an unverified registration or create a session for a verified account.
      if (existing.email_verified || !(await verifyPassword(body.password, existing.password_hash))) {
        throw new HttpError(409, "email_exists", "An account already exists. Sign in, request a verification code, or reset your password.");
      }
      const { password_hash: _passwordHash, ...safeUser } = existing;
      user = safeUser;
    } else {
      const passwordHash = await hashPassword(body.password);
      user = await repository.createUser({
        email,
        passwordHash,
        name: String(body.name || "").trim(),
        emailVerified: false
      });
      if (!user) throw new HttpError(409, "email_exists", "An account already exists. Please sign in or request a verification code.");
    }
    const challenge = await issueChallenge(
      repository,
      config,
      email,
      "verify_email",
      emailSender
    );
    return { status: 201, payload: { requires_verification: true, ...challenge, user } };
  }

  if (req.method === "POST" && action === "verify-otp") {
    const email = normalizeEmail(body.email);
    const code = String(body.otpCode || body.code || "").trim();
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
    const user = await repository.completeAuthChallenge({
      email,
      purpose: "verify_email",
      codeHash: challengeHash(config, { email, purpose: "verify_email", code }),
      session: { tokenHash: hashToken(token), expiresAt }
    });
    if (!user) throw new HttpError(400, "invalid_otp", "Verification code is invalid or expired. Request a new code or sign in if already verified.");
    return { status: 200, payload: { access_token: token, expires_at: expiresAt, user } };
  }

  if (req.method === "POST" && action === "resend-otp") {
    requireEmailDelivery(config, emailSender);
    const email = normalizeEmail(body.email);
    const user = await repository.findUserByEmail(email);
    const challenge = user && !user.email_verified
      ? await issueChallenge(
          repository,
          config,
          email,
          "verify_email",
          emailSender
        )
      : {};
    return { status: 200, payload: { accepted: true, ...challenge } };
  }

  if (req.method === "POST" && action === "login") {
    const email = normalizeEmail(body.email);
    const stored = await repository.findUserByEmail(email, { includeSecret: true });
    if (stored?.password_hash === "migration:reset-required") {
      throw new HttpError(
        403,
        "password_reset_required",
        "This account was migrated from Base44. Use Forgot password to create a standalone IABT password."
      );
    }
    const valid = stored && (await verifyPassword(body.password, stored.password_hash));
    if (!valid) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    if (!stored.email_verified) {
      throw new HttpError(403, "email_unverified", "Verify the email address before signing in");
    }
    const { password_hash: _passwordHash, ...user } = stored;
    return { status: 200, payload: await issueSession(repository, config, user, stored.password_hash) };
  }

  if (req.method === "GET" && action === "me") {
    const { user } = await authenticate(req, repository);
    return { status: 200, payload: user };
  }

  if (req.method === "POST" && action === "logout") {
    const { token } = await authenticate(req, repository);
    await repository.deleteSession(hashToken(token));
    return { status: 200, payload: { ok: true } };
  }

  if (req.method === "POST" && action === "reset-request") {
    requireEmailDelivery(config, emailSender);
    const email = normalizeEmail(body.email);
    const user = await repository.findUserByEmail(email);
    const challenge = user
      ? await issueChallenge(
          repository,
          config,
          email,
          "reset_password",
          emailSender
        )
      : {};
    return { status: 200, payload: { accepted: true, ...challenge } };
  }

  if (req.method === "POST" && action === "reset") {
    const email = normalizeEmail(body.email);
    const code = String(body.resetToken || body.code || "").trim();
    // A correctable password typo must not burn the user's one-time reset code.
    validatePassword(body.newPassword);
    const passwordHash = await hashPassword(body.newPassword);
    const user = await repository.completeAuthChallenge({
      email,
      purpose: "reset_password",
      codeHash: challengeHash(config, { email, purpose: "reset_password", code }),
      passwordHash
    });
    if (!user) throw new HttpError(400, "invalid_reset", "Reset code is invalid or expired. Request a new code.");
    return { status: 200, payload: { ok: true } };
  }

  throw new HttpError(404, "route_not_found", "Authentication route was not found");
};

const handleEntity = async ({ req, segments, body, repository, config }) => {
  const { user } = await authenticate(req, repository);
  const entityName = requireEntity(config, decodeURIComponent(segments[2] || ""));
  const operation = segments[3];
  const readOperation =
    req.method === "GET" ||
    (req.method === "POST" && (operation === "list" || operation === "filter"));
  if (WORKFLOW_ENTITIES.has(entityName) && readOperation) {
    throw new HttpError(403, "workflow_read_required", "Use this feature's authorized workflow to read these records");
  }
  if ((config.serverManagedEntities.has(entityName) || WORKFLOW_ENTITIES.has(entityName)) && !readOperation) {
    throw new HttpError(
      403,
      "server_managed_entity",
      "This record type can be changed only through its verified IABT workflow"
    );
  }

  if (req.method === "POST" && operation === "list") {
    return {
      status: 200,
      payload: await repository.listRecords(entityName, user, {
        sort: body.sort,
        limit: parseLimit(body.limit),
        skip: parseLimit(body.skip, 0, Number.MAX_SAFE_INTEGER)
      })
    };
  }

  if (req.method === "POST" && operation === "filter") {
    return {
      status: 200,
      payload: await repository.listRecords(entityName, user, {
        query: asObject(body.query),
        sort: body.sort,
        limit: parseLimit(body.limit),
        skip: parseLimit(body.skip, 0, Number.MAX_SAFE_INTEGER)
      })
    };
  }

  if (req.method === "POST" && operation === "bulk") {
    if (!Array.isArray(body.records) || body.records.length > 500) {
      throw new HttpError(400, "invalid_records", "records must be an array of at most 500 items");
    }
    const records = [];
    for (const input of body.records) {
      records.push(await repository.createRecord(entityName, user, asObject(input)));
    }
    await repository.appendAudit(user, "entity.bulk_create", {
      entity_name: entityName,
      count: records.length
    });
    return { status: 201, payload: records };
  }

  if (req.method === "POST" && operation === "delete-many") {
    const result = await repository.deleteMany(entityName, user, asObject(body.query));
    await repository.appendAudit(user, "entity.delete_many", {
      entity_name: entityName,
      deleted: result.deleted
    });
    return { status: 200, payload: result };
  }

  if (segments.length === 3 && req.method === "POST") {
    const record = await repository.createRecord(entityName, user, asObject(body));
    await repository.appendAudit(user, "entity.create", {
      entity_name: entityName,
      record_id: record.id
    });
    return { status: 201, payload: record };
  }

  const id = decodeURIComponent(operation || "");
  if (!id) throw new HttpError(404, "route_not_found", "Entity route was not found");

  if (req.method === "GET") {
    const record = await repository.getRecord(entityName, id, user);
    if (!record) throw new HttpError(404, "record_not_found", "Record was not found");
    return { status: 200, payload: record };
  }

  if (req.method === "PATCH") {
    const record = await repository.updateRecord(entityName, id, user, asObject(body));
    if (!record) throw new HttpError(404, "record_not_found", "Record was not found");
    await repository.appendAudit(user, "entity.update", {
      entity_name: entityName,
      record_id: id
    });
    return { status: 200, payload: record };
  }

  if (req.method === "DELETE") {
    const deleted = await repository.deleteRecord(entityName, id, user);
    if (!deleted) throw new HttpError(404, "record_not_found", "Record was not found");
    await repository.appendAudit(user, "entity.delete", {
      entity_name: entityName,
      record_id: id
    });
    return { status: 200, payload: { deleted: true } };
  }

  throw new HttpError(405, "method_not_allowed", "Method is not allowed");
};

const handleAgents = async ({
  req,
  segments,
  body,
  repository,
  config,
  providers,
  storage
}) => {
  const { user } = await authenticate(req, repository);
  const conversationId = segments[3];
  const actor = { ...user, role: "user" };

  if (segments.length === 3 && req.method === "GET") {
    return {
      status: 200,
      payload: await repository.listRecords("AgentConversation", actor, {
        sort: "-updated_date",
        limit: 250
      })
    };
  }

  if (segments.length === 3 && req.method === "POST") {
    const agentName = String(body.agent_name || "iabt_creator");
    if (!SUPPORTED_AGENT_NAMES.includes(agentName)) throw new HttpError(400, "unsupported_agent", "This agent is not available");
    const record = await repository.createRecord("AgentConversation", actor, {
      agent_name: agentName,
      metadata: { project_id: String(body.metadata?.project_id || ""), title: String(body.metadata?.title || "").slice(0, 200) },
      messages: [],
      status: "active"
    });
    await repository.appendAudit(user, "conversation.create", {
      conversation_id: record.id,
      agent_name: record.agent_name || null
    });
    return { status: 201, payload: record };
  }

  if (conversationId === "list" && req.method === "POST") {
    const agentName = body.agent_name || body.q?.agent_name;
    const query = agentName ? { agent_name: agentName } : {};
    return {
      status: 200,
      payload: await repository.listRecords("AgentConversation", actor, {
        query,
        sort: "-updated_date",
        limit: 250
      })
    };
  }

  if (conversationId && segments.length === 4 && req.method === "GET") {
    const record = await repository.getRecord("AgentConversation", conversationId, actor);
    if (!record) throw new HttpError(404, "conversation_not_found", "Conversation was not found");
    return { status: 200, payload: record };
  }

  if (conversationId && segments[4] === "messages" && req.method === "POST") {
    if (body.role && body.role !== "user") throw new HttpError(400, "invalid_message_role", "Only user messages can be submitted");
    if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 20000) throw new HttpError(400, "invalid_message", "Enter a message of at most 20,000 characters");
    return repository.withRecordTransaction(async (repository) => {
    const record = await repository.getRecord("AgentConversation", conversationId, actor);
    if (!record) throw new HttpError(404, "conversation_not_found", "Conversation was not found");
    const message = {
      id: createId(),
      role: "user",
      content: String(body.content || ""),
      created_date: new Date().toISOString()
    };
    let messages = [...(record.messages || []), message];
    let updated = await repository.updateRecord("AgentConversation", conversationId, actor, {
      messages
    });
    await repository.appendAudit(user, "conversation.message", {
      conversation_id: conversationId,
      message_id: message.id
    });

    if (message.role === "user" && message.content.trim().length >= 3) {
      try {
        const support = await respondToSupportRequest({ repository, user, providers, storage, config, requestText: message.content, agentName: record.agent_name });
        if (support) {
          updated = await repository.updateRecord("AgentConversation", conversationId, actor, {
            messages: [...messages, { ...support, id: createId(), role: "assistant", created_date: new Date().toISOString() }]
          });
          return { status: 200, payload: updated };
        }
        const planned = await createCreationPlan({
          repository,
          config,
          providers,
          user,
          requestText: message.content,
          conversationId,
          projectId: String(record.metadata?.project_id || "")
        });
        const plan = planned.plan;
        const assistant = {
          id: createId(),
          role: "assistant",
          content:
            "I inferred **" +
            plan.intent +
            "** from your request and prepared a server-owned plan.\n\n" +
            plan.assistant_summary +
            "\n\n**Deliverables**\n" +
            plan.deliverables.map((item) => "- " + item).join("\n") +
            "\n\n**Exact quote:** " +
            plan.credit_cost +
            " IABT credit" +
            (plan.credit_cost === 1 ? "" : "s") +
            ". Review the approval panel before production.",
          created_date: new Date().toISOString(),
          metadata: { plan_id: plan.id, intent: plan.intent }
        };
        messages = [...messages, assistant];
        updated = await repository.updateRecord("AgentConversation", conversationId, actor, {
          messages
        });
        await repository.appendAudit(user, "creation.plan_created", {
          conversation_id: conversationId,
          plan_id: plan.id,
          inferred_intent: plan.intent
        });
      } catch (error) {
        const assistant = {
          id: createId(),
          role: "assistant",
          content:
            "I could not create a valid plan yet. " +
            String(error.message || "Please revise the request.").slice(0, 500),
          created_date: new Date().toISOString()
        };
        updated = await repository.updateRecord("AgentConversation", conversationId, actor, {
          messages: [...messages, assistant]
        });
      }
    }
    return { status: 200, payload: updated };
    });
  }

  throw new HttpError(404, "route_not_found", "Agent route was not found");
};

const cleanFilename = (value) =>
  String(value || "upload.bin")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .trim()
    .slice(0, 160) || "upload.bin";

const handleFiles = async ({
  req,
  res,
  url,
  segments,
  repository,
  config,
  storage,
  origin
}) => {
  if (!storage) {
    throw new HttpError(501, "storage_not_configured", "Private object storage is not configured");
  }

  if (req.method === "POST" && segments.length === 2) {
    const { user } = await authenticate(req, repository);
    const file = await readSingleFile(req, { maxBytes: config.maxUploadBytes });
    if (!file.bytes.length) throw new HttpError(400, "empty_file", "Uploaded file is empty");
    const id = createId();
    const stored = await storage.put({
      ownerId: user.id,
      objectId: id,
      bytes: file.bytes,
      contentType: file.contentType
    });
    const record = await repository.createStoredObject({
      id,
      ownerId: user.id,
      storageProvider: stored.storage_provider,
      storageKey: stored.storage_key,
      originalName: cleanFilename(file.filename),
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex")
    });
    const fileUrl = await storage.createReadUrl(record, { expiresInSeconds: 300 });
    await repository.appendAudit(user, "file.upload", {
      file_id: record.id,
      size_bytes: record.size_bytes,
      sha256: record.sha256
    });
    return {
      status: 201,
      payload: {
        file_id: record.id,
        file_url: fileUrl,
        mime_type: record.content_type,
        size_bytes: record.size_bytes,
        sha256: record.sha256
      }
    };
  }

  const id = decodeURIComponent(segments[2] || "");
  if (req.method === "GET" && id && segments[3] === "access") {
    const { user } = await authenticate(req, repository);
    const record = await repository.getStoredObject(id, user);
    if (!record) throw new HttpError(404, "file_not_found", "File was not found");
    return {
      status: 200,
      payload: {
        file_id: record.id,
        file_url: await storage.createReadUrl(record, { expiresInSeconds: 300 }),
        expires_in_seconds: 300
      }
    };
  }

  if (req.method === "GET" && id && segments[3] === "content" && storage.kind === "local") {
    const expires = url.searchParams.get("expires");
    const signature = url.searchParams.get("signature");
    if (!storage.verifyDownload(id, expires, signature)) {
      throw new HttpError(403, "invalid_file_signature", "File link is invalid or expired");
    }
    const record = await repository.getStoredObjectById(id);
    if (!record) throw new HttpError(404, "file_not_found", "File was not found");
    const bytes = await storage.read(record.storage_key);
    res.writeHead(200, {
      ...responseHeaders(origin),
      "Content-Type": record.content_type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(record.original_name)
    });
    res.end(bytes);
    return { direct: true };
  }

  throw new HttpError(404, "route_not_found", "File route was not found");
};

const publicJob = (job) => ({
  id: job.id,
  user_id: job.owner_id,
  plan_id: job.input?.plan_id || job.output?.plan_id || "",
  conversation_id: job.input?.conversation_id || job.output?.conversation_id || "",
  project_id: job.input?.project_id || job.output?.project_id || "",
  intent: job.input?.intent || job.output?.intent || "",
  mode: job.input?.render_ready ? "render" : "prepare",
  provider: job.job_type.startsWith("provider.")
    ? job.job_type.split(".")[1]
    : "iabt-standalone",
  status:
    job.status === "queued" && job.input?.provider_job_id
      ? "waiting_provider"
      : job.status,
  progress:
    job.status === "succeeded" || job.status === "failed" || job.status === "needs_setup"
      ? 100
      : job.status === "running"
        ? 50
        : job.input?.provider_job_id
          ? 35
          : 5,
  stage:
    job.status === "succeeded"
      ? "Deliverables created and verified"
      : job.status === "failed"
        ? "Production failed; reserved credits restored"
        : job.status === "needs_setup"
          ? "Configuration required; reserved credits restored"
          : job.status === "running"
            ? "IABT is creating and verifying deliverables"
            : job.input?.provider_job_id
              ? "The managed renderer is still creating the video"
              : "Approval recorded; queued for production",
  usage_state:
    job.status === "succeeded"
      ? "captured"
      : job.status === "failed" || job.status === "needs_setup"
        ? "released"
        : job.credit_amount > 0
          ? "reserved"
          : "none",
  artifact_id: job.output?.artifact_id || "",
  error_message: job.last_error_message || "",
  diagnosis: {
    error_code: job.last_error_code || "",
    incident_id: job.output?.incident_id || "",
    recovery: job.output?.recovery || "",
    released_credits: Number(job.output?.released_credits || 0),
    provider_state: job.output?.provider_state || "",
    next_check_at:
      job.status === "queued" && job.input?.provider_job_id
        ? job.available_at
        : null
  },
  quote_snapshot: {
    pricing_version: job.approval?.pricing_version || "",
    credits_reserved: job.credit_amount > 0
  },
  created_date: job.created_date,
  completed_at: job.completed_date
});

const handleJobs = async ({ req, segments, repository }) => {
  const { user } = await authenticate(req, repository);
  if (req.method === "GET" && segments.length === 2) {
    const jobs = await repository.listJobs(user, { limit: 100 });
    return { status: 200, payload: jobs.map(publicJob) };
  }
  if (req.method === "GET" && segments[2]) {
    const job = await repository.getJob(decodeURIComponent(segments[2]), user);
    if (!job) throw new HttpError(404, "job_not_found", "Job was not found");
    return { status: 200, payload: publicJob(job) };
  }
  throw new HttpError(405, "method_not_allowed", "Method is not allowed");
};

const handleArtifacts = async ({ req, repository, storage }) => {
  const { user } = await authenticate(req, repository);
  if (req.method !== "GET") {
    throw new HttpError(405, "method_not_allowed", "Method is not allowed");
  }
  if (!storage) {
    throw new HttpError(501, "storage_not_configured", "Private object storage is not configured");
  }
  const objects = await repository.listStoredObjects(user, { limit: 250 });
  const artifacts = [];
  for (const object of objects) {
    const job = object.job_id ? await repository.getJob(object.job_id, user) : null;
    const manifest = job?.output?.artifact_manifest || [];
    const details = manifest.find((item) => item.id === object.id) || {};
    artifacts.push({
      id: object.id,
      user_id: object.owner_id,
      job_id: object.job_id || "",
      plan_id: job?.output?.plan_id || job?.input?.plan_id || "",
      conversation_id: job?.output?.conversation_id || job?.input?.conversation_id || "",
      project_id: job?.output?.project_id || job?.input?.project_id || "",
      name: object.original_name,
      kind: details.kind || "other",
      mime_type: object.content_type,
      file_uri: "iabt-file:" + object.id,
      file_url: await storage.createReadUrl(object, { expiresInSeconds: 300 }),
      metadata: {
        ...(details.metadata || {}),
        size_bytes: object.size_bytes,
        sha256: object.sha256,
        private: true
      },
      provider: publicJob(job || {
        id: "",
        owner_id: object.owner_id,
        input: {},
        output: {},
        job_type: "artifact.upload",
        status: "succeeded",
        approval: {},
        credit_amount: 0
      }).provider,
      created_date: object.created_date
    });
  }
  return { status: 200, payload: artifacts };
};

const handleFunction = async ({
  req,
  segments,
  body,
  repository,
  config,
  storage,
  providers
}) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Method is not allowed");
  const { user } = await authenticate(req, repository);
  const name = decodeURIComponent(segments[2] || "");

  if (name === "accept-policies") {
    const record = await repository.withRecordTransaction((transaction) => recordPolicyAcceptance({ repository: transaction, user, input: body }));
    return { status: 200, payload: { data: record } };
  }
  for (const handler of [handleExchangeFunction, handleIntegrationFunction]) {
    const result = await handler({ name, body, user, repository, config, providers });
    if (result) return result;
  }

  if (name === "plan-creation") {
    const planned = await createCreationPlan({
      repository,
      config,
      providers,
      user,
      requestText: body.request_text || body.request || body.prompt,
      conversationId: String(body.conversation_id || body.context?.conversation_id || ""),
      projectId: String(body.project_id || "")
    });
    return { status: 200, payload: planned };
  }

  if (name === "execute-creation") {
    return {
      status: 200,
      payload: await executeCreationPlan({ repository, config, user, body })
    };
  }

  if (
    name === "stripe-create-checkout" ||
    name === "stripe-create-credit-checkout" ||
    name === "stripe-customer-portal"
  ) {
    if (!providers) {
      throw new HttpError(503, "providers_not_configured", "Provider registry is not configured");
    }
    const idempotencyKey =
      "billing:" + name + ":" + user.id + ":" +
      String(body.idempotency_key || createId()).slice(0, 160);
    const result = name === "stripe-create-checkout"
      ? await createSubscriptionCheckout({
          repository,
          providers,
          config,
          user,
          plan: String(body.plan || ""),
          idempotencyKey
        })
      : name === "stripe-create-credit-checkout"
        ? await createCreditCheckout({
            repository,
            providers,
            config,
            user,
            idempotencyKey
          })
        : await createCustomerPortal({
            repository,
            providers,
            config,
            user,
            idempotencyKey
          });
    return { status: 200, payload: { data: result } };
  }

  if (name === "get-account-entitlement") {
    const account = await repository.getCreditAccount(user.id);
    const existing = (
      await repository.listRecords("AccountEntitlement", user, {
        query: { user_id: user.id },
        sort: "-updated_date",
        limit: 1
      })
    )[0];
    const plan = existing?.plan || "free";
    const entitlement = existing || {
      user_id: user.id,
      user_email: user.email,
      plan,
      status: "active",
      billing_provider: "none",
      ...planDefaults(plan),
      bonus_ai_credits: 0
    };
    return {
      status: 200,
      payload: {
        data: {
          ...entitlement,
          credits_remaining: account.available_credits,
          reserved_credits: account.reserved_credits,
          total_remaining: account.available_credits,
          total_iabt_credits_remaining: account.available_credits,
          base44_required: false,
          billing: providers?.readiness?.().stripe || {}
        }
      }
    };
  }

  if (name === "get-creation-capabilities") {
    const readiness = providers?.readiness?.() || {};
    return {
      status: 200,
      payload: {
        data: {
          routing_mode: "automatic",
          capabilities: {
            app: { configured: true, provider: "iabt-standalone" },
            website: { configured: true, provider: "iabt-standalone" },
            document: { configured: true, provider: "iabt-standalone" },
            image: {
              configured: Boolean(readiness.openai_image?.configured),
              provider: "iabt-managed-image",
              reason: readiness.openai_image?.configured
                ? "verified_private_png_generation_ready"
                : "provider_configuration_required"
            },
            audio: {
              configured: Boolean(readiness.elevenlabs?.configured),
              provider: "elevenlabs"
            },
            video: {
              configured: Boolean(readiness.luma?.configured),
              provider: "luma",
              reason: readiness.luma?.configured
                ? "asynchronous_rendering_and_private_ingestion_ready"
                : "provider_configuration_required"
            }
          }
        }
      }
    };
  }

  if (name === "get-artifact-access-url") {
    if (!storage) {
      throw new HttpError(501, "storage_not_configured", "Private object storage is not configured");
    }
    const artifactId = String(body.artifact_id || "");
    const record = await repository.getStoredObject(artifactId, user);
    if (!record) throw new HttpError(404, "artifact_not_found", "Artifact was not found");
    return {
      status: 200,
      payload: {
        data: {
          artifact_id: record.id,
          url: await storage.createReadUrl(record, { expiresInSeconds: 300 }),
          file_url: await storage.createReadUrl(record, { expiresInSeconds: 300 }),
          expires_in_seconds: 300
        }
      }
    };
  }

  if (name === "refresh-generation-job" || name === "get-creation-status") {
    const jobId = String(body.job_id || "");
    const job = await repository.getJob(jobId, user);
    if (!job) throw new HttpError(404, "job_not_found", "Job was not found");
    return { status: 200, payload: { data: { job: publicJob(job) } } };
  }

  if (name === "get-system-health") {
    const knowledge = await buildJerichoKnowledge({ repository, user, providers, storage, config });
    const incidents = await repository.listIncidents({ ...user, role: "user" }, { limit: 20 });
    return {
      status: 200,
      payload: {
        data: {
          version: "iabt-standalone-0.7.0",
          runtime: "standalone",
          base44_required: false,
          authenticated_user_id: user.id,
          health_status: "not_live_probed",
          runtime_knowledge: knowledge,
          operational_core: {
            durable_job_queue: true,
            lease_recovery: true,
            incident_persistence: true,
            transactional_credit_lifecycle: true,
            private_object_storage: Boolean(storage),
            storage_provider: storage?.kind || "not_configured",
            direct_provider_adapters: Boolean(providers),
            asynchronous_media_polling: true,
            verified_media_ingestion: true,
            stripe_signature_verification: true,
            stripe_event_replay_protection: true,
            active_incident_count: incidents.filter((incident) => !incident.resolved_at).length
          },
          recent_incidents: incidents.map((incident) => ({
            incident_id: incident.id,
            job_id: incident.job_id,
            category: incident.category,
            error_code: incident.error_code,
            safe_message: incident.safe_message,
            recovery: incident.job_id ? "credit_release_on_terminal_failure" : "none",
            created_date: incident.created_date
          })),
          provider_readiness: providers?.readiness?.() || {},
          production_routes: {
            app: { configured: true, reason: "deterministic_creation_and_packaging_ready" },
            website: { configured: true, reason: "deterministic_creation_and_packaging_ready" },
            document: { configured: true, reason: "markdown_docx_pdf_generation_and_storage_ready" },
            image: {
              configured: Boolean(providers?.readiness?.().openai_image?.configured),
              reason: providers?.readiness?.().openai_image?.configured
                ? "verified_private_png_generation_ready"
                : "provider_configuration_required"
            },
            audio: {
              configured: Boolean(providers?.readiness?.().elevenlabs?.configured),
              reason: providers?.readiness?.().elevenlabs?.configured
                ? "approval_and_orchestration_required"
                : "provider_configuration_required"
            },
            video: {
              configured: Boolean(providers?.readiness?.().luma?.configured),
              reason: providers?.readiness?.().luma?.configured
                ? "asynchronous_rendering_and_private_ingestion_ready"
                : "provider_configuration_required"
            }
          },
          automatic_actions: [
            "bounded_retry",
            "incident_persistence",
            "credit_release_on_no_durable_output",
            "request_specific_validation",
            "expired_worker_lease_recovery",
            "idempotent_job_submission",
            "asynchronous_provider_polling",
            "media_signature_verification",
            "stripe_webhook_replay_protection"
          ]
        }
      }
    };
  }

  if (name === "get-autonomy-profile") {
    return {
      status: 200,
      payload: {
        data: {
          runtime: "standalone",
          mode: "bounded_autonomy",
          can_diagnose: true,
          can_retry_safe_internal_work: true,
          requires_approval: [
            "paid_provider_submission",
            "financial_transaction",
            "credential_or_permission_change",
            "public_publish",
            "destructive_action",
            "dns_change"
          ]
        }
      }
    };
  }

  throw new HttpError(
    501,
    "function_not_migrated",
    `Function ${name || "(missing)"} has not yet been migrated to the standalone runtime`
  );
};

export const createIabtHandler = ({
  repository,
  config,
  storage = null,
  providers = null,
  emailSender = createTransactionalEmailSender(config)
}) => async (req, res) => {
  const requestId = createId();
  const origin = req.headers.origin || "";
  try {
    if (origin && origin !== config.publicOrigin) {
      throw new HttpError(403, "origin_not_allowed", "Request origin is not allowed");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...responseHeaders(origin),
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key"
      });
      res.end();
      return;
    }

    const url = new URL(req.url || "/", "http://iabt.local");
    const segments = url.pathname.split("/").filter(Boolean);
    const isMultipart = /^multipart\/form-data\b/i.test(
      String(req.headers["content-type"] || "")
    );
    const isStripeWebhook = url.pathname === "/v1/webhooks/stripe";
    const webhookBody = isStripeWebhook ? await readBodyBuffer(req) : null;
    const body = ["POST", "PATCH", "PUT"].includes(req.method) && !isMultipart && !isStripeWebhook
      ? await readJson(req)
      : {};

    let result;
    if (isStripeWebhook) {
      if (req.method !== "POST") {
        throw new HttpError(405, "method_not_allowed", "Method is not allowed");
      }
      result = {
        status: 200,
        payload: await processStripeWebhook({
          rawBody: webhookBody,
          signatureHeader: req.headers["stripe-signature"] || "",
          repository,
          config
        })
      };
    } else if (req.method === "GET" && url.pathname === "/healthz") {
      result = {
        status: 200,
        payload: {
          ok: true,
          service: "iabt-standalone",
          version: "0.7.0",
          base44_required: false
        }
      };
    } else if (req.method === "GET" && url.pathname === "/readyz") {
      const [database, objectStorage, transactionalEmail] = await Promise.all([
        probeHealth(repository, "database"),
        probeHealth(storage, storage?.kind || "missing"),
        probeHealth(emailSender, emailSender?.kind || "disabled")
      ]);
      const emailReady = config.exposeDevelopmentOtp || transactionalEmail.ok;
      const ready = Boolean(database.ok && objectStorage.ok && emailReady);
      result = {
        status: ready ? 200 : 503,
        payload: {
          ok: ready,
          service: "iabt-standalone",
          version: "0.7.0",
          database,
          object_storage: objectStorage,
          transactional_email: transactionalEmail,
          account_access: { ok: Boolean(emailReady), verification_mode: config.exposeDevelopmentOtp ? "development_otp" : "email" },
          migrations: repository.migrationState
            ? {
                total: repository.migrationState.total,
                pending: 0
              }
            : {
                total: 0,
                pending: 0,
                mode: "development_memory"
              },
          base44_required: false
        }
      };
    } else if (req.method === "GET" && url.pathname === "/v1/public-settings") {
      result = {
        status: 200,
        payload: {
          id: "iabt-standalone",
          auth_required: true,
          standalone: true,
          public_settings: {
            app_name: "Intelligent Application Building Tool",
            operator: "Insured Spending, LLC"
          }
        }
      };
    } else if (segments[0] === "v1" && segments[1] === "auth") {
      result = await handleAuth({
        req,
        segments,
        body,
        repository,
        config,
        emailSender
      });
    } else if (segments[0] === "v1" && segments[1] === "entities") {
      result = await handleEntity({ req, segments, body, repository, config });
    } else if (
      segments[0] === "v1" &&
      segments[1] === "agents" &&
      segments[2] === "conversations"
    ) {
      result = await handleAgents({
        req,
        segments,
        body,
        repository,
        config,
        providers,
        storage
      });
    } else if (segments[0] === "v1" && segments[1] === "functions") {
      result = await handleFunction({
        req,
        segments,
        body,
        repository,
        config,
        storage,
        providers
      });
    } else if (segments[0] === "v1" && segments[1] === "jobs") {
      result = await handleJobs({ req, segments, repository });
    } else if (segments[0] === "v1" && segments[1] === "artifacts") {
      result = await handleArtifacts({ req, repository, storage });
    } else if (
      req.method === "GET" &&
      segments[0] === "v1" &&
      segments[1] === "providers" &&
      segments[2] === "readiness"
    ) {
      await authenticate(req, repository);
      result = {
        status: 200,
        payload: providers?.readiness?.() || {}
      };
    } else if (segments[0] === "v1" && segments[1] === "files") {
      result = await handleFiles({
        req,
        res,
        url,
        segments,
        repository,
        config,
        storage,
        origin
      });
    } else {
      throw new HttpError(404, "route_not_found", "Route was not found");
    }

    if (result?.direct) return;
    send(res, result.status, result.payload, origin);
  } catch (error) {
    const declaredStatus = Number(error.status);
    const expected = Number.isInteger(declaredStatus) && declaredStatus >= 400 && declaredStatus <= 599;
    const status = expected ? declaredStatus : 500;
    const code = expected ? error.code || "request_failed" : "internal_error";
    if (!expected) {
      // Driver errors can contain connection details, SQL, or submitted values.
      // Preserve a correlation ID without exposing those values in API/logs.
      console.error({ requestId, code });
    }
    send(
      res,
      status,
      {
        error: code,
        message: !expected
          ? "The server could not complete the request"
          : error.message,
        request_id: requestId
      },
      origin
    );
  }
};
