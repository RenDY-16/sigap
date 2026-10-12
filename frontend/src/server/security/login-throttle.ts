import { createHmac } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { normalizeUsername } from "../identity/staff-repository.js";
import { ApiError } from "../errors.js";

// Development defaults; operators must approve policy before public deployment.
export const LOGIN_LIMITS = Object.freeze({
  source: { limit: 30, seconds: 5 * 60 },
  sourceAccount: { limit: 5, seconds: 15 * 60 },
  account: { limit: 30, seconds: 15 * 60 },
});

export function createLoginThrottle(pool: Pool, secret: string) {
  const digest = (kind: string, values: string[]) => createHmac("sha256", secret)
    .update(JSON.stringify(["sigap.login-throttle.v1", kind, ...values])).digest("hex");

  return async (source: string, rawUsername: string): Promise<{ allowed: boolean; retryAfter: number }> => {
    const username = normalizeUsername(rawUsername) ?? "<invalid>";
    const ip = source.startsWith("::ffff:") ? source.slice(7) : source;
    const buckets = [
      { key: digest("source", [ip]), ...LOGIN_LIMITS.source },
      { key: digest("source-account", [ip, username]), ...LOGIN_LIMITS.sourceAccount },
      { key: digest("account", [username]), ...LOGIN_LIMITS.account },
    ].sort((a, b) => a.key.localeCompare(b.key));
    let client: PoolClient | undefined;
    let inTransaction = false;
    try {
      client = await pool.connect();
      // Autocommit cleanup holds no locks during reservations. SKIP LOCKED
      // avoids competing with a concurrent reservation for an expired bucket.
      await client.query(`DELETE FROM staff_login_throttle WHERE bucket_key IN (
        SELECT bucket_key FROM staff_login_throttle
        WHERE expires_at <= clock_timestamp() ORDER BY bucket_key
        LIMIT 100 FOR UPDATE SKIP LOCKED
      )`);
      await client.query("BEGIN");
      inTransaction = true;
      let retryAfter = 0;
      for (const bucket of buckets) {
        const result = await client.query<{ attempts: number; retry_after: number }>(`
          INSERT INTO staff_login_throttle(bucket_key, attempts, expires_at)
          VALUES($1, 1, now() + $2 * interval '1 second')
          ON CONFLICT(bucket_key) DO UPDATE SET
            attempts = CASE WHEN staff_login_throttle.expires_at <= now() THEN 1
              ELSE LEAST(staff_login_throttle.attempts + 1, $3::integer + 1) END,
            expires_at = CASE WHEN staff_login_throttle.expires_at <= now()
              THEN now() + $2 * interval '1 second' ELSE staff_login_throttle.expires_at END
          RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::integer AS retry_after
        `, [bucket.key, bucket.seconds, bucket.limit]);
        const row = result.rows[0];
        if (row.attempts > bucket.limit) retryAfter = Math.max(retryAfter, row.retry_after);
      }
      await client.query("COMMIT");
      inTransaction = false;
      return { allowed: retryAfter === 0, retryAfter };
    } catch {
      if (client && inTransaction) {
        try { await client.query("ROLLBACK"); } catch { /* keep failure sanitized */ }
      }
      throw new ApiError(503, "login_protection_unavailable", "Login sementara tidak tersedia. Silakan coba lagi nanti.");
    } finally {
      client?.release();
    }
  };
}
