import type { Pool, PoolClient } from "pg";

import type { PublicIncident } from "../../shared/domain.js";
import { OUTBOX_MAX_FAILURES } from "../../shared/outbox.js";
import type { IncidentChangeName, IncidentOutboxEvent, OutboxWriter } from "../db/contracts.js";

const ALLOWED_EVENTS = new Set<IncidentChangeName>([
  "incident:created",
  "incident:location:updated",
  "incident:status:updated",
  "incident:withdrawal:requested",
]);

interface OutboxRow {
  id: string;
  incident_id: string;
  event: string;
  payload: unknown;
  attempts: number;
}

function safeIncident(incident: PublicIncident): PublicIncident {
  return {
    id: incident.id,
    category: incident.category,
    categoryId: incident.categoryId,
    configVersion: incident.configVersion,
    fieldAnswers: { ...incident.fieldAnswers },
    assignment: incident.assignment ? {
      configVersion: incident.assignment.configVersion, assignedAt: incident.assignment.assignedAt,
      simulated: true, externalDispatchAcknowledged: false,
    } : null,
    withdrawalDecision: incident.withdrawalDecision ? {
      outcome: incident.withdrawalDecision.outcome, actor: 'staff', decidedAt: incident.withdrawalDecision.decidedAt, trackingStopped: true,
    } : null,
    description: incident.description,
    status: incident.status,
    locationMode: incident.locationMode,
    location: incident.location ? {
      lat: incident.location.lat,
      lng: incident.location.lng,
      source: incident.location.source,
      updatedAt: incident.location.updatedAt,
      measuredAt: incident.location.measuredAt,
    } : null,
    withdrawalRequestedAt: incident.withdrawalRequestedAt,
    statusHistory: incident.statusHistory.map((entry) => ({
      status: entry.status,
      actor: entry.actor === "citizen" || entry.actor === "system"
        ? entry.actor : "staff",
      changedAt: entry.changedAt,
    })),
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}

function safeEnvelope(event: IncidentOutboxEvent): IncidentOutboxEvent {
  if (!ALLOWED_EVENTS.has(event.event) || !event.id || !event.incident.id || !event.occurredAt) {
    throw new Error("Invalid outbox event.");
  }
  return {
    id: event.id,
    event: event.event,
    incident: safeIncident(event.incident),
    occurredAt: event.occurredAt,
  };
}

export function createPostgresOutboxWriter(): OutboxWriter {
  return {
    async enqueue(tx: PoolClient, event: IncidentOutboxEvent): Promise<void> {
      const safe = safeEnvelope(event);
      await tx.query(
        `INSERT INTO outbox_events (id, incident_id, event, payload, occurred_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
        [safe.id, safe.incident.id, safe.event, JSON.stringify(safe), safe.occurredAt],
      );
    },
  };
}

/** The publisher owns this transaction client. Delivery authorization/audit must use
 * it directly; awaiting a new pool connection would deadlock a pool of size one. */
export type OutboxEventPublisher = (event: IncidentOutboxEvent, client: PoolClient) => Promise<boolean> | boolean;

function eventFromRow(row: OutboxRow): IncidentOutboxEvent {
  const value = typeof row.payload === "string" ? JSON.parse(row.payload) as unknown : row.payload;
  if (typeof value !== "object" || value === null) throw new Error("InvalidOutboxPayloadError");
  const candidate = value as Partial<IncidentOutboxEvent>;
  if (
    candidate.id !== row.id || candidate.event !== row.event || !ALLOWED_EVENTS.has(row.event as IncidentChangeName) ||
    typeof candidate.occurredAt !== "string" || typeof candidate.incident !== "object" || candidate.incident === null ||
    (candidate.incident as PublicIncident).id !== row.incident_id
  ) throw new Error("InvalidOutboxPayloadError");
  return safeEnvelope(candidate as IncidentOutboxEvent);
}

function errorClass(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return typeof error === "object" && error !== null ? "UnknownError" : "NonErrorThrow";
}

function logFailure(eventId: string | null, eventType: string | null, failureClass: string, attemptCount: number): void {
  process.stderr.write(`${JSON.stringify({ eventId, eventType, errorClass: failureClass, attemptCount })}\n`);
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    client.release();
  }
}

export interface OutboxPublisher {
  start(): void;
  stop(): Promise<void>;
  publishPending(batchSize: number): Promise<number>;
}

export function createOutboxPublisher(
  pool: Pool,
  publish: OutboxEventPublisher,
  options: { pollIntervalMs?: number; drainBatchSize?: number } = {},
): OutboxPublisher {
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const drainBatchSize = options.drainBatchSize ?? 50;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<number> | null = null;

  async function publishBatch(batchSize: number): Promise<number> {
    return transaction(pool, async (client) => {
      const result = await client.query<OutboxRow>(
        `SELECT id, incident_id, event, payload, attempts
           FROM outbox_events
          WHERE published_at IS NULL AND dead_lettered_at IS NULL
            AND next_attempt_at <= clock_timestamp()
          ORDER BY occurred_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      let published = 0;
      for (const row of result.rows) {
        const nextAttempt = row.attempts + 1;
        await client.query("SAVEPOINT outbox_delivery");
        try {
          const event = eventFromRow(row);
          if (await publish(event, client) !== true) throw new Error("SocketPublishUnavailableError");
          await client.query(
            `UPDATE outbox_events SET published_at = clock_timestamp(), last_error_class = NULL
              WHERE id = $1 AND published_at IS NULL`,
            [row.id],
          );
          await client.query("RELEASE SAVEPOINT outbox_delivery");
          published += 1;
        } catch (error) {
          // A failed authorization/audit SQL statement may abort the transaction.
          // Restore the event boundary before persisting retry metadata.
          await client.query("ROLLBACK TO SAVEPOINT outbox_delivery");
          await client.query("RELEASE SAVEPOINT outbox_delivery");
          const failureClass = errorClass(error);
          const delayMs = Math.min(60_000, 1_000 * (2 ** Math.min(row.attempts, 6)));
          await client.query(
            `UPDATE outbox_events SET attempts = attempts + 1,
               failed_attempts_total = failed_attempts_total + 1,
               dead_lettered_at = CASE WHEN attempts + 1 >= $4 THEN clock_timestamp() ELSE NULL END,
               next_attempt_at = clock_timestamp() + ($2::integer * interval '1 millisecond'),
               last_error_class = $3
             WHERE id = $1 AND published_at IS NULL`,
            [row.id, delayMs, failureClass, OUTBOX_MAX_FAILURES],
          );
          logFailure(row.id, row.event, failureClass, nextAttempt);
        }
      }
      return published;
    });
  }

  function publishPending(batchSize: number): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      return Promise.reject(new RangeError("Outbox batch size must be an integer from 1 to 100."));
    }
    if (running) return running;
    running = publishBatch(batchSize).finally(() => { running = null; });
    return running;
  }

  return {
    start() {
      if (timer) return;
      void publishPending(drainBatchSize).catch((error) => logFailure(null, null, errorClass(error), 0));
      timer = setInterval(() => {
        void publishPending(drainBatchSize).catch((error) => logFailure(null, null, errorClass(error), 0));
      }, pollIntervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (running) {
        try { await running; } catch (error) { logFailure(null, null, errorClass(error), 0); }
      }
      // Drain all immediately-due rows, but bound shutdown work and leave failures for restart.
      for (let batches = 0; batches < 10; batches += 1) {
        try {
          const count = await publishPending(drainBatchSize);
          if (count === 0) break;
        } catch (error) {
          logFailure(null, null, errorClass(error), 0);
          break;
        }
      }
    },
    publishPending,
  };
}
