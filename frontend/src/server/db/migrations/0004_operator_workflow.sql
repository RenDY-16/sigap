-- Synthetic snapshots are append-only through the application repository.
-- Replacing config appends a version; previous SOPs, labels and availability are retained.
CREATE TABLE operation_config_versions (
  region_id text NOT NULL REFERENCES regions(id),
  version integer NOT NULL CHECK (version > 0),
  timezone text NOT NULL CHECK (timezone = 'Asia/Makassar'),
  service_hours jsonb NOT NULL CHECK (jsonb_typeof(service_hours) = 'array'),
  public_fallback_copy text NOT NULL CHECK (char_length(public_fallback_copy) BETWEEN 1 AND 2000),
  public_fallback_contact text CHECK (char_length(public_fallback_contact) BETWEEN 1 AND 200),
  simulated boolean NOT NULL DEFAULT true CHECK (simulated),
  external_dispatch_enabled boolean NOT NULL DEFAULT false CHECK (NOT external_dispatch_enabled),
  created_by_staff_id text REFERENCES staff_accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(region_id, version),
  CHECK (region_id = 'local-staging')
);
CREATE TABLE operation_categories (
  region_id text NOT NULL,
  config_version integer NOT NULL,
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  enabled boolean NOT NULL,
  required_fields jsonb NOT NULL CHECK (jsonb_typeof(required_fields) = 'array'),
  PRIMARY KEY(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version) REFERENCES operation_config_versions(region_id, version)
);
CREATE TABLE operation_sops (
  region_id text NOT NULL,
  config_version integer NOT NULL,
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  version integer NOT NULL CHECK (version > 0),
  category_id text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) > 0),
  simulated boolean NOT NULL DEFAULT true CHECK (simulated),
  PRIMARY KEY(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version, category_id) REFERENCES operation_categories(region_id, config_version, id)
);
CREATE INDEX operation_sops_history_idx ON operation_sops(region_id, id, version DESC, config_version DESC);
CREATE TABLE operation_responders (
  region_id text NOT NULL,
  config_version integer NOT NULL,
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 128),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  enabled boolean NOT NULL,
  simulated boolean NOT NULL DEFAULT true CHECK (simulated),
  availability text NOT NULL CHECK (availability IN ('available', 'busy', 'offline')),
  PRIMARY KEY(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version) REFERENCES operation_config_versions(region_id, version)
);
CREATE TABLE operation_responder_coverage (
  region_id text NOT NULL,
  config_version integer NOT NULL,
  responder_id text NOT NULL,
  coverage_region_id text NOT NULL REFERENCES regions(id),
  PRIMARY KEY(region_id, config_version, responder_id, coverage_region_id),
  FOREIGN KEY(region_id, config_version, responder_id) REFERENCES operation_responders(region_id, config_version, id),
  CHECK (coverage_region_id = region_id)
);
CREATE TABLE operation_responder_categories (
  region_id text NOT NULL,
  config_version integer NOT NULL,
  responder_id text NOT NULL,
  category_id text NOT NULL,
  PRIMARY KEY(region_id, config_version, responder_id, category_id),
  FOREIGN KEY(region_id, config_version, responder_id) REFERENCES operation_responders(region_id, config_version, id),
  FOREIGN KEY(region_id, config_version, category_id) REFERENCES operation_categories(region_id, config_version, id)
);
-- PK indexes cover per-region/version reads; this index supports roster selection.
CREATE INDEX operation_responders_available_idx ON operation_responders(region_id, config_version, availability) WHERE enabled;

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
-- incidents.unit_id stays text: existing assignments remain valid and no history is rewritten.
-- Assignment enforcement and snapshot provenance are handled by the lifecycle transaction.

-- Legacy storage category remains security; configurable category is a separate pinned FK.
ALTER TABLE incidents
  ADD COLUMN category_id text NOT NULL DEFAULT 'security',
  ADD COLUMN config_version integer NOT NULL DEFAULT 1,
  ADD COLUMN create_payload_version smallint NOT NULL DEFAULT 1 CHECK (create_payload_version IN (1,2)),
  ADD COLUMN field_answers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(field_answers)='object' AND octet_length(field_answers::text)<=16384),
  ADD COLUMN owner_staff_id text REFERENCES staff_accounts(id),
  ADD COLUMN assignment_config_version integer,
  ADD COLUMN assignment_label text CHECK (char_length(assignment_label) BETWEEN 1 AND 200),
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN withdrawal_outcome text CHECK (withdrawal_outcome IN ('accepted','denied')),
  ADD COLUMN withdrawal_decided_by_staff_id text REFERENCES staff_accounts(id),
  ADD COLUMN withdrawal_decision_reason text CHECK (char_length(withdrawal_decision_reason) BETWEEN 1 AND 500),
  ADD COLUMN withdrawal_decided_at timestamptz,
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
-- Backfill only recognized simulated legacy assignments. Unknown historic unit IDs stay intact
-- with no fabricated roster snapshot. All legacy incidents pin security/config version 1.
UPDATE incidents i SET assignment_config_version=1, assignment_label=r.label,
  assigned_at=(SELECT e.occurred_at FROM incident_status_events e WHERE e.incident_id=i.id AND e.to_status='assigned'
    ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1)
FROM operation_responders r WHERE i.region_id=r.region_id AND r.config_version=1 AND i.unit_id=r.id
  AND EXISTS(SELECT 1 FROM incident_status_events e WHERE e.incident_id=i.id AND e.to_status='assigned');
ALTER TABLE incidents ALTER COLUMN category_id DROP DEFAULT;
ALTER TABLE incidents ALTER COLUMN config_version DROP DEFAULT;
ALTER TABLE incidents ALTER COLUMN create_payload_version DROP DEFAULT;

ALTER TABLE incident_status_events
  ADD COLUMN sop_id text,
  ADD COLUMN sop_version integer CHECK (sop_version > 0),
  ADD COLUMN sop_config_version integer CHECK (sop_config_version > 0),
  ADD CHECK ((sop_id IS NULL AND sop_version IS NULL AND sop_config_version IS NULL)
    OR (sop_id IS NOT NULL AND sop_version IS NOT NULL AND sop_config_version IS NOT NULL));

-- Ownership and withdrawal events do not invent operational status changes.
CREATE TABLE incident_workflow_events (
  id uuid PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents(id),
  region_id text NOT NULL REFERENCES regions(id),
  action text NOT NULL CHECK (action IN ('claim','release','takeover','transition','assignment',
    'withdrawal_requested','withdrawal_accepted','withdrawal_denied')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('staff','citizen')),
  staff_id text REFERENCES staff_accounts(id),
  reason text CHECK (char_length(reason) BETWEEN 1 AND 500),
  from_status text NOT NULL,
  to_status text NOT NULL,
  previous_owner_id text REFERENCES staff_accounts(id),
  owner_staff_id text REFERENCES staff_accounts(id),
  sop_id text,
  sop_version integer CHECK (sop_version > 0),
  sop_config_version integer CHECK (sop_config_version > 0),
  responder_id text,
  assignment_config_version integer,
  assignment_label text CHECK (char_length(assignment_label) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(region_id,sop_config_version,sop_id) REFERENCES operation_sops(region_id,config_version,id),
  FOREIGN KEY(region_id,assignment_config_version,responder_id) REFERENCES operation_responders(region_id,config_version,id),
  CHECK ((actor_kind='staff' AND staff_id IS NOT NULL) OR (actor_kind='citizen' AND staff_id IS NULL)),
  CHECK ((sop_id IS NULL AND sop_version IS NULL AND sop_config_version IS NULL)
    OR (sop_id IS NOT NULL AND sop_version IS NOT NULL AND sop_config_version IS NOT NULL)),
  CHECK ((responder_id IS NULL AND assignment_config_version IS NULL AND assignment_label IS NULL)
    OR (responder_id IS NOT NULL AND assignment_config_version IS NOT NULL AND assignment_label IS NOT NULL)),
  CHECK (from_status IN ('received','acknowledged','triaged','assigned','in_progress','referred','delivery_failed','escalation_pending','resolved')),
  CHECK (to_status IN ('received','acknowledged','triaged','assigned','in_progress','referred','delivery_failed','escalation_pending','resolved'))
);
CREATE INDEX incident_workflow_events_incident_idx ON incident_workflow_events(incident_id,occurred_at,id);
CREATE INDEX incidents_owner_queue_idx ON incidents(region_id,owner_staff_id,created_at DESC,id DESC);
CREATE INDEX incidents_withdrawal_pending_idx ON incidents(region_id,created_at DESC,id DESC)
  WHERE withdrawal_requested_at IS NOT NULL AND withdrawal_outcome IS NULL;
