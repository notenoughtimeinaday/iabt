import { createId } from "./security.js";

const clone = (value) => structuredClone(value);
const nowIso = () => new Date().toISOString();

const publicUser = (user) => {
  if (!user) return null;
  const { password_hash: _passwordHash, ...safe } = user;
  return clone(safe);
};

const compare = (actual, expected) => {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("$in" in expected) return expected.$in.includes(actual);
    if ("$ne" in expected) return actual !== expected.$ne;
    if ("$gt" in expected) return actual > expected.$gt;
    if ("$gte" in expected) return actual >= expected.$gte;
    if ("$lt" in expected) return actual < expected.$lt;
    if ("$lte" in expected) return actual <= expected.$lte;
  }
  return actual === expected;
};

const matches = (record, query = {}) =>
  Object.entries(query || {}).every(([key, expected]) => compare(record[key], expected));

const sortRecords = (records, sort = "-created_date") => {
  const descending = String(sort || "").startsWith("-");
  const field = String(sort || "created_date").replace(/^-/, "");
  return records.sort((a, b) => {
    const left = a[field] ?? "";
    const right = b[field] ?? "";
    if (left === right) return 0;
    const value = left > right ? 1 : -1;
    return descending ? -value : value;
  });
};

const sanitizeRecordInput = (input = {}) => {
  const copy = clone(input);
  delete copy.id;
  delete copy.owner_id;
  delete copy.created_date;
  delete copy.updated_date;
  return copy;
};

export class MemoryRepository {
  constructor() {
    this.users = new Map();
    this.userIdsByEmail = new Map();
    this.sessions = new Map();
    this.challenges = new Map();
    this.records = new Map();
    this.auditEvents = [];
    this.jobs = new Map();
    this.jobIdsByOwnerKey = new Map();
    this.creditAccounts = new Map();
    this.creditEntries = [];
    this.incidents = new Map();
    this.storedObjects = new Map();
  }

  async createUser({ email, passwordHash, name = "", role = "user", emailVerified = false }) {
    if (this.userIdsByEmail.has(email)) return null;
    const timestamp = nowIso();
    const user = {
      id: createId(),
      email,
      name,
      role,
      email_verified: emailVerified,
      password_hash: passwordHash,
      created_date: timestamp,
      updated_date: timestamp
    };
    this.users.set(user.id, user);
    this.userIdsByEmail.set(email, user.id);
    return publicUser(user);
  }

  async findUserByEmail(email, { includeSecret = false } = {}) {
    const id = this.userIdsByEmail.get(email);
    const user = id ? this.users.get(id) : null;
    return includeSecret ? clone(user) : publicUser(user);
  }

  async getUser(id) {
    return publicUser(this.users.get(id));
  }

  async markUserVerified(id) {
    const user = this.users.get(id);
    if (!user) return null;
    user.email_verified = true;
    user.updated_date = nowIso();
    return publicUser(user);
  }

  async updatePassword(id, passwordHash) {
    const user = this.users.get(id);
    if (!user) return null;
    user.password_hash = passwordHash;
    user.updated_date = nowIso();
    return publicUser(user);
  }

  async createSession({ tokenHash, userId, expiresAt }) {
    this.sessions.set(tokenHash, {
      token_hash: tokenHash,
      user_id: userId,
      expires_at: expiresAt,
      created_date: nowIso()
    });
  }

  async getSession(tokenHash) {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return clone(session);
  }

  async deleteSession(tokenHash) {
    this.sessions.delete(tokenHash);
  }

  async saveChallenge({ email, purpose, codeHash, expiresAt }) {
    this.challenges.set(`${purpose}:${email}`, {
      email,
      purpose,
      code_hash: codeHash,
      expires_at: expiresAt
    });
  }

  async consumeChallenge({ email, purpose, codeHash }) {
    const key = `${purpose}:${email}`;
    const challenge = this.challenges.get(key);
    if (!challenge) return false;
    this.challenges.delete(key);
    return (
      challenge.code_hash === codeHash &&
      new Date(challenge.expires_at).getTime() > Date.now()
    );
  }

  canAccess(record, user) {
    return Boolean(record && user && (user.role === "admin" || record.owner_id === user.id));
  }

  entityMap(entityName) {
    if (!this.records.has(entityName)) this.records.set(entityName, new Map());
    return this.records.get(entityName);
  }

  async listRecords(entityName, user, { query = {}, sort, limit = 50, skip = 0 } = {}) {
    const visible = [...this.entityMap(entityName).values()]
      .filter((record) => this.canAccess(record, user))
      .filter((record) => matches(record, query));
    return clone(sortRecords(visible, sort).slice(skip, skip + limit));
  }

  async getRecord(entityName, id, user) {
    const record = this.entityMap(entityName).get(id);
    return this.canAccess(record, user) ? clone(record) : null;
  }

  async createRecord(entityName, user, input) {
    const timestamp = nowIso();
    const record = {
      ...sanitizeRecordInput(input),
      id: createId(),
      owner_id: user.id,
      created_date: timestamp,
      updated_date: timestamp
    };
    this.entityMap(entityName).set(record.id, record);
    return clone(record);
  }

  async updateRecord(entityName, id, user, input) {
    const map = this.entityMap(entityName);
    const record = map.get(id);
    if (!this.canAccess(record, user)) return null;
    const updated = {
      ...record,
      ...sanitizeRecordInput(input),
      id: record.id,
      owner_id: record.owner_id,
      created_date: record.created_date,
      updated_date: nowIso()
    };
    map.set(id, updated);
    return clone(updated);
  }

  async deleteRecord(entityName, id, user) {
    const map = this.entityMap(entityName);
    const record = map.get(id);
    if (!this.canAccess(record, user)) return false;
    return map.delete(id);
  }

  async deleteMany(entityName, user, query = {}) {
    let deleted = 0;
    for (const [id, record] of this.entityMap(entityName)) {
      if (this.canAccess(record, user) && matches(record, query)) {
        this.entityMap(entityName).delete(id);
        deleted += 1;
      }
    }
    return { deleted };
  }

  async appendAudit(user, action, metadata = {}) {
    this.auditEvents.push({
      id: createId(),
      actor_user_id: user?.id || null,
      action,
      metadata: clone(metadata),
      created_date: nowIso()
    });
  }

  creditAccount(ownerId) {
    if (!this.creditAccounts.has(ownerId)) {
      this.creditAccounts.set(ownerId, {
        owner_id: ownerId,
        available_credits: 0,
        reserved_credits: 0,
        updated_date: nowIso()
      });
    }
    return this.creditAccounts.get(ownerId);
  }

  async getCreditAccount(ownerId) {
    return clone(this.creditAccount(ownerId));
  }

  async grantCredits({ ownerId, amount, idempotencyKey, metadata = {} }) {
    const existing = this.creditEntries.find(
      (entry) =>
        entry.owner_id === ownerId &&
        entry.entry_type === "grant" &&
        entry.idempotency_key === idempotencyKey
    );
    if (existing) return this.getCreditAccount(ownerId);
    const value = Math.floor(Number(amount));
    if (!Number.isInteger(value) || value <= 0) throw new Error("Credit grant must be positive");
    const account = this.creditAccount(ownerId);
    account.available_credits += value;
    account.updated_date = nowIso();
    this.creditEntries.push({
      id: createId(),
      owner_id: ownerId,
      job_id: null,
      entry_type: "grant",
      amount: value,
      idempotency_key: idempotencyKey,
      metadata: clone(metadata),
      created_date: nowIso()
    });
    return clone(account);
  }

  async enqueueJob({
    ownerId,
    jobType,
    input = {},
    approval = {},
    idempotencyKey,
    creditAmount = 0,
    maxAttempts = 3
  }) {
    const ownerKey = ownerId + ":" + idempotencyKey;
    const existingId = this.jobIdsByOwnerKey.get(ownerKey);
    if (existingId) return clone(this.jobs.get(existingId));
    const credits = Math.max(0, Math.floor(Number(creditAmount) || 0));
    const account = this.creditAccount(ownerId);
    if (credits > account.available_credits) {
      throw Object.assign(new Error("Insufficient IABT credits"), {
        status: 402,
        code: "insufficient_credits"
      });
    }
    const timestamp = nowIso();
    const job = {
      id: createId(),
      owner_id: ownerId,
      job_type: jobType,
      status: "queued",
      input: clone(input),
      output: {},
      approval: clone(approval),
      idempotency_key: idempotencyKey,
      credit_amount: credits,
      attempt_count: 0,
      max_attempts: Math.max(1, Math.min(10, Math.floor(maxAttempts))),
      available_at: timestamp,
      locked_at: null,
      locked_by: null,
      last_error_code: null,
      last_error_message: null,
      created_date: timestamp,
      updated_date: timestamp,
      completed_date: null
    };
    account.available_credits -= credits;
    account.reserved_credits += credits;
    account.updated_date = timestamp;
    this.jobs.set(job.id, job);
    this.jobIdsByOwnerKey.set(ownerKey, job.id);
    if (credits > 0) {
      this.creditEntries.push({
        id: createId(),
        owner_id: ownerId,
        job_id: job.id,
        entry_type: "reserve",
        amount: credits,
        idempotency_key: idempotencyKey,
        metadata: {},
        created_date: timestamp
      });
    }
    return clone(job);
  }

  async claimNextJob({ workerId, leaseMs = 300000 }) {
    const now = Date.now();
    const candidates = [...this.jobs.values()]
      .filter((job) =>
        (job.status === "queued" && new Date(job.available_at).getTime() <= now) ||
        (job.status === "running" &&
          new Date(job.locked_at || 0).getTime() + leaseMs <= now)
      )
      .sort((a, b) => a.created_date.localeCompare(b.created_date));
    const job = candidates[0];
    if (!job) return null;
    job.status = "running";
    job.locked_by = workerId;
    job.locked_at = nowIso();
    job.attempt_count += 1;
    job.updated_date = nowIso();
    return clone(job);
  }

  async createStoredObject({
    id = createId(),
    ownerId,
    jobId = null,
    storageProvider,
    storageKey,
    originalName,
    contentType,
    sizeBytes,
    sha256
  }) {
    const record = {
      id,
      owner_id: ownerId,
      job_id: jobId,
      storage_provider: storageProvider,
      storage_key: storageKey,
      original_name: originalName,
      content_type: contentType,
      size_bytes: sizeBytes,
      sha256,
      created_date: nowIso()
    };
    this.storedObjects.set(id, record);
    return clone(record);
  }

  async getStoredObject(id, user) {
    const record = this.storedObjects.get(id);
    return this.canAccess(record, user) ? clone(record) : null;
  }

  async getStoredObjectById(id) {
    return clone(this.storedObjects.get(id) || null);
  }

  async completeJob({ jobId, workerId, output = {}, artifact = null }) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.locked_by !== workerId) {
      throw Object.assign(new Error("Job lease is no longer owned by this worker"), {
        code: "job_lease_lost"
      });
    }
    if (job.credit_amount > 0 && !artifact) {
      throw Object.assign(new Error("Credits cannot be captured without a durable artifact"), {
        code: "durable_output_required"
      });
    }
    const stored = artifact ? await this.createStoredObject({ ...artifact, jobId }) : null;
    const timestamp = nowIso();
    job.status = "succeeded";
    job.output = { ...clone(output), ...(stored ? { artifact_id: stored.id } : {}) };
    job.locked_at = null;
    job.locked_by = null;
    job.updated_date = timestamp;
    job.completed_date = timestamp;
    const account = this.creditAccount(job.owner_id);
    account.reserved_credits -= job.credit_amount;
    account.updated_date = timestamp;
    if (job.credit_amount > 0) {
      this.creditEntries.push({
        id: createId(),
        owner_id: job.owner_id,
        job_id: job.id,
        entry_type: "capture",
        amount: job.credit_amount,
        idempotency_key: job.idempotency_key,
        metadata: {},
        created_date: timestamp
      });
    }
    return { job: clone(job), artifact: stored };
  }

  async failJob({ jobId, workerId, error, retryAt = null }) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.locked_by !== workerId) {
      throw Object.assign(new Error("Job lease is no longer owned by this worker"), {
        code: "job_lease_lost"
      });
    }
    const timestamp = nowIso();
    const canRetry = Boolean(retryAt) && job.attempt_count < job.max_attempts;
    job.last_error_code = String(error.code || "job_failed");
    job.last_error_message = String(error.safeMessage || "IABT could not complete this job").slice(0, 500);
    job.locked_at = null;
    job.locked_by = null;
    job.updated_date = timestamp;
    if (canRetry) {
      job.status = "queued";
      job.available_at = retryAt;
      return { job: clone(job), incident: null, released_credits: 0 };
    }
    job.status = error.needsSetup ? "needs_setup" : "failed";
    job.completed_date = timestamp;
    const account = this.creditAccount(job.owner_id);
    account.reserved_credits -= job.credit_amount;
    account.available_credits += job.credit_amount;
    account.updated_date = timestamp;
    if (job.credit_amount > 0) {
      this.creditEntries.push({
        id: createId(),
        owner_id: job.owner_id,
        job_id: job.id,
        entry_type: "release",
        amount: job.credit_amount,
        idempotency_key: job.idempotency_key,
        metadata: { error_code: job.last_error_code },
        created_date: timestamp
      });
    }
    const incident = {
      id: createId(),
      owner_id: job.owner_id,
      job_id: job.id,
      category: error.category || "execution",
      error_code: job.last_error_code,
      safe_message: job.last_error_message,
      details: clone(error.details || {}),
      resolved_at: null,
      created_date: timestamp
    };
    this.incidents.set(incident.id, incident);
    job.output = {
      incident_id: incident.id,
      recovery: "credit_release",
      released_credits: job.credit_amount
    };
    return { job: clone(job), incident: clone(incident), released_credits: job.credit_amount };
  }

  async listIncidents(user, { limit = 50 } = {}) {
    return clone(
      [...this.incidents.values()]
        .filter((incident) => this.canAccess(incident, user))
        .sort((a, b) => b.created_date.localeCompare(a.created_date))
        .slice(0, limit)
    );
  }

  async getJob(id, user) {
    const job = this.jobs.get(id);
    return this.canAccess(job, user) ? clone(job) : null;
  }

  async listJobs(user, { limit = 50 } = {}) {
    return clone(
      [...this.jobs.values()]
        .filter((job) => this.canAccess(job, user))
        .sort((a, b) => b.created_date.localeCompare(a.created_date))
        .slice(0, limit)
    );
  }
}
