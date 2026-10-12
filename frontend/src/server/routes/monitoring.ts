import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { INCIDENT_STATUSES } from '../../shared/domain.js';
import type { OperationalSignal, OperationalSnapshot } from '../../shared/monitoring.js';
import { ApiError } from '../errors.js';
import { lockStaffAccess, requireStaffCapability } from '../identity/staff-policy.js';
import { STAFF_ADMIN_ADVISORY_LOCK_KEY } from '../identity/staff-repository.js';
const QUEUE_AGE_SECONDS = 900;
const DUE_DELAY_SECONDS = 120;
export function createMonitoringRouter(pool: Pool) {
  const router = Router();
  router.get('/', async (request, response) => {
    requireStaffCapability(request.staffPrincipal, 'read_incidents');
    if (!request.staffPrincipal || !request.sessionID) throw new ApiError(401, 'staff_session_required', 'Sesi staf aktif diperlukan.');
    let client: PoolClient | undefined;
    let transaction = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN'); transaction = true;
      await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)', [STAFF_ADMIN_ADVISORY_LOCK_KEY]);
      const principal = await lockStaffAccess(client, { principal: request.staffPrincipal, sessionId: request.sessionID }, 'read_incidents');
      // One statement snapshot. All aggregates join the same authorized regions;
      // no report payload, IDs, precise location or credential data are selected.
      const result = await client.query<{
        sampled_at: Date; active_count: string; unowned: string; overdue: string; oldest_active: number | null;
        by_status: OperationalSnapshot['incidents']['byStatus']; pending: string; due: string;
        dead_letter: string; delayed_due: string; oldest_due_delay: number | null;
        recent_published: string; total_failures: string;
      }>(`WITH scoped AS (SELECT id,status,owner_staff_id,created_at FROM incidents WHERE region_id=ANY($1::text[])),
        queue AS (SELECT count(*)::text AS active_count,
          count(*) FILTER(WHERE owner_staff_id IS NULL)::text AS unowned,
          count(*) FILTER(WHERE created_at <= statement_timestamp()-$2*interval '1 second')::text AS overdue,
          max(GREATEST(0,EXTRACT(EPOCH FROM(statement_timestamp()-created_at))))::double precision AS oldest_active
          FROM scoped WHERE status NOT IN ('resolved','referred')),
        status_counts AS (SELECT status,count(*)::text AS count FROM scoped GROUP BY status),
        statuses AS (SELECT jsonb_object_agg(status,count) AS by_status FROM status_counts),
        events AS (SELECT o.published_at,o.dead_lettered_at,o.next_attempt_at,o.failed_attempts_total
          FROM outbox_events o JOIN scoped i ON i.id=o.incident_id),
        realtime AS (SELECT
          count(*) FILTER(WHERE published_at IS NULL AND dead_lettered_at IS NULL)::text AS pending,
          count(*) FILTER(WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at<=statement_timestamp())::text AS due,
          count(*) FILTER(WHERE published_at IS NULL AND dead_lettered_at IS NOT NULL)::text AS dead_letter,
          count(*) FILTER(WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at<=statement_timestamp()-$3*interval '1 second')::text AS delayed_due,
          max(GREATEST(0,EXTRACT(EPOCH FROM(statement_timestamp()-next_attempt_at))))
            FILTER(WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at<=statement_timestamp())::double precision AS oldest_due_delay,
          count(*) FILTER(WHERE published_at>=statement_timestamp()-interval '15 minutes' AND published_at<=statement_timestamp())::text AS recent_published,
          COALESCE(sum(failed_attempts_total),0)::text AS total_failures FROM events)
        SELECT statement_timestamp() AS sampled_at,queue.*,statuses.*,realtime.* FROM queue CROSS JOIN statuses CROSS JOIN realtime`,
      [principal.regionIds, QUEUE_AGE_SECONDS, DUE_DELAY_SECONDS]);
      const row = result.rows[0];
      const signals: OperationalSignal[] = [];
      if (row.overdue !== '0') signals.push({ code: 'queue_overdue', severity: 'warning', count: row.overdue });
      if (row.dead_letter !== '0') signals.push({ code: 'realtime_dead_letter', severity: 'warning', count: row.dead_letter });
      if (row.delayed_due !== '0') signals.push({ code: 'realtime_due_delayed', severity: 'warning', count: row.delayed_due });
      const snapshot: OperationalSnapshot = {
        sampledAt: row.sampled_at.toISOString(), regionIds: principal.regionIds,
        thresholds: { queueAgeSeconds: QUEUE_AGE_SECONDS, realtimeDueDelaySeconds: DUE_DELAY_SECONDS, stagingOnly: true },
        incidents: { active: row.active_count, unowned: row.unowned, overdue: row.overdue, oldestActiveSeconds: row.oldest_active,
          byStatus: Object.fromEntries(INCIDENT_STATUSES.map(status => [status, row.by_status?.[status] ?? '0'])) as OperationalSnapshot['incidents']['byStatus'] },
        realtime: { pending: row.pending, due: row.due, deadLetter: row.dead_letter, delayedDue: row.delayed_due,
          oldestDueDelaySeconds: row.oldest_due_delay, publishedLast15Minutes: row.recent_published, totalFailures: row.total_failures }, signals,
      };
      await client.query('COMMIT'); transaction = false;
      response.json(snapshot);
    } catch (error) {
      if (client && transaction) { try { await client.query('ROLLBACK'); } catch { /* sanitized error below */ } }
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'monitoring_unavailable', 'Monitoring belum dapat dimuat. Keadaan antrean tidak diketahui; coba lagi atau ikuti prosedur gangguan.');
    } finally { client?.release(); }
  });
  return router;
}
