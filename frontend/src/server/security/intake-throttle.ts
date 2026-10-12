import { createHmac } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { RequestHandler } from "express";
import { ApiError } from "../errors.js";
import { digestCitizenToken } from "./token-digest.js";

// Staging request budgets, not a verified public-service abuse policy.
export const INTAKE_LIMITS = Object.freeze({
  source: { limit: 120, seconds: 60 },
  credential: { limit: 10, seconds: 60 },
});

export function createIntakeThrottle(pool: Pool, secret: string) {
  const digest = (kind: string, value: string) => createHmac("sha256", secret)
    .update(JSON.stringify(["sigap.intake-throttle.v1", kind, value])).digest("hex");
  return async (source: string, token: string): Promise<{ allowed: boolean; retryAfter: number }> => {
    const ip = source.startsWith("::ffff:") ? source.slice(7) : source;
    const credential = digestCitizenToken(token);
    // Always lock source before credential. A blocked source cannot allocate
    // unlimited credential buckets by rotating otherwise valid random tokens.
    const buckets = [{ key: digest("source", ip), ...INTAKE_LIMITS.source }];
    if (credential) buckets.push({ key: digest("credential", credential), ...INTAKE_LIMITS.credential });
    let client: PoolClient | undefined;
    let inTransaction = false;
    try {
      client = await pool.connect();
      await client.query(`DELETE FROM citizen_intake_throttle WHERE bucket_key IN (
        SELECT bucket_key FROM citizen_intake_throttle WHERE expires_at <= clock_timestamp()
        ORDER BY bucket_key LIMIT 100 FOR UPDATE SKIP LOCKED
      )`);
      await client.query("BEGIN"); inTransaction = true;
      let retryAfter = 0;
      for (const bucket of buckets) {
        const result = await client.query<{ attempts: number; retry_after: number }>(`
          INSERT INTO citizen_intake_throttle(bucket_key,attempts,expires_at)
          VALUES($1,1,now() + $2 * interval '1 second')
          ON CONFLICT(bucket_key) DO UPDATE SET
            attempts = CASE WHEN citizen_intake_throttle.expires_at <= now() THEN 1
              ELSE LEAST(citizen_intake_throttle.attempts + 1,$3::integer + 1) END,
            expires_at = CASE WHEN citizen_intake_throttle.expires_at <= now()
              THEN now() + $2 * interval '1 second' ELSE citizen_intake_throttle.expires_at END
          RETURNING attempts,GREATEST(1,CEIL(EXTRACT(EPOCH FROM (expires_at-now()))))::integer AS retry_after
        `, [bucket.key,bucket.seconds,bucket.limit]);
        const row = result.rows[0];
        if (row.attempts > bucket.limit) { retryAfter = row.retry_after; break; }
      }
      await client.query("COMMIT"); inTransaction = false;
      return { allowed: retryAfter === 0, retryAfter };
    } catch {
      if (client && inTransaction) {
        try { await client.query("ROLLBACK"); } catch { /* retain sanitized failure */ }
      }
      throw new ApiError(503,"intake_protection_unavailable","Penerimaan laporan sementara tidak tersedia. Silakan coba lagi nanti.");
    } finally { client?.release(); }
  };
}

export function guardCitizenIntake(pool: Pool, secret: string): RequestHandler {
  const reserve = createIntakeThrottle(pool, secret);
  return async (request, response, next) => {
    // Direct-connection deployment. Forwarded/X-Forwarded-For is never trusted.
    // A reverse proxy requires an explicit, separately reviewed ingress policy.
    const source = request.socket.remoteAddress ?? "<unknown-source>";
    const authorization = request.get("authorization") ?? "";
    const token = /^Bearer (.*)$/s.exec(authorization)?.[1] ?? "";
    response.setHeader("Cache-Control", "no-store");
    const result = await reserve(source, token);
    if (!result.allowed) {
      response.setHeader("Retry-After", result.retryAfter);
      throw new ApiError(429,"intake_throttled",`Terlalu banyak percobaan pengiriman. Coba lagi dalam ${result.retryAfter} detik; laporan yang sudah diterima tetap dapat dipantau.`);
    }
    next();
  };
}
