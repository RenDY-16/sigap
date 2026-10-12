-- Provisional staging-only staff identity. Roles and region taxonomy require operator sign-off.
CREATE TABLE regions (
  id text PRIMARY KEY,
  name text NOT NULL,
  synthetic boolean NOT NULL DEFAULT true
);
INSERT INTO regions(id, name, synthetic) VALUES ('local-staging', 'Local staging region', true);
ALTER TABLE incidents ADD COLUMN region_id text NOT NULL DEFAULT 'local-staging' REFERENCES regions(id);
CREATE INDEX incidents_region_status_created_idx ON incidents(region_id, status, created_at DESC, id DESC);

CREATE TABLE staff_accounts (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_salt text NOT NULL,
  password_verifier text NOT NULL,
  role text NOT NULL CHECK (role IN ('dispatcher','supervisor','operator_admin','auditor')),
  active boolean NOT NULL DEFAULT true,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE staff_account_regions (
  staff_id text NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  region_id text NOT NULL REFERENCES regions(id),
  PRIMARY KEY(staff_id, region_id)
);
CREATE TABLE staff_sessions (
  sid_hash text PRIMARY KEY CHECK (sid_hash ~ '^[0-9a-f]{64}$'),
  session_data jsonb NOT NULL CHECK (jsonb_typeof(session_data) = 'object'),
  principal_id text REFERENCES staff_accounts(id) ON DELETE CASCADE,
  credential_version integer,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX staff_sessions_expiry_idx ON staff_sessions(expires_at);
CREATE INDEX staff_sessions_principal_idx ON staff_sessions(principal_id);
CREATE TABLE staff_admin_audit_events (
  id uuid PRIMARY KEY,
  actor_staff_id text REFERENCES staff_accounts(id),
  target_staff_id text REFERENCES staff_accounts(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
