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
}
