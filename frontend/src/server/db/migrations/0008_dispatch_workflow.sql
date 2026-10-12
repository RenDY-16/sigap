-- Dispatch persistence is independent of incident workflow and UI realtime outbox.
-- Only local mock handoffs are enabled until an operator supplies a provider contract.
ALTER TABLE incidents ADD CONSTRAINT incidents_id_region_unique UNIQUE(id,region_id);

CREATE TABLE dispatch_intents (
  id uuid PRIMARY KEY,
  incident_id text NOT NULL,
  region_id text NOT NULL REFERENCES regions(id),
  adapter_key text NOT NULL DEFAULT 'local-mock' CHECK(adapter_key='local-mock'),
  adapter_version integer NOT NULL DEFAULT 1 CHECK(adapter_version=1),
  target_key text NOT NULL DEFAULT 'local-staging-mock' CHECK(target_key='local-staging-mock'),
  simulated boolean NOT NULL DEFAULT true CHECK(simulated),
  scenario text NOT NULL CHECK(scenario IN ('accepted','rejected','transient','unknown')),
  created_by_staff_id text NOT NULL REFERENCES staff_accounts(id),
  idempotency_digest text NOT NULL UNIQUE CHECK(idempotency_digest ~ '^[0-9a-f]{64}$'),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[0-9a-f]{64}$'),
  correlation_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','sending','accepted','rejected','retry_wait','unknown','manual_review','dead_letter','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  next_attempt_at timestamptz DEFAULT clock_timestamp(),
  lease_token uuid,
  leased_by text CHECK(char_length(leased_by) BETWEEN 1 AND 128),
  lease_expires_at timestamptz,
  replay_of uuid,
  reviewed_by_staff_id text REFERENCES staff_accounts(id),
  reviewed_at timestamptz,
  review_reason text CHECK(char_length(review_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,incident_id,region_id),
  FOREIGN KEY(incident_id,region_id) REFERENCES incidents(id,region_id),
  FOREIGN KEY(replay_of,incident_id,region_id) REFERENCES dispatch_intents(id,incident_id,region_id),
  CHECK(replay_of IS NULL OR replay_of<>id),
  CHECK((status='sending' AND num_nonnulls(lease_token,leased_by,lease_expires_at)=3 AND attempt_count>0)
     OR (status<>'sending' AND num_nonnulls(lease_token,leased_by,lease_expires_at)=0)),
  CHECK((status IN ('queued','retry_wait') AND next_attempt_at IS NOT NULL)
     OR (status NOT IN ('queued','retry_wait') AND next_attempt_at IS NULL)),
  CHECK(num_nonnulls(reviewed_by_staff_id,reviewed_at,review_reason) IN (0,3)),
  CHECK(updated_at>=created_at)
);
CREATE INDEX dispatch_intents_due_idx ON dispatch_intents(next_attempt_at,id)
  WHERE status IN ('queued','retry_wait');
CREATE INDEX dispatch_intents_expired_lease_idx ON dispatch_intents(lease_expires_at,id)
  WHERE status='sending';
CREATE INDEX dispatch_intents_region_queue_idx ON dispatch_intents(region_id,status,created_at,id);
CREATE INDEX dispatch_intents_incident_idx ON dispatch_intents(incident_id,created_at,id);

CREATE TABLE dispatch_attempts (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES dispatch_intents(id),
  attempt_number integer NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
  lease_token uuid NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  result text CHECK(result IN ('accepted','rejected','transient_failure','unknown')),
  diagnostic_code text CHECK(diagnostic_code IN ('mock_accepted','mock_rejected','mock_transient','mock_unknown','lease_expired','adapter_exception')),
  simulated boolean NOT NULL DEFAULT true CHECK(simulated),
  UNIQUE(intent_id,attempt_number),
  CHECK((finished_at IS NULL AND result IS NULL AND diagnostic_code IS NULL)
     OR (finished_at IS NOT NULL AND result IS NOT NULL AND diagnostic_code IS NOT NULL)),
  CHECK(finished_at IS NULL OR finished_at>=started_at)
);

CREATE TABLE dispatch_acknowledgements (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  acknowledgement text NOT NULL CHECK(acknowledgement IN ('accepted','rejected','unknown')),
  source text NOT NULL CHECK(source IN ('local-mock','manual')),
  simulated boolean NOT NULL DEFAULT true CHECK(simulated),
  reference_digest text CHECK(reference_digest ~ '^[0-9a-f]{64}$'),
  recorded_by_staff_id text REFERENCES staff_accounts(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(intent_id,attempt_number) REFERENCES dispatch_attempts(intent_id,attempt_number),
  UNIQUE(intent_id,attempt_number,source),
  CHECK((source='manual' AND recorded_by_staff_id IS NOT NULL)
     OR (source='local-mock' AND recorded_by_staff_id IS NULL))
);
