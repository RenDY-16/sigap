-- Pseudonymous, bounded fixed-window login reservations shared by app processes.
CREATE TABLE staff_login_throttle (
  bucket_key text PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 31),
  expires_at timestamptz NOT NULL
);
CREATE INDEX staff_login_throttle_expiry_idx ON staff_login_throttle(expires_at);
