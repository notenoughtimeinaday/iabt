import { createHash } from "node:crypto";
import {
  createId,
  createOpaqueToken,
  createOtp,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyPassword
} from "./security.js";
import { readSingleFile } from "./multipart.js";
import {
  createCreationPlan,
  executeCreationPlan
} from "./creation/planner.js";

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

const readJson = async (req) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      throw new HttpError(413, "request_too_large", "Request body exceeds 1 MB");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

const challengeHash = (config, { email, purpose, code }) =>
  hashToken(`${config.authSecret}:${purpose}:${email}:${code}`);

const issueChallenge = async (repository, config, email, purpose) => {
  const code = createOtp();
  await repository.saveChallenge({
    email,
    purpose,
    codeHash: challengeHash(config, { email, purpose, code }),
    expiresAt: new Date(Date.now() + config.challengeTtlMs).toISOString()
  });
  return config.exposeDevelopmentOtp ? { dev_otp: code } : {};
};

const issueSession = async (repository, config, user) => {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
  await repository.createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt
  });
  return { access_token: token, expires_at: expiresAt, user };
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

const handleAuth = async ({ req, segments, body, repository, config }) => {
  const action = segments[2];

  if (req.method === "POST" && action === "register") {
    const email = normalizeEmail(body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new HttpError(400, "invalid_email", "A valid email address is required");
    }
    const existing = await repository.findUserByEmail(email);
    if (existing) throw new HttpError(409, "email_exists", "An account already exists");
    const passwordHash = await hashPassword(body.password);
    const user = await repository.createUser({
      email,
      passwordHash,
      name: String(body.name || "").trim(),
      emailVerified: false
    });
    const challenge = await issueChallenge(repository, config, email, "verify_email");
    return { status: 201, payload: { requires_verification: true, ...challenge, user } };
  }

  if (req.method === "POST" && action === "verify-otp") {
    const email = normalizeEmail(body.email);
    const code = String(body.otpCode || body.code || "").trim();
    const valid = await repository.consumeChallenge({
      email,
      purpose: "verify_email",
      codeHash: challengeHash(config, {
        email,
        purpose: "verify_email",
        code
      })
    });
    if (!valid) throw new HttpError(400, "invalid_otp", "Verification code is invalid or expired");
    const stored = await repository.findUserByEmail(email);
    if (!stored) throw new HttpError(400, "invalid_otp", "Verification code is invalid or expired");
    const user = await repository.markUserVerified(stored.id);
    return { status: 200, payload: await issueSession(repository, config, user) };
  }

  if (req.method === "POST" && action === "resend-otp") {
    const email = normalizeEmail(body.email);
    const user = await repository.findUserByEmail(email);
    const challenge = user
      ? await issueChallenge(repository, config, email, "verify_email")
      : {};
    return { status: 200, payload: { accepted: true, ...challenge } };
  }

  if (req.method === "POST" && action === "login") {
    const email = normalizeEmail(body.email);
    const stored = await repository.findUserByEmail(email, { includeSecret: true });
    const valid = stored && (await verifyPassword(body.password, stored.password_hash));
    if (!valid) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    if (!stored.email_verified) {
      throw new HttpError(403, "email_unverified", "Verify the email address before signing in");
    }
    const { password_hash: _passwordHash, ...user } = stored;
    return { status: 200, payload: await issueSession(repository, config, user) };
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
    const email = normalizeEmail(body.email);
    const user = await repository.findUserByEmail(email);
    const challenge = user
      ? await issueChallenge(repository, config, email, "reset_password")
      : {};
    return { status: 200, payload: { accepted: true, ...challenge } };
  }

  if (req.method === "POST" && action === "reset") {
    const email = normalizeEmail(body.email);
    const code = String(body.resetToken || body.code || "").trim();
    const valid = await repository.consumeChallenge({
      email,
      purpose: "reset_password",
      codeHash: challengeHash(config, {
        email,
        purpose: "reset_password",
        code
      })
    });
    if (!valid) throw new HttpError(400, "invalid_reset", "Reset code is invalid or expired");
    const user = await repository.findUserByEmail(email);
    if (!user) throw new HttpError(400, "invalid_reset", "Reset code is invalid or expired");
    await repository.updatePassword(user.id, await hashPassword(body.newPassword));
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
  if (config.serverManagedEntities.has(entityName) && !readOperation) {
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
  providers
}) => {
  const { user } = await authenticate(req, repository);
  const conversationId = segments[3];

  if (segments.length === 3 && req.method === "GET") {
    return {
      status: 200,
      payload: await repository.listRecords("AgentConversation", user, {
        sort: "-updated_date",
        limit: 250
      })
    };
  }

  if (segments.length === 3 && req.method === "POST") {
    const record = await repository.createRecord("AgentConversation", user, {
      ...asObject(body),
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
    const query = body.agent_name ? { agent_name: body.agent_name } : {};
    return {
      status: 200,
      payload: await repository.listRecords("AgentConversation", user, {
        query,
        sort: "-updated_date",
        limit: 250
      })
    };
  }

  if (conversationId && segments.length === 4 && req.method === "GET") {
    const record = await repository.getRecord("AgentConversation", conversationId, user);
    if (!record) throw new HttpError(404, "conversation_not_found", "Conversation was not found");
    return { status: 200, payload: record };
  }

  if (conversationId && segments[4] === "messages" && req.method === "POST") {
    const record = await repository.getRecord("AgentConversation", conversationId, user);
    if (!record) throw new HttpError(404, "conversation_not_found", "Conversation was not found");
    const message = {
      id: createId(),
      role: String(body.role || "user"),
      content: String(body.content || ""),
      created_date: new Date().toISOString()
    };
    let messages = [...(record.messages || []), message];
    let updated = await repository.updateRecord("AgentConversation", conversationId, user, {
      messages
    });
    await repository.appendAudit(user, "conversation.message", {
      conversation_id: conversationId,
      message_id: message.id
    });

    if (message.role === "user" && message.content.trim().length >= 3) {
      try {
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
        updated = await repository.updateRecord("AgentConversation", conversationId, user, {
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
        updated = await repository.updateRecord("AgentConversation", conversationId, user, {
          messages: [...messages, assistant]
        });
      }
    }
    return { status: 200, payload: updated };
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
  mode: job.input?.intent === "audio" ? "render" : "prepare",
  provider: job.job_type.startsWith("provider.")
    ? job.job_type.split(".")[1]
    : "iabt-standalone",
  status: job.status,
  progress:
    job.status === "succeeded" || job.status === "failed" || job.status === "needs_setup"
      ? 100
      : job.status === "running"
        ? 50
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

  if (name === "get-system-health") {
    const incidents = await repository.listIncidents(user, { limit: 20 });
    return {
      status: 200,
      payload: {
        data: {
          version: "iabt-standalone-0.2.0",
          runtime: "standalone",
          base44_required: false,
          authenticated_user_id: user.id,
          healthy: true,
          operational_core: {
            durable_job_queue: true,
            lease_recovery: true,
            incident_persistence: true,
            transactional_credit_lifecycle: true,
            private_object_storage: Boolean(storage),
            storage_provider: storage?.kind || "not_configured",
            direct_provider_adapters: Boolean(providers),
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
            app: { configured: false, reason: "creation_orchestrator_pending" },
            website: { configured: false, reason: "creation_orchestrator_pending" },
            document: { configured: false, reason: "document_generator_pending" },
            audio: {
              configured: Boolean(providers?.readiness?.().elevenlabs?.configured),
              reason: providers?.readiness?.().elevenlabs?.configured
                ? "approval_and_orchestration_required"
                : "provider_configuration_required"
            },
            video: {
              configured: Boolean(providers?.readiness?.().luma?.configured),
              reason: providers?.readiness?.().luma?.configured
                ? "approval_and_orchestration_required"
                : "provider_configuration_required"
            }
          },
          automatic_actions: [
            "bounded_retry",
            "incident_persistence",
            "credit_release_on_no_durable_output",
            "request_specific_validation",
            "expired_worker_lease_recovery",
            "idempotent_job_submission"
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
  providers = null
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
    const body = ["POST", "PATCH", "PUT"].includes(req.method) && !isMultipart
      ? await readJson(req)
      : {};

    let result;
    if (req.method === "GET" && url.pathname === "/healthz") {
      result = {
        status: 200,
        payload: {
          ok: true,
          service: "iabt-standalone",
          version: "0.2.0",
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
      result = await handleAuth({ req, segments, body, repository, config });
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
        providers
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
    const status = Number(error.status) || 500;
    const code = error.code || "internal_error";
    if (status >= 500 && code === "internal_error") {
      console.error({ requestId, code, error });
    }
    send(
      res,
      status,
      {
        error: code,
        message: status >= 500 && code === "internal_error"
          ? "The server could not complete the request"
          : error.message,
        request_id: requestId
      },
      origin
    );
  }
};
