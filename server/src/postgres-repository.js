import pg from "pg";
import { createId } from "./security.js";

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

  async ready() {
    await this.pool.query("SELECT 1");
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
    const result = await this.pool.query(
      `UPDATE iabt_users
       SET password_hash = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, passwordHash]
    );
    return safeUser(result.rows[0]);
  }

  async createSession({ tokenHash, userId, expiresAt }) {
    await this.pool.query(
      `INSERT INTO iabt_auth_sessions
        (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO UPDATE
       SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at`,
      [tokenHash, userId, expiresAt]
    );
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

  async saveChallenge({ email, purpose, codeHash, expiresAt }) {
    await this.pool.query(
      `INSERT INTO iabt_auth_challenges
        (email, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email, purpose) DO UPDATE
       SET code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at,
           created_at = now()`,
      [email, purpose, codeHash, expiresAt]
    );
  }

  async consumeChallenge({ email, purpose, codeHash }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `DELETE FROM iabt_auth_challenges
         WHERE email = $1
           AND purpose = $2
           AND code_hash = $3
           AND expires_at > now()
         RETURNING email`,
        [email, purpose, codeHash]
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
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

  async createRecord(entityName, user, input) {
    const id = createId();
    const result = await this.pool.query(
      `INSERT INTO iabt_entity_records
        (entity_name, id, owner_id, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING entity_name, id, owner_id, payload, created_at, updated_at`,
      [entityName, id, user.id, JSON.stringify(sanitizeRecordInput(input))]
    );
    return recordFromRow(result.rows[0]);
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
}
