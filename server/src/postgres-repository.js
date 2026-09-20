import pg from "pg";
import { createId } from "./security.js";
import { applyMigrations } from "./migrations.js";

const { Pool } = pg;
const clone = (value) => structuredClone(value);

const safeUser = (row, includeSecret = false) => {
  if (!row) return null;
  const user = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    email_verified: row.email_verified,
    created_date: row.created_at?.toISOString?.() || row.created_at,
    updated_date: row.updated_at?.toISOString?.() || row.updated_at
  };
  if (includeSecret) user.password_hash = row.password_hash;
  return user;
};

const timestamp = (value) => value?.toISOString?.() || value || null;
const maintenanceFromRow = (row) => row ? {
  ...clone(row),
  next_run_at: timestamp(row.next_run_at), lease_expires_at: timestamp(row.lease_expires_at),
  last_started_at: timestamp(row.last_started_at), last_completed_at: timestamp(row.last_completed_at),
  created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at)
} : null;

const recordFromRow = (row) => ({
  ...clone(row.payload || {}),
  id: row.id,
  owner_id: row.owner_id,
  created_date: timestamp(row.created_at),
  updated_date: timestamp(row.updated_at)
});

const jobFromRow = (row) => row
  ? {
      id: row.id,
      owner_id: row.owner_id,
      job_type: row.job_type,
      status: row.status,
      input: clone(row.input || {}),
      output: clone(row.output || {}),
      approval: clone(row.approval || {}),
      idempotency_key: row.idempotency_key,
      credit_amount: row.credit_amount,
      attempt_count: row.attempt_count,
      max_attempts: row.max_attempts,
      lease_recovered: Boolean(row.lease_recovered),
      attempts_exhausted: Boolean(row.attempts_exhausted),
      available_at: timestamp(row.available_at),
      locked_at: timestamp(row.locked_at),
      locked_by: row.locked_by,
      last_error_code: row.last_error_code,
      last_error_message: row.last_error_message,
      created_date: timestamp(row.created_at),
      updated_date: timestamp(row.updated_at),
      completed_date: timestamp(row.completed_at)
    }
  : null;

const objectFromRow = (row) => row
  ? {
      id: row.id,
      owner_id: row.owner_id,
      job_id: row.job_id,
      storage_provider: row.storage_provider,
      storage_key: row.storage_key,
      original_name: row.original_name,
      content_type: row.content_type,
      size_bytes: Number(row.size_bytes),
      sha256: row.sha256,
      created_date: timestamp(row.created_at)
    }
  : null;

const sanitizeRecordInput = (input = {}) => {
  const copy = clone(input);
  delete copy.id;
  delete copy.owner_id;
  delete copy.created_date;
  delete copy.updated_date;
  return copy;
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
    const result = left > right ? 1 : -1;
    return descending ? -result : result;
  });
};

const takeAuthChallenge = async (client, { email, purpose, codeHash }) => {
  const result = await client.query(
    `SELECT code_hash, expires_at, attempts FROM iabt_auth_challenges
     WHERE email = $1 AND purpose = $2 FOR UPDATE`,
    [email, purpose]
  );
  const challenge = result.rows[0];
  if (!challenge) return false;
  if (new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= 5) {
    await client.query("DELETE FROM iabt_auth_challenges WHERE email = $1 AND purpose = $2", [email, purpose]);
    return false;
  }
  if (challenge.code_hash !== codeHash) {
    await client.query("UPDATE iabt_auth_challenges SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2", [email, purpose]);
    return false;
  }
  await client.query("DELETE FROM iabt_auth_challenges WHERE email = $1 AND purpose = $2", [email, purpose]);
  return true;
};

export class PostgresRepository {
  constructor({ connectionString, pool } = {}) {
    this.pool =
      pool ||
      new Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl:
          connectionString && !/localhost|127\.0\.0\.1/.test(connectionString)
            ? { rejectUnauthorized: true }
            : undefined
      });
  }

  // All Exchange consent/block workflows share a database transaction lock.
  // Unlike a process-local mutex this also serializes multiple API instances.
  // The callback must only use records/users/audit methods on its repository;
  // it must not perform network calls or start another transaction.
  async withRecordTransaction(callback) {
    if (this.recordTransactionActive) return callback(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SELECT pg_advisory_xact_lock(1782451011)");
      const transaction = new PostgresRepository({ pool: client });
      transaction.recordTransactionActive = true;
      const result = await callback(transaction);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // Security decisions must filter before limiting results. In particular an
  // old active block cannot disappear behind newer unrelated records.
  async listRecordsExact(entityName, user, { query = {}, sort = "-created_date", limit = 50 } = {}) {
    const payload = {};
    const params = [entityName];
    const clauses = ["entity_name = $1"];
    if (user.role !== "admin") clauses.push(`owner_id = $${params.push(user.id)}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        throw new Error("Exact record queries require scalar values");
      }
      if (key === "id" || key === "owner_id") clauses.push(`${key} = $${params.push(value)}`);
      else payload[key] = value;
    }
    if (Object.keys(payload).length) clauses.push(`payload @> $${params.push(JSON.stringify(payload))}::jsonb`);
    const descending = String(sort).startsWith("-");
    const field = String(sort).replace(/^-/, "");
    const column = { id: "id", owner_id: "owner_id", created_date: "created_at", updated_date: "updated_at" }[field];
    const order = column || `payload ->> $${params.push(field)}`;
    const bound = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 50)));
    const result = await this.pool.query(
      `SELECT entity_name, id, owner_id, payload, created_at, updated_at
       FROM iabt_entity_records WHERE ${clauses.join(" AND ")}
       ORDER BY ${order} ${descending ? "DESC" : "ASC"} NULLS LAST, id ASC
       LIMIT $${params.push(bound)}`,
      params
    );
    return result.rows.map(recordFromRow);
  }

  async ready() {
    await this.pool.query("SELECT 1");
    this.migrationState = await applyMigrations(this.pool);
    return this.migrationState;
  }

  async health() {
    await this.pool.query("SELECT 1");
    return { ok: true, adapter: "postgres" };
  }

  async close() {
    await this.pool.end();
  }

  async createUser({ email, passwordHash, name = "", role = "user", emailVerified = false }) {
    const result = await this.pool.query(
      `INSERT INTO iabt_users
        (id, email, name, role, email_verified, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [createId(), email, name, role, emailVerified, passwordHash]
    );
    return safeUser(result.rows[0]);
  }

  async findUserByEmail(email, { includeSecret = false } = {}) {
    const result = await this.pool.query(
      "SELECT * FROM iabt_users WHERE email = $1 LIMIT 1",
      [email]
    );
    return safeUser(result.rows[0], includeSecret);
  }

  async getUser(id) {
    const result = await this.pool.query(
      "SELECT * FROM iabt_users WHERE id = $1 LIMIT 1",
      [id]
    );
    return safeUser(result.rows[0]);
  }

  async markUserVerified(id) {
    const result = await this.pool.query(
      `UPDATE iabt_users
       SET email_verified = true, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return safeUser(result.rows[0]);
  }

  async updatePassword(id, passwordHash) {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        "UPDATE iabt_users SET password_hash = $2, email_verified = true, updated_at = now() WHERE id = $1 RETURNING *",
        [id, passwordHash]
      );
      await client.query("DELETE FROM iabt_auth_sessions WHERE user_id = $1", [id]);
      return safeUser(result.rows[0]);
    });
  }

  async createSession({ tokenHash, userId, expiresAt, expectedPasswordHash }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT email_verified, password_hash FROM iabt_users WHERE id = $1 FOR UPDATE", [userId]);
      const user = result.rows[0];
      if (!user?.email_verified || (expectedPasswordHash && user.password_hash !== expectedPasswordHash)) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `INSERT INTO iabt_auth_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [tokenHash, userId, expiresAt]
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(tokenHash) {
    const result = await this.pool.query(
      `SELECT token_hash, user_id, expires_at, created_at
       FROM iabt_auth_sessions
       WHERE token_hash = $1 AND expires_at > now()
       LIMIT 1`,
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  async deleteSession(tokenHash) {
    await this.pool.query(
      "DELETE FROM iabt_auth_sessions WHERE token_hash = $1",
      [tokenHash]
    );
  }

  async consumeAuthRateLimit({ keyHash, maxAttempts, windowMs }) {
    await this.pool.query("DELETE FROM iabt_auth_rate_limits WHERE expires_at <= now()");
    const result = await this.pool.query(
      `INSERT INTO iabt_auth_rate_limits (key_hash, attempts, expires_at)
       VALUES ($1, 1, now() + ($2::bigint * interval '1 millisecond'))
       ON CONFLICT (key_hash) DO UPDATE
       SET attempts = CASE WHEN iabt_auth_rate_limits.expires_at <= now() THEN 1
                           ELSE LEAST(iabt_auth_rate_limits.attempts + 1, $3 + 1) END,
           expires_at = CASE WHEN iabt_auth_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at
                             ELSE iabt_auth_rate_limits.expires_at END
       RETURNING attempts`,
      [keyHash, windowMs, maxAttempts]
    );
    return result.rows[0].attempts <= maxAttempts;
  }

  async saveChallenge({ email, purpose, codeHash, expiresAt }) {
    await this.pool.query(
      `INSERT INTO iabt_auth_challenges
        (email, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email, purpose) DO UPDATE
       SET code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at,
           attempts = 0,
           created_at = now()`,
      [email, purpose, codeHash, expiresAt]
    );
  }

  async consumeChallenge(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const valid = await takeAuthChallenge(client, input);
      await client.query("COMMIT");
      return valid;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeAuthChallenge({ email, purpose, codeHash, passwordHash, session }) {
    if (!["verify_email", "reset_password"].includes(purpose)) return null;
    if (purpose === "reset_password" && !passwordHash) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the user before any challenge/session rows to serialize reset with login.
      const result = await client.query("SELECT * FROM iabt_users WHERE email = $1 FOR UPDATE", [email]);
      const user = result.rows[0];
      if (!user || (purpose === "verify_email" && user.email_verified) ||
          !(await takeAuthChallenge(client, { email, purpose, codeHash }))) {
        await client.query("COMMIT");
        return null;
      }
      const updated = await client.query(
        `UPDATE iabt_users SET email_verified = true,
         password_hash = COALESCE($2, password_hash), updated_at = now() WHERE id = $1 RETURNING *`,
        [user.id, purpose === "reset_password" ? passwordHash : null]
      );
      if (purpose === "reset_password") {
        await client.query("DELETE FROM iabt_auth_sessions WHERE user_id = $1", [user.id]);
        await client.query("DELETE FROM iabt_auth_challenges WHERE email = $1", [email]);
      } else if (session) {
        await client.query(
          "INSERT INTO iabt_auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
          [session.tokenHash, user.id, session.expiresAt]
        );
      }
      await client.query("COMMIT");
      return safeUser(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecords(entityName, user, { query = {}, sort, limit = 50, skip = 0 } = {}) {
    const params = [entityName];
    const ownerClause =
      user.role === "admin"
        ? ""
        : ` AND owner_id = $${params.push(user.id)}`;
    const result = await this.pool.query(
      `SELECT entity_name, id, owner_id, payload, created_at, updated_at
       FROM iabt_entity_records
       WHERE entity_name = $1${ownerClause}
       ORDER BY updated_at DESC
       LIMIT 5000`,
      params
    );
    const records = result.rows.map(recordFromRow).filter((record) => matches(record, query));
    return sortRecords(records, sort).slice(skip, skip + limit);
  }

  async getRecord(entityName, id, user) {
    const params = [entityName, id];
    const ownerClause =
      user.role === "admin"
        ? ""
        : ` AND owner_id = $${params.push(user.id)}`;
    const result = await this.pool.query(
      `SELECT entity_name, id, owner_id, payload, created_at, updated_at
       FROM iabt_entity_records
       WHERE entity_name = $1 AND id = $2${ownerClause}
       LIMIT 1`,
      params
    );
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async createRecord(entityName, user, input, { id = createId() } = {}) {
    const result = await this.pool.query(
      `INSERT INTO iabt_entity_records
        (entity_name, id, owner_id, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (entity_name, id) DO NOTHING
       RETURNING entity_name, id, owner_id, payload, created_at, updated_at`,
      [entityName, id, user.id, JSON.stringify(sanitizeRecordInput(input))]
    );
    if (result.rows[0]) return recordFromRow(result.rows[0]);
    const existing = await this.getRecord(entityName, id, { ...user, role: "user" });
    if (!existing) throw Object.assign(new Error("Record identity conflict"), { code: "record_conflict", status: 409 });
    return existing;
  }

  async updateRecord(entityName, id, user, input) {
    const existing = await this.getRecord(entityName, id, user);
    if (!existing) return null;
    const payload = {
      ...sanitizeRecordInput(existing),
      ...sanitizeRecordInput(input)
    };
    const params = [entityName, id, JSON.stringify(payload)];
    const ownerClause =
      user.role === "admin"
        ? ""
        : ` AND owner_id = $${params.push(user.id)}`;
    const result = await this.pool.query(
      `UPDATE iabt_entity_records
       SET payload = $3::jsonb, updated_at = now()
       WHERE entity_name = $1 AND id = $2${ownerClause}
       RETURNING entity_name, id, owner_id, payload, created_at, updated_at`,
      params
    );
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async deleteRecord(entityName, id, user) {
    const params = [entityName, id];
    const ownerClause =
      user.role === "admin"
        ? ""
        : ` AND owner_id = $${params.push(user.id)}`;
    const result = await this.pool.query(
      `DELETE FROM iabt_entity_records
       WHERE entity_name = $1 AND id = $2${ownerClause}`,
      params
    );
    return result.rowCount === 1;
  }

  async deleteMany(entityName, user, query = {}) {
    const records = await this.listRecords(entityName, user, {
      query,
      limit: 5000,
      skip: 0
    });
    if (!records.length) return { deleted: 0 };
    const ids = records.map((record) => record.id);
    const params = [entityName, ids];
    const ownerClause =
      user.role === "admin"
        ? ""
        : ` AND owner_id = $${params.push(user.id)}`;
    const result = await this.pool.query(
      `DELETE FROM iabt_entity_records
       WHERE entity_name = $1
         AND id = ANY($2::uuid[])${ownerClause}`,
      params
    );
    return { deleted: result.rowCount };
  }

  async appendAudit(user, action, metadata = {}) {
    await this.pool.query(
      `INSERT INTO iabt_audit_events
        (id, actor_user_id, action, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [createId(), user?.id || null, action, JSON.stringify(metadata)]
    );
  }

  async withTransaction(operation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getCreditAccount(ownerId, client = this.pool) {
    const result = await client.query(
      "SELECT owner_id, available_credits, reserved_credits, updated_at FROM iabt_credit_accounts WHERE owner_id = $1",
      [ownerId]
    );
    const row = result.rows[0];
    return row
      ? {
          owner_id: row.owner_id,
          available_credits: row.available_credits,
          reserved_credits: row.reserved_credits,
          updated_date: timestamp(row.updated_at)
        }
      : { owner_id: ownerId, available_credits: 0, reserved_credits: 0, updated_date: null };
  }

  async startStripeEvent({ eventId, eventType, livemode, payloadSha256 }) {
    const claimed = await this.pool.query(
      "INSERT INTO iabt_stripe_events (event_id, event_type, livemode, status, payload_sha256) VALUES ($1,$2,$3,'processing',$4) ON CONFLICT (event_id) DO UPDATE SET event_type = EXCLUDED.event_type, livemode = EXCLUDED.livemode, status = 'processing', payload_sha256 = EXCLUDED.payload_sha256, error_code = NULL, updated_at = now(), completed_at = NULL WHERE iabt_stripe_events.status = 'failed' OR (iabt_stripe_events.status = 'processing' AND iabt_stripe_events.updated_at < now() - interval '15 minutes') RETURNING *, updated_at::text AS claim_token",
      [eventId, eventType, Boolean(livemode), payloadSha256]
    );
    if (claimed.rowCount) return { claimed: true, event: claimed.rows[0] };
    const existing = await this.pool.query(
      "SELECT * FROM iabt_stripe_events WHERE event_id = $1 LIMIT 1",
      [eventId]
    );
    return { claimed: false, event: existing.rows[0] || null };
  }

  async finishStripeEvent(eventId, { claimToken } = {}) {
    const result = await this.pool.query(
      "UPDATE iabt_stripe_events SET status = 'succeeded', error_code = NULL, updated_at = now(), completed_at = now() WHERE event_id = $1 AND ($2::timestamptz IS NULL OR (status = 'processing' AND updated_at = $2::timestamptz)) RETURNING *",
      [eventId, claimToken || null]
    );
    return result.rows[0] || null;
  }

  async failStripeEvent(eventId, errorCode, { claimToken } = {}) {
    const result = await this.pool.query(
      "UPDATE iabt_stripe_events SET status = 'failed', error_code = $2, updated_at = now() WHERE event_id = $1 AND ($3::timestamptz IS NULL OR (status = 'processing' AND updated_at = $3::timestamptz)) RETURNING *",
      [eventId, String(errorCode || "stripe_event_failed"), claimToken || null]
    );
    return result.rows[0] || null;
  }

  async findLegacyStripeCreditGrants({ checkoutSessionId }) {
    if (!/^cs_[a-zA-Z0-9_]+$/.test(String(checkoutSessionId || ""))) throw new Error("Invalid checkout session identity");
    const result = await this.pool.query(
      `SELECT id, owner_id, amount, idempotency_key, metadata FROM iabt_credit_entries
       WHERE entry_type = 'grant' AND idempotency_key ~ '^stripe:evt_[a-zA-Z0-9_]+$'
         AND metadata ->> 'checkout_session_id' = $1
       LIMIT 2`,
      [checkoutSessionId]
    );
    return result.rows;
  }

  async findStarterCreditGrant(ownerId) {
    const result = await this.pool.query(
      `SELECT id, owner_id, amount, idempotency_key FROM iabt_credit_entries
       WHERE owner_id = $1 AND entry_type = 'grant'
         AND (idempotency_key = 'signup:free:v1' OR metadata ->> 'source' = 'initial_free_allowance')
       LIMIT 1`,
      [ownerId]
    );
    return result.rows[0] || null;
  }

  async grantCredits({ ownerId, amount, idempotencyKey, metadata = {} }) {
    const value = Math.floor(Number(amount));
    if (!Number.isInteger(value) || value <= 0) throw new Error("Credit grant must be positive");
    return this.withTransaction(async (client) => {
      // Distinct webhook deliveries can describe the same purchase. Serialize
      // its grant before the existence check, including the initial account.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`grant:${ownerId}:${idempotencyKey}`]);
      const existing = await client.query(
        "SELECT id FROM iabt_credit_entries WHERE owner_id = $1 AND entry_type = 'grant' AND idempotency_key = $2",
        [ownerId, idempotencyKey]
      );
      if (existing.rowCount) return this.getCreditAccount(ownerId, client);
      await client.query(
        "INSERT INTO iabt_credit_accounts (owner_id, available_credits) VALUES ($1, 0) ON CONFLICT (owner_id) DO NOTHING",
        [ownerId]
      );
      await client.query(
        "UPDATE iabt_credit_accounts SET available_credits = available_credits + $2, updated_at = now() WHERE owner_id = $1",
        [ownerId, value]
      );
      await client.query(
        "INSERT INTO iabt_credit_entries (id, owner_id, entry_type, amount, idempotency_key, metadata) VALUES ($1, $2, 'grant', $3, $4, $5::jsonb)",
        [createId(), ownerId, value, idempotencyKey, JSON.stringify(metadata)]
      );
      return this.getCreditAccount(ownerId, client);
    });
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
    return this.withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`job:${ownerId}:${idempotencyKey}`]);
      const existing = await client.query(
        "SELECT * FROM iabt_jobs WHERE owner_id = $1 AND idempotency_key = $2 LIMIT 1",
        [ownerId, idempotencyKey]
      );
      if (existing.rowCount) return jobFromRow(existing.rows[0]);
      const credits = Math.max(0, Math.floor(Number(creditAmount) || 0));
      await client.query(
        "INSERT INTO iabt_credit_accounts (owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING",
        [ownerId]
      );
      const account = await client.query(
        "SELECT available_credits FROM iabt_credit_accounts WHERE owner_id = $1 FOR UPDATE",
        [ownerId]
      );
      if (credits > account.rows[0].available_credits) {
        throw Object.assign(new Error("Insufficient IABT credits"), {
          status: 402,
          code: "insufficient_credits"
        });
      }
      const id = createId();
      const inserted = await client.query(
        "INSERT INTO iabt_jobs (id, owner_id, job_type, status, input, approval, idempotency_key, credit_amount, max_attempts) VALUES ($1, $2, $3, 'queued', $4::jsonb, $5::jsonb, $6, $7, $8) RETURNING *",
        [
          id,
          ownerId,
          jobType,
          JSON.stringify(input),
          JSON.stringify(approval),
          idempotencyKey,
          credits,
          Math.max(1, Math.min(10, Math.floor(maxAttempts)))
        ]
      );
      if (credits > 0) {
        await client.query(
          "UPDATE iabt_credit_accounts SET available_credits = available_credits - $2, reserved_credits = reserved_credits + $2, updated_at = now() WHERE owner_id = $1",
          [ownerId, credits]
        );
        await client.query(
          "INSERT INTO iabt_credit_entries (id, owner_id, job_id, entry_type, amount, idempotency_key) VALUES ($1, $2, $3, 'reserve', $4, $5)",
          [createId(), ownerId, id, credits, idempotencyKey]
        );
      }
      return jobFromRow(inserted.rows[0]);
    });
  }

  async claimNextJob({ workerId, leaseMs = 300000 }) {
    const result = await this.pool.query(
      "WITH candidate AS (SELECT id, status = 'running' AS lease_recovered, attempt_count >= max_attempts AS attempts_exhausted FROM iabt_jobs WHERE (status = 'queued' AND available_at <= now()) OR (status = 'running' AND locked_at <= now() - ($2::bigint * interval '1 millisecond')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE iabt_jobs job SET status = 'running', locked_by = $1, locked_at = now(), attempt_count = CASE WHEN candidate.attempts_exhausted THEN job.attempt_count ELSE job.attempt_count + 1 END, updated_at = now() FROM candidate WHERE job.id = candidate.id RETURNING job.*, candidate.lease_recovered, candidate.attempts_exhausted",
      [workerId, leaseMs]
    );
    return jobFromRow(result.rows[0]);
  }

  async renewJobLease({ jobId, workerId }) {
    const result = await this.pool.query(
      "UPDATE iabt_jobs SET locked_at = now() WHERE id = $1 AND status = 'running' AND locked_by = $2 RETURNING id",
      [jobId, workerId]
    );
    return result.rowCount === 1;
  }

  async checkpointJob({ jobId, workerId, outputPatch = {} }) {
    const result = await this.pool.query(
      "UPDATE iabt_jobs SET output = output || $3::jsonb, updated_at = now() WHERE id = $1 AND status = 'running' AND locked_by = $2 RETURNING *",
      [jobId, workerId, JSON.stringify(outputPatch)]
    );
    if (!result.rows[0]) throw Object.assign(new Error("Job lease is no longer owned by this worker"), { code: "job_lease_lost" });
    return jobFromRow(result.rows[0]);
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
  }, client = this.pool) {
    const result = await client.query(
      "INSERT INTO iabt_stored_objects (id, owner_id, job_id, storage_provider, storage_key, original_name, content_type, size_bytes, sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [id, ownerId, jobId, storageProvider, storageKey, originalName, contentType, sizeBytes, sha256]
    );
    return objectFromRow(result.rows[0]);
  }

  async getStoredObject(id, user) {
    const params = [id];
    const ownerClause = user.role === "admin" ? "" : " AND owner_id = $" + params.push(user.id);
    const result = await this.pool.query(
      "SELECT * FROM iabt_stored_objects WHERE id = $1" + ownerClause + " LIMIT 1",
      params
    );
    return objectFromRow(result.rows[0]);
  }

  async getStoredObjectById(id) {
    const result = await this.pool.query(
      "SELECT * FROM iabt_stored_objects WHERE id = $1 LIMIT 1",
      [id]
    );
    return objectFromRow(result.rows[0]);
  }

  async listStoredObjects(user, { limit = 100 } = {}) {
    const params = [];
    const ownerClause = user.role === "admin" ? "" : " WHERE owner_id = $" + params.push(user.id);
    params.push(Math.max(1, Math.min(500, limit)));
    const result = await this.pool.query(
      "SELECT * FROM iabt_stored_objects" + ownerClause + " ORDER BY created_at DESC LIMIT $" + params.length,
      params
    );
    return result.rows.map(objectFromRow);
  }

  async completeJob({ jobId, workerId, output = {}, artifact = null, artifacts = [] }) {
    return this.withTransaction(async (client) => {
      const locked = await client.query(
        "SELECT * FROM iabt_jobs WHERE id = $1 FOR UPDATE",
        [jobId]
      );
      const job = jobFromRow(locked.rows[0]);
      if (!job || job.status !== "running" || job.locked_by !== workerId) {
        throw Object.assign(new Error("Job lease is no longer owned by this worker"), {
          code: "job_lease_lost"
        });
      }
      const artifactInputs = artifacts.length ? artifacts : artifact ? [artifact] : [];
      if (job.credit_amount > 0 && !artifactInputs.length) {
        throw Object.assign(new Error("Credits cannot be captured without a durable artifact"), {
          code: "durable_output_required"
        });
      }
      const storedArtifacts = [];
      for (const item of artifactInputs) {
        storedArtifacts.push(await this.createStoredObject({ ...item, jobId }, client));
      }
      const stored = storedArtifacts[0] || null;
      const finalOutput = {
        ...job.output,
        ...output,
        ...(stored
          ? {
              artifact_id: stored.id,
              artifact_ids: storedArtifacts.map((item) => item.id)
            }
          : {})
      };
      const updated = await client.query(
        "UPDATE iabt_jobs SET status = 'succeeded', output = $3::jsonb, locked_at = NULL, locked_by = NULL, updated_at = now(), completed_at = now() WHERE id = $1 AND locked_by = $2 RETURNING *",
        [jobId, workerId, JSON.stringify(finalOutput)]
      );
      if (job.credit_amount > 0) {
        await client.query(
          "UPDATE iabt_credit_accounts SET reserved_credits = reserved_credits - $2, updated_at = now() WHERE owner_id = $1 AND reserved_credits >= $2",
          [job.owner_id, job.credit_amount]
        );
        await client.query(
          "INSERT INTO iabt_credit_entries (id, owner_id, job_id, entry_type, amount, idempotency_key) VALUES ($1,$2,$3,'capture',$4,$5)",
          [createId(), job.owner_id, job.id, job.credit_amount, job.idempotency_key]
        );
      }
      return {
        job: jobFromRow(updated.rows[0]),
        artifact: stored,
        artifacts: storedArtifacts
      };
    });
  }

  async deferJob({
    jobId,
    workerId,
    inputPatch = {},
    outputPatch = {},
    availableAt
  }) {
    const updated = await this.pool.query(
      "UPDATE iabt_jobs SET status = 'queued', input = input || $3::jsonb, output = output || $4::jsonb, available_at = $5, locked_at = NULL, locked_by = NULL, attempt_count = GREATEST(0, attempt_count - 1), updated_at = now() WHERE id = $1 AND status = 'running' AND locked_by = $2 RETURNING *",
      [
        jobId,
        workerId,
        JSON.stringify(inputPatch),
        JSON.stringify(outputPatch),
        availableAt || new Date().toISOString()
      ]
    );
    const job = jobFromRow(updated.rows[0]);
    if (!job) {
      throw Object.assign(new Error("Job lease is no longer owned by this worker"), {
        code: "job_lease_lost"
      });
    }
    return job;
  }

  async failJob({ jobId, workerId, error, retryAt = null }) {
    return this.withTransaction(async (client) => {
      const locked = await client.query(
        "SELECT * FROM iabt_jobs WHERE id = $1 FOR UPDATE",
        [jobId]
      );
      const job = jobFromRow(locked.rows[0]);
      if (!job || job.status !== "running" || job.locked_by !== workerId) {
        throw Object.assign(new Error("Job lease is no longer owned by this worker"), {
          code: "job_lease_lost"
        });
      }
      const errorCode = String(error.code || "job_failed");
      const safeMessage = String(error.safeMessage || "IABT could not complete this job").slice(0, 500);
      const canRetry = Boolean(retryAt) && job.attempt_count < job.max_attempts;
      if (canRetry) {
        const updated = await client.query(
          "UPDATE iabt_jobs SET status = 'queued', available_at = $3, locked_at = NULL, locked_by = NULL, last_error_code = $4, last_error_message = $5, updated_at = now() WHERE id = $1 AND locked_by = $2 RETURNING *",
          [jobId, workerId, retryAt, errorCode, safeMessage]
        );
        return { job: jobFromRow(updated.rows[0]), incident: null, released_credits: 0 };
      }
      const status = error.needsSetup ? "needs_setup" : "failed";
      const updated = await client.query(
        "UPDATE iabt_jobs SET status = $3, locked_at = NULL, locked_by = NULL, last_error_code = $4, last_error_message = $5, updated_at = now(), completed_at = now() WHERE id = $1 AND locked_by = $2 RETURNING *",
        [jobId, workerId, status, errorCode, safeMessage]
      );
      if (job.credit_amount > 0) {
        await client.query(
          "UPDATE iabt_credit_accounts SET reserved_credits = reserved_credits - $2, available_credits = available_credits + $2, updated_at = now() WHERE owner_id = $1 AND reserved_credits >= $2",
          [job.owner_id, job.credit_amount]
        );
        await client.query(
          "INSERT INTO iabt_credit_entries (id, owner_id, job_id, entry_type, amount, idempotency_key, metadata) VALUES ($1,$2,$3,'release',$4,$5,$6::jsonb)",
          [
            createId(),
            job.owner_id,
            job.id,
            job.credit_amount,
            job.idempotency_key,
            JSON.stringify({ error_code: errorCode })
          ]
        );
      }
      const incidentId = createId();
      const incidentResult = await client.query(
        "INSERT INTO iabt_incidents (id, owner_id, job_id, category, error_code, safe_message, details) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *",
        [
          incidentId,
          job.owner_id,
          job.id,
          error.category || "execution",
          errorCode,
          safeMessage,
          JSON.stringify(error.details || {})
        ]
      );
      const incidentRow = incidentResult.rows[0];
      const incident = {
        id: incidentRow.id,
        owner_id: incidentRow.owner_id,
        job_id: incidentRow.job_id,
        category: incidentRow.category,
        error_code: incidentRow.error_code,
        safe_message: incidentRow.safe_message,
        details: incidentRow.details,
        resolved_at: timestamp(incidentRow.resolved_at),
        created_date: timestamp(incidentRow.created_at)
      };
      const finalized = await client.query(
        "UPDATE iabt_jobs SET output = $2::jsonb WHERE id = $1 RETURNING *",
        [
          job.id,
          JSON.stringify({
            ...job.output,
            incident_id: incident.id,
            recovery: "credit_release",
            released_credits: job.credit_amount
          })
        ]
      );
      return {
        job: jobFromRow(finalized.rows[0] || updated.rows[0]),
        incident,
        released_credits: job.credit_amount
      };
    });
  }

  async listIncidents(user, { limit = 50 } = {}) {
    const params = [];
    const ownerClause = user.role === "admin" ? "" : " WHERE owner_id = $" + params.push(user.id);
    params.push(Math.max(1, Math.min(250, limit)));
    const result = await this.pool.query(
      "SELECT * FROM iabt_incidents" + ownerClause + " ORDER BY created_at DESC LIMIT $" + params.length,
      params
    );
    return result.rows.map((row) => ({
      id: row.id,
      owner_id: row.owner_id,
      job_id: row.job_id,
      category: row.category,
      error_code: row.error_code,
      safe_message: row.safe_message,
      details: row.details,
      resolved_at: timestamp(row.resolved_at),
      created_date: timestamp(row.created_at)
    }));
  }

  async getJob(id, user) {
    const params = [id];
    const ownerClause = user.role === "admin" ? "" : " AND owner_id = $" + params.push(user.id);
    const result = await this.pool.query(
      "SELECT * FROM iabt_jobs WHERE id = $1" + ownerClause + " LIMIT 1",
      params
    );
    return jobFromRow(result.rows[0]);
  }

  async listJobs(user, { limit = 50 } = {}) {
    const params = [];
    const ownerClause = user.role === "admin" ? "" : " WHERE owner_id = $" + params.push(user.id);
    params.push(Math.max(1, Math.min(250, limit)));
    const result = await this.pool.query(
      "SELECT * FROM iabt_jobs" + ownerClause + " ORDER BY created_at DESC LIMIT $" + params.length,
      params
    );
    return result.rows.map(jobFromRow);
  }

  async ensureMaintenance({ ownerId, intervalMs = 900000 }) {
    await this.pool.query(`INSERT INTO iabt_maintenance(owner_id, interval_ms)
      SELECT id, $2 FROM iabt_users WHERE id = $1 AND email_verified
      ON CONFLICT(owner_id) DO NOTHING`, [ownerId, intervalMs]);
    return this.getMaintenance(ownerId);
  }

  async getMaintenance(ownerId) {
    const result = await this.pool.query("SELECT * FROM iabt_maintenance WHERE owner_id = $1", [ownerId]);
    return maintenanceFromRow(result.rows[0]);
  }

  async enrollVerifiedMaintenance({ intervalMs = 900000, limit = 100 } = {}) {
    const result = await this.pool.query(`INSERT INTO iabt_maintenance(owner_id, interval_ms)
      SELECT u.id, $1 FROM iabt_users u WHERE u.email_verified
        AND NOT EXISTS (SELECT 1 FROM iabt_maintenance m WHERE m.owner_id = u.id)
      ORDER BY u.created_at, u.id LIMIT $2 ON CONFLICT(owner_id) DO NOTHING`, [intervalMs, Math.max(1, Math.min(100, limit))]);
    return result.rowCount;
  }

  async configureMaintenance({ ownerId, enabled, intervalMs }) {
    const result = await this.pool.query(`UPDATE iabt_maintenance SET enabled = $2, interval_ms = $3,
      next_run_at = now(), lease_token = NULL, locked_by = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE owner_id = $1 RETURNING *`, [ownerId, enabled, intervalMs]);
    return maintenanceFromRow(result.rows[0]);
  }

  async claimDueMaintenance({ workerId, leaseMs }) {
    const result = await this.pool.query(`WITH due AS (
      SELECT m.owner_id FROM iabt_maintenance m JOIN iabt_users u ON u.id = m.owner_id
      WHERE m.enabled AND u.email_verified AND m.next_run_at <= clock_timestamp()
        AND (m.lease_token IS NULL OR m.lease_expires_at <= clock_timestamp())
      ORDER BY m.next_run_at, m.owner_id FOR UPDATE OF m SKIP LOCKED LIMIT 1
    ) UPDATE iabt_maintenance m SET lease_token = $1, locked_by = $2,
      lease_expires_at = clock_timestamp() + $3 * interval '1 millisecond', last_started_at = clock_timestamp(), updated_at = clock_timestamp()
      FROM due WHERE m.owner_id = due.owner_id RETURNING m.*`, [createId(), workerId, leaseMs]);
    return maintenanceFromRow(result.rows[0]);
  }

  async withMaintenanceLease({ ownerId, leaseToken }, callback) {
    return this.withRecordTransaction(async (tx) => {
      const result = await tx.pool.query(`SELECT * FROM iabt_maintenance WHERE owner_id = $1
        AND enabled AND lease_token = $2 AND lease_expires_at > clock_timestamp() FOR UPDATE`, [ownerId, leaseToken]);
      if (!result.rows.length) throw Object.assign(new Error("Maintenance lease changed"), { code: "maintenance_lease_lost" });
      return callback(tx, maintenanceFromRow(result.rows[0]));
    });
  }

  async renewMaintenanceLease({ ownerId, leaseToken, leaseMs }) {
    return this.withMaintenanceLease({ ownerId, leaseToken }, async (tx) => {
      await tx.pool.query("UPDATE iabt_maintenance SET lease_expires_at = clock_timestamp() + $2 * interval '1 millisecond' WHERE owner_id = $1", [ownerId, leaseMs]);
      return true;
    });
  }

  async saveMaintenanceProgress({ ownerId, leaseToken, checkpoint, summary }) {
    return this.withMaintenanceLease({ ownerId, leaseToken }, async (tx) => {
      const result = await tx.pool.query(`UPDATE iabt_maintenance SET checkpoint = COALESCE($2::jsonb, checkpoint),
        summary = COALESCE($3::jsonb, summary), updated_at = now() WHERE owner_id = $1 RETURNING *`,
      [ownerId, checkpoint === undefined ? null : JSON.stringify(checkpoint), summary === undefined ? null : JSON.stringify(summary)]);
      return maintenanceFromRow(result.rows[0]);
    });
  }

  async finishMaintenance({ ownerId, leaseToken, checkpoint, summary, nextRunAt, failed = false }) {
    return this.withMaintenanceLease({ ownerId, leaseToken }, async (tx) => {
      const result = await tx.pool.query(`UPDATE iabt_maintenance SET checkpoint = $2::jsonb, summary = $3::jsonb,
        next_run_at = $4, consecutive_failures = CASE WHEN $5 THEN consecutive_failures + 1 ELSE 0 END,
        last_completed_at = now(), updated_at = now(), lease_token = NULL, locked_by = NULL, lease_expires_at = NULL
        WHERE owner_id = $1 RETURNING *`, [ownerId, JSON.stringify(checkpoint), JSON.stringify(summary), nextRunAt, failed]);
      return maintenanceFromRow(result.rows[0]);
    });
  }

  async listMaintenanceJobs({ ownerId, cursor = null, limit = 25 }) {
    const result = await this.pool.query(`SELECT *, to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS maintenance_completed_at FROM iabt_jobs WHERE owner_id = $1
      AND status IN ('succeeded', 'failed', 'needs_setup') AND completed_at IS NOT NULL
      AND ($2::timestamptz IS NULL OR (completed_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY completed_at, id LIMIT $4`, [ownerId, cursor?.completed_at || null, cursor?.job_id || null, Math.max(1, Math.min(25, limit))]);
    return result.rows.map((row) => ({ ...jobFromRow(row), maintenance_cursor: { completed_at: row.maintenance_completed_at, job_id: row.id } }));
  }
}
