-- Only synthetic staging incidents belong in this database until operational sign-off.
CREATE TABLE schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE incidents (
  id text PRIMARY KEY,
  access_token_digest text NOT NULL UNIQUE CHECK (access_token_digest ~ '^[0-9a-f]{64}$'),
  idempotency_digest text NOT NULL UNIQUE CHECK (idempotency_digest ~ '^[0-9a-f]{64}$'),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  category text NOT NULL CHECK (category = 'security'),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('received', 'acknowledged', 'triaged', 'assigned', 'in_progress', 'referred', 'delivery_failed', 'escalation_pending', 'resolved')),
  location_mode text NOT NULL CHECK (location_mode IN ('gps', 'simulation')),
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  location_source text CHECK (location_source IN ('gps', 'simulation')),
  location_updated_at timestamptz,
  location_measured_at timestamptz,
  unit_id text,
  withdrawal_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (location_source = 'gps' OR location_measured_at IS NULL),
  CHECK (location_source IS NULL OR location_source <> 'gps' OR location_measured_at IS NOT NULL),
  CHECK ((latitude IS NULL AND longitude IS NULL AND location_source IS NULL AND location_updated_at IS NULL AND location_measured_at IS NULL)
      OR (latitude IS NOT NULL AND longitude IS NOT NULL AND location_source IS NOT NULL AND location_updated_at IS NOT NULL))
);
CREATE INDEX incidents_status_created_idx ON incidents (status, created_at DESC, id DESC);
CREATE INDEX incidents_created_idx ON incidents (created_at DESC, id DESC);

-- Only actual changes of operational status (plus the initial status) go here.
CREATE TABLE incident_status_events (
  id uuid PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents(id),
  from_status text CHECK (from_status IN ('received', 'acknowledged', 'triaged', 'assigned', 'in_progress', 'referred', 'delivery_failed', 'escalation_pending', 'resolved')),
  to_status text NOT NULL CHECK (to_status IN ('received', 'acknowledged', 'triaged', 'assigned', 'in_progress', 'referred', 'delivery_failed', 'escalation_pending', 'resolved')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('citizen', 'staff', 'system')),
  staff_id text,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (from_status IS NULL OR from_status <> to_status),
  CHECK ((actor_kind = 'staff' AND staff_id IS NOT NULL) OR (actor_kind <> 'staff' AND staff_id IS NULL))
);
CREATE INDEX incident_status_events_incident_idx ON incident_status_events (incident_id, occurred_at, id);

-- Do not put location coordinates or citizen credential digests into general audit payloads.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents(id),
  event text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('citizen', 'staff', 'system')),
  staff_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((actor_kind = 'staff' AND staff_id IS NOT NULL) OR (actor_kind <> 'staff' AND staff_id IS NULL))
);
CREATE INDEX audit_events_incident_idx ON audit_events (incident_id, occurred_at, id);

-- payload holds the safe IncidentOutboxEvent envelope, never a raw incidents row.
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents(id),
  event text NOT NULL CHECK (event IN ('incident:created', 'incident:location:updated', 'incident:status:updated', 'incident:withdrawal:requested')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_class text
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (next_attempt_at, occurred_at, id) WHERE published_at IS NULL;
