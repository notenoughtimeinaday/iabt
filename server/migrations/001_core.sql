BEGIN;

CREATE TABLE IF NOT EXISTS iabt_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  email_verified boolean NOT NULL DEFAULT false,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iabt_auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iabt_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iabt_auth_sessions_user_idx ON iabt_auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS iabt_auth_sessions_expiry_idx ON iabt_auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS iabt_auth_challenges (
  email text NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, purpose)
);

CREATE TABLE IF NOT EXISTS iabt_entity_records (
  entity_name text NOT NULL,
  id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES iabt_users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_name, id)
);
CREATE INDEX IF NOT EXISTS iabt_entity_owner_idx
  ON iabt_entity_records(entity_name, owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS iabt_entity_payload_idx
  ON iabt_entity_records USING gin(payload);

CREATE TABLE IF NOT EXISTS iabt_audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES iabt_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iabt_audit_created_idx ON iabt_audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS iabt_idempotency_keys (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

COMMIT;
