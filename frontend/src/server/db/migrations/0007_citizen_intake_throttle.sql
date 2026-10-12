-- Request budgets for creation only, shared across processes. No raw IP/token.
CREATE TABLE citizen_intake_throttle (
  bucket_key text PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 121),
  expires_at timestamptz NOT NULL
);
CREATE INDEX citizen_intake_throttle_expiry_idx ON citizen_intake_throttle(expires_at);
