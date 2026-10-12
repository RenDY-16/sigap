-- All existing rows came from the single synthetic local-staging boundary.
-- Region provenance is retained on the audit row even if staff scope later changes.
ALTER TABLE staff_admin_audit_events
  ADD COLUMN region_id text NOT NULL DEFAULT 'local-staging' REFERENCES regions(id);
CREATE INDEX staff_admin_audit_region_time_idx
  ON staff_admin_audit_events(region_id, occurred_at DESC, id DESC);
-- New writers must supply the audited region; do not silently assume global scope.
ALTER TABLE staff_admin_audit_events ALTER COLUMN region_id DROP DEFAULT;
