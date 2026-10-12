-- MariaDB 10.4+ / XAMPP baseline, equivalent to PostgreSQL schema versions 1 through 8.
-- Apply only to a fresh, dedicated database through mysql-migrate.ts.
-- All timestamps are UTC DATETIME(6); pool sessions must set time_zone='+00:00'.
-- Identity keys use VARCHAR(128), hashes CHAR(64), JSON checks enforce envelope shape.
-- MariaDB has no partial indexes: predicates are indexed as leading columns where useful.
-- Only synthetic staging incidents belong in this database until operational sign-off.


CREATE TABLE incidents (
  id VARCHAR(128) PRIMARY KEY,
  access_token_digest CHAR(64) NOT NULL UNIQUE CHECK (access_token_digest REGEXP BINARY '^[0-9a-f]{64}$'),
  idempotency_digest CHAR(64) NOT NULL UNIQUE CHECK (idempotency_digest REGEXP BINARY '^[0-9a-f]{64}$'),
  payload_digest CHAR(64) NOT NULL CHECK (payload_digest REGEXP BINARY '^[0-9a-f]{64}$'),
  category VARCHAR(128) NOT NULL CHECK (category = 'security'),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  status VARCHAR(128) NOT NULL CHECK (status IN ('received', 'acknowledged', 'triaged', 'assigned', 'in_progress', 'referred', 'delivery_failed', 'escalation_pending', 'resolved')),
  location_mode VARCHAR(128) NOT NULL CHECK (location_mode IN ('gps', 'simulation')),
  latitude DOUBLE CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE CHECK (longitude BETWEEN -180 AND 180),
  location_source VARCHAR(128) CHECK (location_source IN ('gps', 'simulation')),
  location_updated_at DATETIME(6),
  location_measured_at DATETIME(6),
  unit_id VARCHAR(128),
  withdrawal_requested_at DATETIME(6),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK (location_source = 'gps' OR location_measured_at IS NULL),
  CHECK (location_source IS NULL OR location_source <> 'gps' OR location_measured_at IS NOT NULL),
  CHECK ((latitude IS NULL AND longitude IS NULL AND location_source IS NULL AND location_updated_at IS NULL AND location_measured_at IS NULL)
      OR (latitude IS NOT NULL AND longitude IS NOT NULL AND location_source IS NOT NULL AND location_updated_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX incidents_status_created_idx ON incidents (status, created_at DESC, id DESC);
CREATE INDEX incidents_created_idx ON incidents (created_at DESC, id DESC);

-- Only actual changes of operational status (plus the initial status) go here.
CREATE TABLE incident_status_events (
  id CHAR(36) PRIMARY KEY,
  incident_id VARCHAR(128) NOT NULL,
  from_status VARCHAR(128) CHECK (from_status IN ('received', 'acknowledged', 'triaged', 'assigned', 'in_progress', 'referred', 'delivery_failed', 'escalation_pending', 'resolved')),
  to_status VARCHAR(128) NOT NULL CHECK (to_status IN ('received', 'acknowledged', 'triaged', 'assigned', 'in_progress', 'referred', 'delivery_failed', 'escalation_pending', 'resolved')),
  actor_kind VARCHAR(128) NOT NULL CHECK (actor_kind IN ('citizen', 'staff', 'system')),
  staff_id VARCHAR(128),
  reason TEXT,
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK (from_status IS NULL OR from_status <> to_status),
  CHECK ((actor_kind = 'staff' AND staff_id IS NOT NULL) OR (actor_kind <> 'staff' AND staff_id IS NULL)),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX incident_status_events_incident_idx ON incident_status_events (incident_id, occurred_at, id);

-- Do not put location coordinates or citizen credential digests into general audit payloads.
CREATE TABLE audit_events (
  id CHAR(36) PRIMARY KEY,
  incident_id VARCHAR(128) NOT NULL,
  event VARCHAR(128) NOT NULL,
  actor_kind VARCHAR(128) NOT NULL CHECK (actor_kind IN ('citizen', 'staff', 'system')),
  staff_id VARCHAR(128),
  details JSON NOT NULL DEFAULT '{}' CHECK (JSON_TYPE(details) = 'OBJECT'),
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK ((actor_kind = 'staff' AND staff_id IS NOT NULL) OR (actor_kind <> 'staff' AND staff_id IS NULL)),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX audit_events_incident_idx ON audit_events (incident_id, occurred_at, id);

-- payload holds the safe IncidentOutboxEvent envelope, never a raw incidents row.
CREATE TABLE outbox_events (
  id CHAR(36) PRIMARY KEY,
  incident_id VARCHAR(128) NOT NULL,
  event VARCHAR(128) NOT NULL CHECK (event IN ('incident:created', 'incident:location:updated', 'incident:status:updated', 'incident:withdrawal:requested')),
  payload JSON NOT NULL CHECK (JSON_TYPE(payload) = 'OBJECT'),
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  published_at DATETIME(6),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_error_class VARCHAR(128),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (next_attempt_at, occurred_at, id);

-- Provisional staging-only staff identity. Roles and region taxonomy require operator sign-off.
CREATE TABLE regions (
  id VARCHAR(128) PRIMARY KEY,
  name TEXT NOT NULL,
  synthetic boolean NOT NULL DEFAULT true CHECK(synthetic IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
INSERT INTO regions(id, name, synthetic) VALUES ('local-staging', 'Local staging region', true);
ALTER TABLE incidents ADD COLUMN region_id VARCHAR(128) NOT NULL DEFAULT 'local-staging',
  ADD FOREIGN KEY(region_id) REFERENCES regions(id);
CREATE INDEX incidents_region_status_created_idx ON incidents(region_id, status, created_at DESC, id DESC);

CREATE TABLE staff_accounts (
  id VARCHAR(128) PRIMARY KEY,
  username VARCHAR(200) NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_verifier TEXT NOT NULL,
  role VARCHAR(128) NOT NULL CHECK (role IN ('dispatcher','supervisor','operator_admin','auditor')),
  active boolean NOT NULL DEFAULT true CHECK(active IN (0,1)),
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE staff_account_regions (
  staff_id VARCHAR(128) NOT NULL,
  region_id VARCHAR(128) NOT NULL,
  PRIMARY KEY(staff_id, region_id),
  FOREIGN KEY (staff_id) REFERENCES staff_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id) REFERENCES regions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE staff_sessions (
  sid_hash CHAR(64) PRIMARY KEY CHECK (sid_hash REGEXP BINARY '^[0-9a-f]{64}$'),
  session_data JSON NOT NULL CHECK (JSON_TYPE(session_data) = 'OBJECT'),
  principal_id VARCHAR(128),
  credential_version integer,
  expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (principal_id) REFERENCES staff_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX staff_sessions_expiry_idx ON staff_sessions(expires_at);
CREATE INDEX staff_sessions_principal_idx ON staff_sessions(principal_id);
CREATE TABLE staff_admin_audit_events (
  id CHAR(36) PRIMARY KEY,
  actor_staff_id VARCHAR(128),
  target_staff_id VARCHAR(128),
  action VARCHAR(128) NOT NULL,
  details JSON NOT NULL DEFAULT '{}' CHECK (JSON_TYPE(details) = 'OBJECT'),
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (actor_staff_id) REFERENCES staff_accounts(id),
  FOREIGN KEY (target_staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- All existing rows came from the single synthetic local-staging boundary.
-- Region provenance is retained on the audit row even if staff scope later changes.
ALTER TABLE staff_admin_audit_events
  ADD COLUMN region_id VARCHAR(128) NOT NULL DEFAULT 'local-staging', ADD FOREIGN KEY(region_id) REFERENCES regions(id);
CREATE INDEX staff_admin_audit_region_time_idx
  ON staff_admin_audit_events(region_id, occurred_at DESC, id DESC);
-- New writers must supply the audited region; do not silently assume global scope.
ALTER TABLE staff_admin_audit_events ALTER COLUMN region_id DROP DEFAULT;

-- Synthetic snapshots are append-only through the application repository.
-- Replacing config appends a version; previous SOPs, labels and availability are retained.
CREATE TABLE operation_config_versions (
  region_id VARCHAR(128) NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  timezone VARCHAR(128) NOT NULL CHECK (timezone = 'Asia/Makassar'),
  service_hours JSON NOT NULL CHECK (JSON_TYPE(service_hours) = 'ARRAY'),
  public_fallback_copy TEXT NOT NULL CHECK (char_length(public_fallback_copy) BETWEEN 1 AND 2000),
  public_fallback_contact TEXT CHECK (char_length(public_fallback_contact) BETWEEN 1 AND 200),
  simulated boolean NOT NULL DEFAULT true CHECK (simulated = 1),
  external_dispatch_enabled boolean NOT NULL DEFAULT false CHECK (NOT external_dispatch_enabled),
  created_by_staff_id VARCHAR(128),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(region_id, version),
  CHECK (region_id = 'local-staging'),
  FOREIGN KEY (region_id) REFERENCES regions(id),
  FOREIGN KEY (created_by_staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE operation_categories (
  region_id VARCHAR(128) NOT NULL,
  config_version integer NOT NULL,
  id VARCHAR(128) NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  enabled boolean NOT NULL CHECK(enabled IN (0,1)),
  required_fields JSON NOT NULL CHECK (JSON_TYPE(required_fields) = 'ARRAY'),
  PRIMARY KEY(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version) REFERENCES operation_config_versions(region_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE operation_sops (
  region_id VARCHAR(128) NOT NULL,
  config_version integer NOT NULL,
  id VARCHAR(128) NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  version integer NOT NULL CHECK (version > 0),
  category_id VARCHAR(128) NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  steps JSON NOT NULL CHECK (JSON_TYPE(steps) = 'ARRAY' AND JSON_LENGTH(steps) > 0),
  simulated boolean NOT NULL DEFAULT true CHECK (simulated = 1),
  PRIMARY KEY(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version, category_id) REFERENCES operation_categories(region_id, config_version, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX operation_sops_history_idx ON operation_sops(region_id, id, version DESC, config_version DESC);
CREATE TABLE operation_responders (
  region_id VARCHAR(128) NOT NULL,
  config_version integer NOT NULL,
  id VARCHAR(128) NOT NULL CHECK (char_length(id) BETWEEN 1 AND 128),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  enabled boolean NOT NULL CHECK(enabled IN (0,1)),
  simulated boolean NOT NULL DEFAULT true CHECK (simulated = 1),
  availability VARCHAR(128) NOT NULL CHECK (availability IN ('available', 'busy', 'offline')),
  PRIMARY KEY(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version) REFERENCES operation_config_versions(region_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE operation_responder_coverage (
  region_id VARCHAR(128) NOT NULL,
  config_version integer NOT NULL,
  responder_id VARCHAR(128) NOT NULL,
  coverage_region_id VARCHAR(128) NOT NULL,
  PRIMARY KEY(region_id, config_version, responder_id, coverage_region_id),
  FOREIGN KEY(region_id, config_version, responder_id) REFERENCES operation_responders(region_id, config_version, id),
  CHECK (coverage_region_id = region_id),
  FOREIGN KEY (coverage_region_id) REFERENCES regions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE operation_responder_categories (
  region_id VARCHAR(128) NOT NULL,
  config_version integer NOT NULL,
  responder_id VARCHAR(128) NOT NULL,
  category_id VARCHAR(128) NOT NULL,
  PRIMARY KEY(region_id, config_version, responder_id, category_id),
  FOREIGN KEY(region_id, config_version, responder_id) REFERENCES operation_responders(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version, category_id) REFERENCES operation_categories(region_id, config_version, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
-- PK indexes cover per-region/version reads; this index supports roster selection.
CREATE INDEX operation_responders_available_idx ON operation_responders(region_id, config_version, enabled, availability);

-- No real hours, contacts, SOPs or agencies are inferred. Empty hours = no advertised service.
INSERT INTO operation_config_versions(region_id, version, timezone, service_hours, public_fallback_copy)
VALUES ('local-staging', 1, 'Asia/Makassar', '[]', 'SIMULASI: demo ini tidak mengirim bantuan darurat. Jam layanan dan kontak resmi belum ditetapkan.');
INSERT INTO operation_categories(region_id, config_version, id, label, enabled, required_fields)
VALUES ('local-staging', 1, 'security', 'Keamanan — simulasi', true,
  '[{"key":"description","label":"Deskripsi simulasi","type":"text","required":true}]');
INSERT INTO operation_sops(region_id, config_version, id, version, category_id, title, steps)
VALUES ('local-staging', 1, 'security-staging', 1, 'security', 'SOP keamanan — simulasi',
  '["Periksa laporan sintetis.","Catat triase dan alasan simulasi.","Pilih unit simulasi; penugasan internal bukan pengiriman bantuan."]');
INSERT INTO operation_responders(region_id, config_version, id, label, enabled, availability) VALUES
  ('local-staging', 1, 'unit-01', 'Unit 01 — simulasi', true, 'available'),
  ('local-staging', 1, 'unit-02', 'Unit 02 — simulasi', true, 'available'),
  ('local-staging', 1, 'unit-03', 'Unit 03 — simulasi', true, 'available');
INSERT INTO operation_responder_coverage(region_id, config_version, responder_id, coverage_region_id)
SELECT region_id, config_version, id, region_id FROM operation_responders WHERE region_id='local-staging' AND config_version=1;
INSERT INTO operation_responder_categories(region_id, config_version, responder_id, category_id)
SELECT region_id, config_version, id, 'security' FROM operation_responders WHERE region_id='local-staging' AND config_version=1;
-- unit_id retains optional roster provenance through the lifecycle transaction.
-- Assignment enforcement and snapshot provenance are handled by the lifecycle transaction.

-- Legacy storage category remains security; configurable category is a separate pinned FK.
ALTER TABLE incidents
  ADD COLUMN category_id VARCHAR(128) NOT NULL DEFAULT 'security',
  ADD COLUMN config_version integer NOT NULL DEFAULT 1,
  ADD COLUMN create_payload_version smallint NOT NULL DEFAULT 1 CHECK (create_payload_version IN (1,2)),
  ADD COLUMN field_answers JSON NOT NULL DEFAULT '{}'
    CHECK (JSON_TYPE(field_answers)='OBJECT' AND octet_length(field_answers)<=16384),
  ADD COLUMN owner_staff_id VARCHAR(128),
  ADD FOREIGN KEY(owner_staff_id) REFERENCES staff_accounts(id),
  ADD COLUMN assignment_config_version integer,
  ADD COLUMN assignment_label TEXT CHECK (char_length(assignment_label) BETWEEN 1 AND 200),
  ADD COLUMN assigned_at DATETIME(6),
  ADD COLUMN withdrawal_outcome VARCHAR(128) CHECK (withdrawal_outcome IN ('accepted','denied')),
  ADD COLUMN withdrawal_decided_by_staff_id VARCHAR(128),
  ADD FOREIGN KEY(withdrawal_decided_by_staff_id) REFERENCES staff_accounts(id),
  ADD COLUMN withdrawal_decision_reason TEXT CHECK (char_length(withdrawal_decision_reason) BETWEEN 1 AND 500),
  ADD COLUMN withdrawal_decided_at DATETIME(6),
  ADD FOREIGN KEY(region_id,config_version,category_id)
    REFERENCES operation_categories(region_id,config_version,id),
  ADD FOREIGN KEY(region_id,assignment_config_version,unit_id)
    REFERENCES operation_responders(region_id,config_version,id),
  ADD CHECK ((assignment_config_version IS NULL AND assignment_label IS NULL AND assigned_at IS NULL)
    OR (unit_id IS NOT NULL AND assignment_config_version IS NOT NULL AND assignment_label IS NOT NULL AND assigned_at IS NOT NULL)),
  ADD CHECK ((withdrawal_outcome IS NULL AND withdrawal_decided_by_staff_id IS NULL
    AND withdrawal_decision_reason IS NULL AND withdrawal_decided_at IS NULL)
    OR (withdrawal_requested_at IS NOT NULL AND withdrawal_outcome IS NOT NULL
      AND withdrawal_decided_by_staff_id IS NOT NULL AND withdrawal_decision_reason IS NOT NULL AND withdrawal_decided_at IS NOT NULL));
-- Fresh baseline has no historic assignments to backfill.

ALTER TABLE incidents ALTER COLUMN category_id DROP DEFAULT;
ALTER TABLE incidents ALTER COLUMN config_version DROP DEFAULT;
ALTER TABLE incidents ALTER COLUMN create_payload_version DROP DEFAULT;

ALTER TABLE incident_status_events
  ADD COLUMN sop_id VARCHAR(128),
  ADD COLUMN sop_version integer CHECK (sop_version > 0),
  ADD COLUMN sop_config_version integer CHECK (sop_config_version > 0),
  ADD CHECK ((sop_id IS NULL AND sop_version IS NULL AND sop_config_version IS NULL)
    OR (sop_id IS NOT NULL AND sop_version IS NOT NULL AND sop_config_version IS NOT NULL));

-- Ownership and withdrawal events do not invent operational status changes.
CREATE TABLE incident_workflow_events (
  id CHAR(36) PRIMARY KEY,
  incident_id VARCHAR(128) NOT NULL,
  region_id VARCHAR(128) NOT NULL,
  action VARCHAR(128) NOT NULL CHECK (action IN ('claim','release','takeover','transition','assignment',
    'withdrawal_requested','withdrawal_accepted','withdrawal_denied')),
  actor_kind VARCHAR(128) NOT NULL CHECK (actor_kind IN ('staff','citizen')),
  staff_id VARCHAR(128),
  reason TEXT CHECK (char_length(reason) BETWEEN 1 AND 500),
  from_status VARCHAR(128) NOT NULL,
  to_status VARCHAR(128) NOT NULL,
  previous_owner_id VARCHAR(128),
  owner_staff_id VARCHAR(128),
  sop_id VARCHAR(128),
  sop_version integer CHECK (sop_version > 0),
  sop_config_version integer CHECK (sop_config_version > 0),
  responder_id VARCHAR(128),
  assignment_config_version integer,
  assignment_label TEXT CHECK (char_length(assignment_label) BETWEEN 1 AND 200),
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(region_id,sop_config_version,sop_id) REFERENCES operation_sops(region_id,config_version,id),
  FOREIGN KEY(region_id,assignment_config_version,responder_id) REFERENCES operation_responders(region_id,config_version,id),
  CHECK ((actor_kind='staff' AND staff_id IS NOT NULL) OR (actor_kind='citizen' AND staff_id IS NULL)),
  CHECK ((sop_id IS NULL AND sop_version IS NULL AND sop_config_version IS NULL)
    OR (sop_id IS NOT NULL AND sop_version IS NOT NULL AND sop_config_version IS NOT NULL)),
  CHECK ((responder_id IS NULL AND assignment_config_version IS NULL AND assignment_label IS NULL)
    OR (responder_id IS NOT NULL AND assignment_config_version IS NOT NULL AND assignment_label IS NOT NULL)),
  CHECK (from_status IN ('received','acknowledged','triaged','assigned','in_progress','referred','delivery_failed','escalation_pending','resolved')),
  CHECK (to_status IN ('received','acknowledged','triaged','assigned','in_progress','referred','delivery_failed','escalation_pending','resolved')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (region_id) REFERENCES regions(id),
  FOREIGN KEY (staff_id) REFERENCES staff_accounts(id),
  FOREIGN KEY (previous_owner_id) REFERENCES staff_accounts(id),
  FOREIGN KEY (owner_staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX incident_workflow_events_incident_idx ON incident_workflow_events(incident_id,occurred_at,id);
CREATE INDEX incidents_owner_queue_idx ON incidents(region_id,owner_staff_id,created_at DESC,id DESC);
CREATE INDEX incidents_withdrawal_pending_idx ON incidents(region_id,withdrawal_outcome,withdrawal_requested_at,created_at DESC,id DESC);

-- Pseudonymous, bounded fixed-window login reservations shared by app processes.
CREATE TABLE staff_login_throttle (
  bucket_key CHAR(64) PRIMARY KEY CHECK (bucket_key REGEXP BINARY '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 31),
  expires_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX staff_login_throttle_expiry_idx ON staff_login_throttle(expires_at);

ALTER TABLE outbox_events
  ADD COLUMN failed_attempts_total bigint NOT NULL DEFAULT 0 CHECK (failed_attempts_total >= 0),
  ADD COLUMN dead_lettered_at DATETIME(6),
  ADD CHECK (dead_lettered_at IS NULL OR published_at IS NULL);

-- Keep payloads and IDs intact; exhausted historical pending events need review.

DROP INDEX outbox_events_unpublished_idx ON outbox_events;
CREATE INDEX outbox_events_pending_idx ON outbox_events(published_at,dead_lettered_at,next_attempt_at,occurred_at,id);
CREATE INDEX outbox_events_dead_letter_idx ON outbox_events(published_at,dead_lettered_at,occurred_at,id);

-- Request budgets for creation only, shared across processes. No raw IP/token.
CREATE TABLE citizen_intake_throttle (
  bucket_key CHAR(64) PRIMARY KEY CHECK (bucket_key REGEXP BINARY '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 121),
  expires_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX citizen_intake_throttle_expiry_idx ON citizen_intake_throttle(expires_at);

-- Dispatch persistence is independent of incident workflow and UI realtime outbox.
-- Only local mock handoffs are enabled until an operator supplies a provider contract.
ALTER TABLE incidents ADD CONSTRAINT incidents_id_region_unique UNIQUE(id,region_id);

CREATE TABLE dispatch_intents (
  id CHAR(36) PRIMARY KEY,
  incident_id VARCHAR(128) NOT NULL,
  region_id VARCHAR(128) NOT NULL,
  adapter_key VARCHAR(128) NOT NULL DEFAULT 'local-mock' CHECK(adapter_key='local-mock'),
  adapter_version integer NOT NULL DEFAULT 1 CHECK(adapter_version=1),
  target_key VARCHAR(128) NOT NULL DEFAULT 'local-staging-mock' CHECK(target_key='local-staging-mock'),
  simulated boolean NOT NULL DEFAULT true CHECK(simulated = 1),
  scenario VARCHAR(128) NOT NULL CHECK(scenario IN ('accepted','rejected','transient','unknown')),
  created_by_staff_id VARCHAR(128) NOT NULL,
  idempotency_digest CHAR(64) NOT NULL UNIQUE CHECK(idempotency_digest REGEXP BINARY '^[0-9a-f]{64}$'),
  payload_digest CHAR(64) NOT NULL CHECK(payload_digest REGEXP BINARY '^[0-9a-f]{64}$'),
  correlation_id CHAR(36) NOT NULL UNIQUE,
  status VARCHAR(128) NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','sending','accepted','rejected','retry_wait','unknown','manual_review','dead_letter','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  next_attempt_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  lease_token CHAR(36),
  leased_by VARCHAR(128) CHECK(char_length(leased_by) BETWEEN 1 AND 128),
  lease_expires_at DATETIME(6),
  replay_of CHAR(36),
  reviewed_by_staff_id VARCHAR(128),
  reviewed_at DATETIME(6),
  review_reason TEXT CHECK(char_length(review_reason) BETWEEN 1 AND 500),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(id,incident_id,region_id),
  FOREIGN KEY(incident_id,region_id) REFERENCES incidents(id,region_id),
  FOREIGN KEY(replay_of,incident_id,region_id) REFERENCES dispatch_intents(id,incident_id,region_id),
  CHECK(replay_of IS NULL OR replay_of<>id),
  CHECK((status='sending' AND ((lease_token IS NOT NULL)+(leased_by IS NOT NULL)+(lease_expires_at IS NOT NULL))=3 AND attempt_count>0)
     OR (status<>'sending' AND ((lease_token IS NOT NULL)+(leased_by IS NOT NULL)+(lease_expires_at IS NOT NULL))=0)),
  CHECK((status IN ('queued','retry_wait') AND next_attempt_at IS NOT NULL)
     OR (status NOT IN ('queued','retry_wait') AND next_attempt_at IS NULL)),
  CHECK(((reviewed_by_staff_id IS NOT NULL)+(reviewed_at IS NOT NULL)+(review_reason IS NOT NULL)) IN (0,3)),
  CHECK(updated_at>=created_at),
  FOREIGN KEY (region_id) REFERENCES regions(id),
  FOREIGN KEY (created_by_staff_id) REFERENCES staff_accounts(id),
  FOREIGN KEY (reviewed_by_staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX dispatch_intents_due_idx ON dispatch_intents(status,next_attempt_at,id);
CREATE INDEX dispatch_intents_expired_lease_idx ON dispatch_intents(status,lease_expires_at,id);
CREATE INDEX dispatch_intents_region_queue_idx ON dispatch_intents(region_id,status,created_at,id);
CREATE INDEX dispatch_intents_incident_idx ON dispatch_intents(incident_id,created_at,id);

CREATE TABLE dispatch_attempts (
  id CHAR(36) PRIMARY KEY,
  intent_id CHAR(36) NOT NULL,
  attempt_number integer NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
  lease_token CHAR(36) NOT NULL UNIQUE,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at DATETIME(6),
  result VARCHAR(128) CHECK(result IN ('accepted','rejected','transient_failure','unknown')),
  diagnostic_code VARCHAR(128) CHECK(diagnostic_code IN ('mock_accepted','mock_rejected','mock_transient','mock_unknown','lease_expired','adapter_exception')),
  simulated boolean NOT NULL DEFAULT true CHECK(simulated = 1),
  UNIQUE(intent_id,attempt_number),
  CHECK((finished_at IS NULL AND result IS NULL AND diagnostic_code IS NULL)
     OR (finished_at IS NOT NULL AND result IS NOT NULL AND diagnostic_code IS NOT NULL)),
  CHECK(finished_at IS NULL OR finished_at>=started_at),
  FOREIGN KEY (intent_id) REFERENCES dispatch_intents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE dispatch_acknowledgements (
  id CHAR(36) PRIMARY KEY,
  intent_id CHAR(36) NOT NULL,
  attempt_number integer NOT NULL,
  acknowledgement VARCHAR(128) NOT NULL CHECK(acknowledgement IN ('accepted','rejected','unknown')),
  source VARCHAR(128) NOT NULL CHECK(source IN ('local-mock','manual')),
  simulated boolean NOT NULL DEFAULT true CHECK(simulated = 1),
  reference_digest CHAR(64) CHECK(reference_digest REGEXP BINARY '^[0-9a-f]{64}$'),
  recorded_by_staff_id VARCHAR(128),
  recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(intent_id,attempt_number) REFERENCES dispatch_attempts(intent_id,attempt_number),
  UNIQUE(intent_id,attempt_number,source),
  FOREIGN KEY(recorded_by_staff_id) REFERENCES staff_accounts(id),
  CHECK((source='manual' AND recorded_by_staff_id IS NOT NULL)
     OR (source='local-mock' AND recorded_by_staff_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
