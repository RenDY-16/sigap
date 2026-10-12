ALTER TABLE outbox_events
  ADD COLUMN failed_attempts_total bigint NOT NULL DEFAULT 0 CHECK (failed_attempts_total >= 0),
  ADD COLUMN dead_lettered_at timestamptz,
  ADD CHECK (dead_lettered_at IS NULL OR published_at IS NULL);
UPDATE outbox_events SET failed_attempts_total=attempts;
-- Keep payloads and IDs intact; exhausted historical pending events need review.
UPDATE outbox_events SET dead_lettered_at=clock_timestamp()
WHERE published_at IS NULL AND attempts >= 8;
DROP INDEX outbox_events_unpublished_idx;
CREATE INDEX outbox_events_pending_idx ON outbox_events(next_attempt_at,occurred_at,id)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX outbox_events_dead_letter_idx ON outbox_events(occurred_at,id)
  WHERE published_at IS NULL AND dead_lettered_at IS NOT NULL;
