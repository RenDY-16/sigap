import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { Pool, PoolClient } from "pg";
import { OUTBOX_MAX_FAILURES, type OutboxReviewItem, type OutboxReviewPage, type OutboxQueueState } from "../../shared/outbox.js";
import { ApiError } from "../errors.js";
import { lockStaffAccess, requireStaffCapability, type StaffAccess, type StaffCapability } from "../identity/staff-policy.js";
import { STAFF_ADMIN_ADVISORY_LOCK_KEY, type StaffPrincipal } from "../identity/staff-repository.js";

function access(request: Request): StaffAccess {
  if (!request.staffPrincipal || !request.sessionID) throw new ApiError(401, "staff_session_required", "Sesi staf aktif diperlukan.");
  return { principal: request.staffPrincipal, sessionId: request.sessionID };
}
function query(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 512) throw new ApiError(400, "invalid_query", "Parameter antrean harus berupa satu nilai terbatas.");
  return value;
}
interface Cursor { time: string; id: string; state: OutboxQueueState }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cursor(raw: string | undefined, state: OutboxQueueState): Cursor | undefined {
  if (raw === undefined) return undefined;
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error();
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || Object.keys(value).sort().join() !== "id,state,time" || value.state !== state ||
      typeof value.id !== "string" || !uuid.test(value.id) || typeof value.time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.time) ||
      Number(value.time.slice(0, 4)) < 1 ||
      new Date(value.time).toISOString() !== value.time.slice(0,23) + "Z") throw new Error();
    return value;
  } catch { throw new ApiError(400, "invalid_cursor", "Cursor antrean tidak valid; muat halaman pertama."); }
}
interface Row {
  id: string; incident_id: string; event: string; attempts: number; failed_attempts_total: string;
  occurred_at: Date; next_attempt_at: Date; dead_lettered_at: Date | null;
  last_error_class: string | null; published_at: Date | null; region_id: string; cursor_time: string;
}
function project(row: Row): OutboxReviewItem {
  return { id: row.id, incidentId: row.incident_id, event: row.event, attempts: row.attempts,
    totalFailures: row.failed_attempts_total, occurredAt: row.occurred_at.toISOString(),
    nextAttemptAt: row.next_attempt_at.toISOString(), deadLetteredAt: row.dead_lettered_at?.toISOString() ?? null,
    lastErrorClass: row.last_error_class };
}
const columns = `o.id,o.incident_id,o.event,o.attempts,o.failed_attempts_total,o.occurred_at,
  o.next_attempt_at,o.dead_lettered_at,o.last_error_class,o.published_at,i.region_id,
  to_char(o.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time`;

async function transaction<T>(pool: Pool, request: Request, capability: StaffCapability,
  work: (client: PoolClient, principal: StaffPrincipal) => Promise<T>): Promise<T> {
  requireStaffCapability(request.staffPrincipal, capability);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Coordinate with account mutations and publisher authorization. Shared
    // admin mutex precedes account/session locks, avoiding lock-order cycles.
    await client.query("SELECT pg_advisory_xact_lock_shared($1::bigint)", [STAFF_ADMIN_ADVISORY_LOCK_KEY]);
    const principal = await lockStaffAccess(client, access(request), capability);
    const result = await work(client, principal);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* keep original sanitized failure */ }
    throw error;
  } finally { client.release(); }
}

export function createStaffOutboxRouter(pool: Pool): ReturnType<typeof Router> {
  const router = Router();
  router.get("/outbox", async (request, response) => {
    requireStaffCapability(request.staffPrincipal, "read_audit");
    const rawState = query(request.query.state) ?? "dead_letter";
    if (rawState !== "dead_letter" && rawState !== "pending") throw new ApiError(400, "invalid_queue_state", "Pilih antrean gagal atau menunggu.");
    const limit = Number(query(request.query.limit) ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "invalid_limit", "Limit antrean harus 1–100.");
    const position = cursor(query(request.query.cursor), rawState);
    const result = await transaction(pool, request, "read_audit", async (client, principal): Promise<OutboxReviewPage> => {
      const rows = await client.query<Row>(`SELECT ${columns} FROM outbox_events o
        JOIN incidents i ON i.id=o.incident_id
        WHERE i.region_id=ANY($1::text[]) AND o.published_at IS NULL
          AND o.dead_lettered_at IS ${rawState === "dead_letter" ? "NOT NULL" : "NULL"}
          AND ($2::timestamptz IS NULL OR (o.occurred_at,o.id)>($2::timestamptz,$3::uuid))
        ORDER BY o.occurred_at,o.id LIMIT $4`, [principal.regionIds, position?.time ?? null, position?.id ?? null, limit + 1]);
      const visible = rows.rows.slice(0, limit);
      for (const regionId of [...new Set(visible.map(row => row.region_id))]) {
        await client.query(`INSERT INTO staff_admin_audit_events(id,actor_staff_id,action,details,region_id)
          VALUES($1,$2,'outbox:list',$3::jsonb,$4)`, [randomUUID(),principal.id,JSON.stringify({ state: rawState, limit }),regionId]);
      }
      const last = visible.at(-1);
      return { items: visible.map(project), maxAttempts: OUTBOX_MAX_FAILURES,
        nextCursor: rows.rows.length > limit && last ? Buffer.from(JSON.stringify({ time: last.cursor_time, id: last.id, state: rawState })).toString("base64url") : null };
    });
    response.json(result);
  });
  router.post("/outbox/:id/retry", async (request, response) => {
    requireStaffCapability(request.staffPrincipal, "manage_staff");
    const id = request.params.id;
    if (typeof id !== "string" || !uuid.test(id)) throw new ApiError(400, "invalid_event_id", "ID event tidak valid.");
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "reason" ||
      typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500) {
      throw new ApiError(400, "reason_required", "Isi alasan peninjauan sepanjang 1–500 karakter.");
    }
    const reason = body.reason.trim();
    const result = await transaction(pool, request, "manage_staff", async (client, principal) => {
      const found = await client.query<Row>(`SELECT ${columns} FROM outbox_events o
        JOIN incidents i ON i.id=o.incident_id WHERE o.id=$1 AND i.region_id=ANY($2::text[]) FOR UPDATE OF o`, [id,principal.regionIds]);
      const row = found.rows[0];
      if (!row) throw new ApiError(404, "outbox_event_not_found", "Event tidak ditemukan di wilayah akun Anda.");
      if (!row.dead_lettered_at || row.published_at) throw new ApiError(409, "outbox_state_conflict", "Event sudah berubah atau bukan antrean gagal; muat ulang sebelum bertindak.");
      await client.query(`UPDATE outbox_events SET dead_lettered_at=NULL,attempts=0,next_attempt_at=clock_timestamp()
        WHERE id=$1`, [id]);
      await client.query(`INSERT INTO staff_admin_audit_events(id,actor_staff_id,action,details,region_id)
        VALUES($1,$2,'outbox:retry',$3::jsonb,$4)`, [randomUUID(),principal.id,
        JSON.stringify({ eventId:id,incidentId:row.incident_id,eventType:row.event,failedAttempts:row.attempts,totalFailures:row.failed_attempts_total,reason }),row.region_id]);
      return { scheduled: true as const, eventId: id };
    });
    response.json(result);
  });
  return router;
}
