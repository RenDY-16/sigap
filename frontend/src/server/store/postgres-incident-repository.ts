import { lockStaffAccess, requireStaffCapability, hasStaffCapability, INCIDENT_TRANSITIONS, requireEscalationCapability, type StaffAccess } from '../identity/staff-policy.js';
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "../db/pool.js";
import { ApiError } from "../errors.js";
import type { CreateIncidentInput, GeoPoint, IncidentRecord, IncidentStatus, LocationSource, PublicIncident, StatusHistoryItem, StaffIncident, IncidentWorkflowEvent, IncidentWorkflowAction, AssignmentSnapshot, WorkflowActionInput, OwnershipActionInput } from "../../shared/domain.js";
import type { IncidentRepository } from "./incident-repository.js";
import type { AuditActor, IncidentChangeName, IncidentListFilter, IncidentListPage, OutboxWriter } from "../db/contracts.js";
import type { StaffPrincipal } from '../identity/staff-repository.js';
import { createOperationsConfigRepository } from '../operations/config-repository.js';
import { hashCreatePayload, hashLegacyCreatePayload, validateCreateInput, validateCategoryAnswers, reason as validateReason } from '../services/incident-input.js';
import type { IncidentCategoryConfiguration } from '../../shared/operations.js';
import type { GpsLocationUpdate } from "../../shared/socket-events.js";

type IncidentRow = {
  id: string;
  region_id: string;
  access_token_digest: string;
  idempotency_digest: string;
  payload_digest: string;
  create_payload_version: 1 | 2;
  category: "security";
  category_id: string;
  config_version: number;
  field_answers: IncidentRecord['fieldAnswers'];
  owner_staff_id: string | null;
  assignment_config_version: number | null;
  assignment_label: string | null;
  assigned_at: Date | string | null;
  withdrawal_outcome: 'accepted' | 'denied' | null;
  withdrawal_decided_at: Date | string | null;
  description: string;
  status: string;
  location_mode: "gps" | "simulation";
  latitude: number | null;
  longitude: number | null;
  location_source: "gps" | "simulation" | null;
  location_updated_at: Date | string | null;
  location_measured_at: Date | string | null;
  unit_id: string | null;
  withdrawal_requested_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type HistoryRow = {
  to_status: string;
  actor_kind: "citizen" | "staff" | "system";
  staff_id: string | null;
  occurred_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function operationalStatus(value: string): IncidentStatus {
  if (["received", "acknowledged", "triaged", "assigned", "in_progress", "referred", "delivery_failed", "escalation_pending", "resolved"].includes(value)) {
    return value as IncidentStatus;
  }
  throw new ApiError(503, "storage_unavailable", "Incident storage is temporarily unavailable.");
}

function mapHistory(rows: HistoryRow[]): StatusHistoryItem[] {
  return rows.map((row) => ({
    status: operationalStatus(row.to_status),
    actor: row.actor_kind,
    changedAt: iso(row.occurred_at),
  }));
}

function mapRecord(row: IncidentRow, history: HistoryRow[], workflow: IncidentWorkflowEvent[]): IncidentRecord {
  const hasLocation = row.latitude !== null && row.longitude !== null && row.location_source !== null && row.location_updated_at !== null;
  return {
    id: row.id,
    accessTokenDigest: row.access_token_digest,
    idempotencyDigest: row.idempotency_digest,
    createPayloadDigest: row.payload_digest,
    category: row.category,
    categoryId: row.category_id,
    configVersion: row.config_version,
    fieldAnswers: row.field_answers,
    ownerStaffId: row.owner_staff_id,
    workflowHistory: workflow,
    assignment: row.assignment_config_version !== null && row.assignment_label !== null && row.assigned_at !== null && row.unit_id !== null ? {
      responderId: row.unit_id, label: row.assignment_label, configVersion: row.assignment_config_version,
      assignedAt: iso(row.assigned_at), simulated: true, externalDispatchAcknowledged: false,
    } : null,
    withdrawalDecision: row.withdrawal_outcome !== null && row.withdrawal_decided_at !== null ? {
      outcome: row.withdrawal_outcome, actor: 'staff', decidedAt: iso(row.withdrawal_decided_at), trackingStopped: true,
    } : null,
    description: row.description,
    status: operationalStatus(row.status),
    locationMode: row.location_mode,
    location: hasLocation ? {
      lat: row.latitude as number,
      lng: row.longitude as number,
      source: row.location_source as "gps" | "simulation",
      updatedAt: iso(row.location_updated_at as Date | string),
      measuredAt: row.location_measured_at === null ? null : iso(row.location_measured_at),
    } : null,
    unitId: row.unit_id,
    withdrawalRequestedAt: row.withdrawal_requested_at === null ? null : iso(row.withdrawal_requested_at),
    statusHistory: mapHistory(history),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function publicRecord(record: IncidentRecord): PublicIncident {
  const { accessTokenDigest: _accessTokenDigest, idempotencyDigest: _idempotencyDigest, createPayloadDigest: _payloadDigest,
    ownerStaffId: _owner, workflowHistory: _workflow, unitId: _unitId, assignment, ...publicIncident } = record;
  return { ...publicIncident, assignment: assignment && {
    configVersion: assignment.configVersion, assignedAt: assignment.assignedAt,
    simulated: true, externalDispatchAcknowledged: false,
  } };
}

async function readRecord(client: Pool | PoolClient, row: IncidentRow): Promise<IncidentRecord> {
  const history = await client.query<HistoryRow>(
    `SELECT to_status, actor_kind, staff_id, occurred_at
       FROM incident_status_events
      WHERE incident_id = $1
      ORDER BY occurred_at ASC, id ASC`,
    [row.id],
  );
  const workflow = await client.query<{
    id: string; action: IncidentWorkflowAction; actor_kind: 'staff' | 'citizen'; staff_id: string | null;
    reason: string | null; from_status: IncidentStatus; to_status: IncidentStatus;
    previous_owner_id: string | null; owner_staff_id: string | null; sop_id: string | null;
    sop_version: number | null; sop_config_version: number | null; responder_id: string | null;
    assignment_config_version: number | null; assignment_label: string | null; occurred_at: Date | string;
  }>('SELECT * FROM incident_workflow_events WHERE incident_id=$1 ORDER BY occurred_at,id', [row.id]);
  return mapRecord(row, history.rows, workflow.rows.map(event => ({
    id: event.id, action: event.action, actor: event.actor_kind, staffId: event.staff_id,
    reason: event.reason, occurredAt: iso(event.occurred_at), fromStatus: event.from_status,
    toStatus: event.to_status, previousOwnerId: event.previous_owner_id, ownerStaffId: event.owner_staff_id,
    sop: event.sop_id !== null && event.sop_version !== null && event.sop_config_version !== null ? {
      sopId: event.sop_id, sopVersion: event.sop_version, configVersion: event.sop_config_version,
    } : null,
    assignment: event.responder_id !== null && event.assignment_config_version !== null && event.assignment_label !== null ? {
      responderId: event.responder_id, configVersion: event.assignment_config_version, label: event.assignment_label,
      assignedAt: iso(event.occurred_at), simulated: true, externalDispatchAcknowledged: false,
    } : null,
  })));
}

function matchesCreatePayload(row: IncidentRow, input: CreateIncidentInput): boolean {
  if (row.create_payload_version === 1) {
    return row.category_id === 'security' && row.config_version === 1 && input.categoryId === 'security' &&
      (input.configVersion === undefined || input.configVersion === 1) && Object.keys(input.fieldAnswers ?? {}).length === 0 &&
      row.payload_digest === hashLegacyCreatePayload(input);
  }
  return row.payload_digest === hashCreatePayload(input,input.configVersion ?? row.config_version);
}

function isUniqueViolation(error: unknown): error is { code: string; constraint?: string } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function unavailable(): ApiError {
  return new ApiError(503, "storage_unavailable", "Incident storage is temporarily unavailable. Please retry shortly.");
}

function parseCursor(cursor: string): { createdAt: string; id: string } {
  try {
    if (cursor.length > 512) throw new Error("cursor too large");
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw new Error("noncanonical cursor");
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (typeof value !== "object" || value === null) throw new Error("invalid cursor");
    const candidate = value as { createdAt?: unknown; id?: unknown };
    if (typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt)) ||
        typeof candidate.id !== "string" || candidate.id.length < 1 || candidate.id.length > 128) {
      throw new Error("invalid cursor fields");
    }
    return { createdAt: new Date(candidate.createdAt).toISOString(), id: candidate.id };
  } catch {
    throw new ApiError(400, "invalid_cursor", "Incident list cursor is invalid.");
  }
}

function actorFields(actor: AuditActor): ["citizen" | "staff" | "system", string | null] {
  return actor.kind === "staff" ? ["staff", actor.staffId] : [actor.kind, null];
}

function assertCanUpdate(record: IncidentRecord): void {
  if (record.withdrawalRequestedAt) throw new ApiError(409, "tracking_stopped", "Tracking stopped when withdrawal was requested and remains stopped after any decision.");
  if (record.status === "referred" || record.status === "resolved") {
    throw new ApiError(409, "incident_terminal", "This incident no longer accepts updates.");
  }
}

function staffRecord(record: IncidentRecord, principal: StaffPrincipal): StaffIncident {
  const allowedActions: IncidentWorkflowAction[] = [];
  let allowedTransitions: IncidentStatus[] = [];
  const terminal = record.status === 'referred' || record.status === 'resolved';
  const canEscalate = hasStaffCapability(principal, 'manage_escalations');
  if (!terminal && hasStaffCapability(principal, 'work_incidents') && (record.status !== 'escalation_pending' || canEscalate)) {
    if (!record.ownerStaffId) allowedActions.push('claim');
    else if (record.ownerStaffId === principal.id) {
      allowedActions.push('release');
      const pendingWithdrawal = record.withdrawalRequestedAt !== null && record.withdrawalDecision === null;
      allowedTransitions = INCIDENT_TRANSITIONS[record.status].filter(status =>
        (status !== 'escalation_pending' || canEscalate) &&
        (!pendingWithdrawal || (status !== 'resolved' && status !== 'referred')));
      if (allowedTransitions.some(status => status !== 'assigned')) allowedActions.push('transition');
      if (allowedTransitions.includes('assigned')) allowedActions.push('assignment');
      if (record.withdrawalRequestedAt && !record.withdrawalDecision) allowedActions.push('withdrawal_accepted','withdrawal_denied');
    } else if (canEscalate) allowedActions.push('takeover');
  }
  return { ...publicRecord(record), unitId: record.unitId, assignment: record.assignment, ownerStaffId: record.ownerStaffId,
    queueAgeMinutes: Math.max(0, Math.floor((Date.now() - Date.parse(record.createdAt)) / 60_000)),
    workflowHistory: record.workflowHistory, allowedActions, allowedTransitions };
}

async function lockStaffIncident(client: PoolClient, id: string, access: StaffAccess): Promise<{ row: IncidentRow; principal: StaffPrincipal }> {
  const principal = await lockStaffAccess(client, access, 'work_incidents');
  const result = await client.query<IncidentRow>('SELECT * FROM incidents WHERE id=$1 AND region_id=ANY($2::text[]) FOR UPDATE', [id, principal.regionIds]);
  const row = result.rows[0];
  if (!row) throw new ApiError(404, 'incident_not_found', 'Incident was not found.');
  return { row, principal };
}
function assertExpectedActive(row: IncidentRow, expectedStatus: IncidentStatus): void {
  if (row.status !== expectedStatus) throw new ApiError(409, 'status_conflict', 'Incident status changed. Refresh before saving.');
  if (row.status === 'referred' || row.status === 'resolved') throw new ApiError(409, 'incident_terminal', 'This incident is terminal.');
}
function assertOwner(row: IncidentRow, principal: StaffPrincipal): void {
  if (!row.owner_staff_id) throw new ApiError(409, 'incident_unclaimed', 'Claim the incident before working it.');
  if (row.owner_staff_id !== principal.id) throw new ApiError(409, 'incident_owner_conflict', 'Another operator owns this incident. A supervisor may take over.');
}
async function assertPinnedSop(client: PoolClient, access: StaffAccess, row: IncidentRow, input: WorkflowActionInput): Promise<void> {
  const config = await createOperationsConfigRepository().load(client, access, row.region_id, row.config_version);
  if (!config?.sops.some(sop => sop.id === input.sopId && sop.version === input.sopVersion && sop.categoryId === row.category_id)) {
    throw new ApiError(409, 'sop_conflict', 'Choose a SOP ID/version from the incident category pinned configuration.');
  }
}
async function insertWorkflow(client: PoolClient, row: IncidentRow, action: IncidentWorkflowAction, actor: AuditActor,
  now: string, reason: string | null, toStatus: IncidentStatus, ownerId: string | null,
  sop: WorkflowActionInput | null = null, assignment: AssignmentSnapshot | null = null): Promise<void> {
  const [actorKind, staffId] = actorFields(actor);
  await client.query(
    `INSERT INTO incident_workflow_events(id,incident_id,region_id,action,actor_kind,staff_id,reason,
      from_status,to_status,previous_owner_id,owner_staff_id,sop_id,sop_version,sop_config_version,
      responder_id,assignment_config_version,assignment_label,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::timestamptz)`,
    [randomUUID(),row.id,row.region_id,action,actorKind,staffId,reason,row.status,toStatus,row.owner_staff_id,ownerId,
      sop?.sopId ?? null,sop?.sopVersion ?? null,sop ? row.config_version : null,
      assignment?.responderId ?? null,assignment?.configVersion ?? null,assignment?.label ?? null,now]);
}
async function insertStatusEvent(client: PoolClient, row: IncidentRow, next: IncidentStatus, staffId: string,
  input: WorkflowActionInput, reason: string | null, now: string): Promise<void> {
  await client.query(`INSERT INTO incident_status_events(id,incident_id,from_status,to_status,actor_kind,staff_id,reason,
    sop_id,sop_version,sop_config_version,occurred_at) VALUES($1,$2,$3,$4,'staff',$5,$6,$7,$8,$9,$10::timestamptz)`,
    [randomUUID(),row.id,row.status,next,staffId,reason,input.sopId,input.sopVersion,row.config_version,now]);
}

async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
    }
    if (error instanceof ApiError) throw error;
    throw unavailable();
  } finally {
    client?.release();
  }
}

async function lockIncidentById(client: PoolClient, id: string): Promise<IncidentRow | null> {
  const result = await client.query<IncidentRow>(`SELECT * FROM incidents WHERE id = $1 FOR UPDATE`, [id]);
  return result.rows[0] ?? null;
}

async function lockIncidentByToken(client: PoolClient, digest: string): Promise<IncidentRow | null> {
  const result = await client.query<IncidentRow>(`SELECT * FROM incidents WHERE access_token_digest = $1 FOR UPDATE`, [digest]);
  return result.rows[0] ?? null;
}

async function isOlderMeasurement(client: PoolClient, id: string, measuredAt: string): Promise<boolean> {
  const result = await client.query<{ older: boolean }>(
    `SELECT location_measured_at IS NOT NULL
       AND $2::timestamptz < location_measured_at AS older
       FROM incidents WHERE id = $1`,
    [id, measuredAt],
  );
  return result.rows[0]?.older === true;
}

async function insertAudit(
  client: PoolClient,
  incidentId: string,
  event: string,
  actor: AuditActor,
  details: Record<string, unknown>,
  occurredAt: string,
): Promise<void> {
  const [actorKind, staffId] = actorFields(actor);
  await client.query(
    `INSERT INTO audit_events (id, incident_id, event, actor_kind, staff_id, details, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
    [randomUUID(), incidentId, event, actorKind, staffId, JSON.stringify(details), occurredAt],
  );
}

async function insertOutbox(
  writer: OutboxWriter,
  client: PoolClient,
  event: IncidentChangeName,
  incident: PublicIncident,
  occurredAt: string,
): Promise<void> {
  await writer.enqueue(client, { id: randomUUID(), event, incident, occurredAt });
}

export function createPostgresIncidentRepository(pool: Pool, outbox: OutboxWriter): IncidentRepository {
  async function getRowByTokenDigest(digest: string): Promise<IncidentRow | null> {
    const result = await pool.query<IncidentRow>(
      `SELECT * FROM incidents WHERE access_token_digest = $1`, [digest],
    );
    return result.rows[0] ?? null;
  }

  return {
    async create(rawInput, accessTokenDigest, idempotencyDigest): Promise<PublicIncident> {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        // Two-key namespace avoids colliding with the one-key staff/migration advisory locks.
        await client.query('SELECT pg_advisory_xact_lock(741002,hashtext($1))',[idempotencyDigest]);
        const input = validateCreateInput(rawInput);
        // Resolve retries against their original snapshot before checking current intake availability.
        const previous = await client.query<IncidentRow>('SELECT * FROM incidents WHERE idempotency_digest=$1 FOR SHARE', [idempotencyDigest]);
        if (previous.rows[0]) {
          const prior = previous.rows[0];
          if (prior.access_token_digest !== accessTokenDigest || !matchesCreatePayload(prior,input)) {
            throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with another credential or payload.');
          }
          const incident = publicRecord(await readRecord(client, prior));
          await client.query('COMMIT');
          return incident;
        }
        // Config replacement uses an exclusive region lock; keep intake snapshot selection stable.
        const region = await client.query<{ synthetic: boolean }>("SELECT synthetic FROM regions WHERE id='local-staging' FOR SHARE");
        if (!region.rows[0]?.synthetic) throw unavailable();
        const active = await client.query<{ version: number }>("SELECT version FROM operation_config_versions WHERE region_id='local-staging' ORDER BY version DESC LIMIT 1");
        const configVersion = active.rows[0]?.version;
        if (!configVersion) throw unavailable();
        if (input.configVersion !== undefined && input.configVersion !== configVersion) throw new ApiError(409, 'operations_version_conflict', 'Intake configuration changed. Refresh before submitting.');
        const category = await client.query<IncidentCategoryConfiguration>(`SELECT id,label,enabled,required_fields AS "requiredFields"
          FROM operation_categories WHERE region_id='local-staging' AND config_version=$1 AND id=$2`, [configVersion,input.categoryId]);
        if (!category.rows[0]?.enabled) throw new ApiError(400, 'invalid_category', 'Choose an enabled category in the current configuration.');
        validateCategoryAnswers(input, category.rows[0]);
        const payloadDigest = hashCreatePayload(input, configVersion);
        const now = new Date();
        const result = await client.query<IncidentRow>(
          `INSERT INTO incidents (
             id, access_token_digest, idempotency_digest, payload_digest, category, region_id,
             description, status, location_mode, latitude, longitude, location_source,
             location_updated_at, location_measured_at, created_at, updated_at, category_id, config_version, field_answers, create_payload_version
           ) VALUES (
             $1, $2, $3, $4, $5, 'local-staging', $6, 'received', $7, $8, $9,
             CASE WHEN $8::double precision IS NULL THEN NULL ELSE $7 END,
             CASE WHEN $8::double precision IS NULL THEN NULL ELSE $10::timestamptz END,
             NULL, $10, $10, $11, $12, $13::jsonb, 2
           )
           ON CONFLICT (idempotency_digest) DO NOTHING
           RETURNING *`,
          [
            randomUUID(), accessTokenDigest, idempotencyDigest, payloadDigest,
            input.category, input.description, input.locationMode,
            input.initialLocation?.lat ?? null, input.initialLocation?.lng ?? null, now, input.categoryId, configVersion, JSON.stringify(input.fieldAnswers),
          ],
        );

        if (result.rows[0]) {
          const inserted = result.rows[0];
          await client.query(
            `INSERT INTO incident_status_events (id, incident_id, from_status, to_status, actor_kind, occurred_at)
             VALUES ($1, $2, NULL, 'received', 'citizen', $3)`,
            [randomUUID(), inserted.id, now],
          );
          await insertAudit(client,inserted.id,'incident:created',{kind:'citizen'},
            {categoryId:inserted.category_id,configVersion:inserted.config_version},now.toISOString());
          const incident = publicRecord(await readRecord(client, inserted));
          await insertOutbox(outbox, client, "incident:created", incident, now.toISOString());
          await client.query("COMMIT");
          return incident;
        }

        // The unique index serializes concurrent retries. A different credential or payload
        // under the same key must never receive the previously-created incident.
        const concurrent = await client.query<IncidentRow>(
          `SELECT * FROM incidents WHERE idempotency_digest = $1 FOR SHARE`, [idempotencyDigest],
        );
        const row = concurrent.rows[0];
        if (!row || row.access_token_digest !== accessTokenDigest || !matchesCreatePayload(row,input)) {
          await client.query("ROLLBACK");
          throw new ApiError(409, "idempotency_conflict", "This idempotency key was already used with another credential or payload.");
        }
        const incident = publicRecord(await readRecord(client, row));
        await client.query("COMMIT");
        return incident;
      } catch (error) {
        if (client) {
          try { await client.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
        }
        if (error instanceof ApiError) throw error;
        if (isUniqueViolation(error)) {
          // A different unique index can win first during simultaneous submissions. Release
          // this connection before resolving so this also works with a pool size of one.
          client?.release();
          client = undefined;
          try {
            const prior = await pool.query<IncidentRow>(
              `SELECT * FROM incidents WHERE idempotency_digest = $1`, [idempotencyDigest],
            );
            const priorRow = prior.rows[0];
            if (priorRow) {
              if (priorRow.access_token_digest !== accessTokenDigest || !matchesCreatePayload(priorRow,validateCreateInput(rawInput))) {
                throw new ApiError(409, "idempotency_conflict", "This idempotency key was already used with another credential or payload.");
              }
              return publicRecord(await readRecord(pool, priorRow));
            }
            if (error.constraint === "incidents_access_token_digest_key") {
              throw new ApiError(409, "citizen_token_conflict", "This citizen access token is already in use.");
            }
          } catch (resolutionError) {
            if (resolutionError instanceof ApiError) throw resolutionError;
            throw unavailable();
          }
        }
        throw unavailable();
      } finally {
        client?.release();
      }
    },

    async getByCitizenTokenDigest(digest): Promise<PublicIncident | null> {
      try {
        const row = await getRowByTokenDigest(digest);
        return row ? publicRecord(await readRecord(pool, row)) : null;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw unavailable();
      }
    },

    async getForStaff(id: string, access: StaffAccess): Promise<StaffIncident> {
      return withTransaction(pool, async client => {
        const principal = await lockStaffAccess(client, access, "read_incidents");
        const result = await client.query<IncidentRow>('SELECT * FROM incidents WHERE id=$1 AND region_id=ANY($2::text[]) FOR SHARE', [id, principal.regionIds]);
        const row = result.rows[0];
        if (!row) throw new ApiError(404, "incident_not_found", "Incident was not found.");
        await insertAudit(client, id, "incident:detail_access_attempt", { kind: "staff", staffId: principal.id }, { channel: "rest", access: "attempt" }, new Date().toISOString());
        return staffRecord(await readRecord(client, row), principal);
      });
    },

    async listAuditForStaff(access: StaffAccess, limit: number): Promise<unknown[]> {
      return withTransaction(pool, async client => {
        const principal = await lockStaffAccess(client, access, "read_audit");
        const result = await client.query(`SELECT a.id,a.incident_id,a.event,a.actor_kind,a.staff_id,a.details,a.occurred_at
          FROM audit_events a JOIN incidents i ON i.id=a.incident_id
          WHERE i.region_id=ANY($1::text[]) ORDER BY a.occurred_at DESC,a.id DESC LIMIT $2`, [principal.regionIds, limit]);
        await client.query('INSERT INTO staff_admin_audit_events(id,actor_staff_id,action,details,region_id) VALUES($1,$2,$3,$4::jsonb,$5)',
          [randomUUID(), principal.id, 'incident:audit_access_attempt', JSON.stringify({ count: result.rows.length, regionIds: principal.regionIds }), principal.regionIds[0]]);
        const allowedDetails = ['from','to','outcome','source','channel','access','unitId','regionId','categoryId','configVersion','assignmentConfigVersion','sopId','sopVersion','simulated','externalDispatchAcknowledged','trackingStopped','previousOwnerId','ownerStaffId'];
        return result.rows.map(row => ({
          id: row.id, incident_id: row.incident_id, event: row.event, actor_kind: row.actor_kind,
          staff_id: row.staff_id, occurred_at: new Date(row.occurred_at).toISOString(),
          details: Object.fromEntries(Object.entries(row.details as Record<string, unknown>).filter(([key]) => allowedDetails.includes(key))),
        }));
      });
    },

    async listForStaff(access: StaffAccess, filter: IncidentListFilter = { limit: 50 }): Promise<IncidentListPage> {
      return withTransaction(pool, async client => {
        const principal = await lockStaffAccess(client, access, "read_incidents");
        if (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 100) {
          throw new ApiError(400, "invalid_limit", "Incident list limit must be an integer from 1 to 100.");
        }
        const maxAgeMinutes = 525600;
        for (const [name, age] of [['minAgeMinutes', filter.minAgeMinutes], ['maxAgeMinutes', filter.maxAgeMinutes]] as const) {
          if (age !== undefined && (!Number.isSafeInteger(age) || age < 0 || age > maxAgeMinutes)) {
            throw new ApiError(400, 'invalid_age_filter', `${name} must be an integer from 0 to ${maxAgeMinutes}.`);
          }
        }
        if (filter.minAgeMinutes !== undefined && filter.maxAgeMinutes !== undefined && filter.minAgeMinutes > filter.maxAgeMinutes) {
          throw new ApiError(400, 'invalid_age_range', 'minAgeMinutes must be less than or equal to maxAgeMinutes.');
        }
        const clauses: string[] = ["region_id = ANY($1::text[])"];
        const values: unknown[] = [principal.regionIds];
        const bind = (value: unknown): string => {
          values.push(value);
          return `$${values.length}`;
        };
        if (filter.statuses?.length) clauses.push(`status = ANY(${bind(filter.statuses)}::text[])`);
        if (filter.createdAfter) {
          if (!Number.isFinite(Date.parse(filter.createdAfter))) throw new ApiError(400, "invalid_created_after", "createdAfter must be a valid timestamp.");
          clauses.push(`created_at >= ${bind(new Date(filter.createdAfter).toISOString())}::timestamptz`);
        }
        if (filter.createdBefore) {
          if (!Number.isFinite(Date.parse(filter.createdBefore))) throw new ApiError(400, "invalid_created_before", "createdBefore must be a valid timestamp.");
          clauses.push(`created_at <= ${bind(new Date(filter.createdBefore).toISOString())}::timestamptz`);
        }
        if (filter.owner !== undefined) {
          if (filter.owner === 'me') clauses.push(`owner_staff_id = ${bind(principal.id)}`);
          else if (filter.owner === 'unclaimed') clauses.push('owner_staff_id IS NULL');
          else {
            if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(filter.owner)) throw new ApiError(400, 'invalid_owner_filter', 'owner must be a staff ID, me, or unclaimed.');
            clauses.push(`owner_staff_id = ${bind(filter.owner)}`);
          }
        }
        if (filter.withdrawalPending !== undefined) {
          clauses.push(filter.withdrawalPending
            ? 'withdrawal_requested_at IS NOT NULL AND withdrawal_outcome IS NULL'
            : '(withdrawal_requested_at IS NULL OR withdrawal_outcome IS NOT NULL)');
        }
        if (filter.minAgeMinutes !== undefined) clauses.push(`created_at <= clock_timestamp() - (${bind(filter.minAgeMinutes)}::integer * interval '1 minute')`);
        if (filter.maxAgeMinutes !== undefined) clauses.push(`created_at >= clock_timestamp() - (${bind(filter.maxAgeMinutes)}::integer * interval '1 minute')`);
        if (filter.createdAfter && filter.createdBefore && Date.parse(filter.createdAfter) > Date.parse(filter.createdBefore)) {
          throw new ApiError(400, "invalid_date_range", "createdAfter must be earlier than or equal to createdBefore.");
        }
        if (filter.cursor) {
          const cursor = parseCursor(filter.cursor);
          clauses.push(`(created_at, id) < (${bind(cursor.createdAt)}::timestamptz, ${bind(cursor.id)}::text)`);
        }
        const limit = bind(filter.limit + 1);
        const result = await client.query<IncidentRow>(
          `SELECT * FROM incidents ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
           ORDER BY created_at DESC, id DESC LIMIT ${limit} FOR SHARE`,
          values,
        );
        const pageRows = result.rows.slice(0, filter.limit);
        const records: IncidentRecord[] = [];
        for (const row of pageRows) {
          records.push(await readRecord(client, row));
          await insertAudit(client, row.id, "incident:list_access_attempt", { kind: "staff", staffId: principal.id }, { channel: "rest", access: "attempt" }, new Date().toISOString());
        }
        // Also records empty list attempts without storing coordinates or request bodies.
        await client.query('INSERT INTO staff_admin_audit_events(id,actor_staff_id,action,details,region_id) VALUES($1,$2,$3,$4::jsonb,$5)',
          [randomUUID(), principal.id, 'incident:list_access_attempt', JSON.stringify({ count: records.length, regionIds: principal.regionIds }), principal.regionIds[0]]);
        const items = records.map(record => staffRecord(record, principal));
        const last = pageRows.at(-1);
        const nextCursor = result.rows.length > filter.limit && last
          ? Buffer.from(JSON.stringify({ createdAt: iso(last.created_at), id: last.id })).toString('base64url')
          : null;
        return { items, nextCursor };
      });
    },

    async updateLocationByCitizenTokenDigest(digest: string, point: GeoPoint, source: LocationSource, measuredAt: string | null): Promise<PublicIncident> {
      return withTransaction(pool, async (client) => {
        const row = await lockIncidentByToken(client, digest);
        if (!row) throw new ApiError(404, "incident_not_found", "No active incident was found for this token.");
        const current = await readRecord(client, row);
        assertCanUpdate(current);
        if (source === "gps" && row.location_mode !== "gps") throw new ApiError(409, "gps_updates_disabled", "GPS updates are disabled for this incident.");
        if (source === "simulation" && measuredAt !== null) throw new ApiError(400, "invalid_measurement_time", "Simulation points do not include a GPS measurement time.");
        if (source === "gps") {
          if (!measuredAt) throw new ApiError(400, "invalid_measurement_time", "A GPS measurement time is required.");
          const measuredTime = Date.parse(measuredAt);
          if (!Number.isFinite(measuredTime)) throw new ApiError(400, "invalid_measurement_time", "measuredAt must be a parseable timestamp.");
          if (measuredTime > Date.now() + 60_000) throw new ApiError(400, "future_measurement_time", "GPS measurement time cannot be more than 60 seconds in the future.");
          if (await isOlderMeasurement(client, row.id, measuredAt)) {
            throw new ApiError(409, "stale_location_update", "This GPS point is older than the latest accepted location.");
          }
        }
        const now = new Date().toISOString();
        const updated = await client.query<IncidentRow>(
          `UPDATE incidents SET
             latitude = $2, longitude = $3, location_source = $4,
             location_mode = CASE WHEN $4 = 'simulation' THEN 'simulation' ELSE location_mode END,
             location_updated_at = $5::timestamptz, location_measured_at = $6::timestamptz,
             updated_at = $5::timestamptz
           WHERE id = $1 RETURNING *`,
          [row.id, point.lat, point.lng, source, now, measuredAt],
        );
        await insertAudit(client, row.id, "incident:location:updated", { kind: "citizen" }, { source }, now);
        const incident = publicRecord(await readRecord(client, updated.rows[0]));
        await insertOutbox(outbox, client, "incident:location:updated", incident, now);
        return incident;
      });
    },

    async updateGpsLocation(id: string, update: GpsLocationUpdate): Promise<PublicIncident> {
      return withTransaction(pool, async (client) => {
        const row = await lockIncidentById(client, id);
        if (!row) throw new ApiError(404, "incident_not_found", "Incident was not found.");
        const current = await readRecord(client, row);
        assertCanUpdate(current);
        if (row.location_mode !== "gps") throw new ApiError(409, "gps_updates_disabled", "GPS updates are disabled for this incident.");
        const measuredTime = Date.parse(update.measuredAt);
        if (!Number.isFinite(measuredTime)) throw new ApiError(400, "invalid_measurement_time", "measuredAt must be a parseable timestamp.");
        if (measuredTime > Date.now() + 60_000) throw new ApiError(400, "future_measurement_time", "GPS measurement time cannot be more than 60 seconds in the future.");
        if (await isOlderMeasurement(client, row.id, update.measuredAt)) {
          throw new ApiError(409, "stale_location_update", "This GPS point is older than the latest accepted location.");
        }
        const now = new Date().toISOString();
        const updated = await client.query<IncidentRow>(
          `UPDATE incidents SET latitude = $2, longitude = $3, location_source = 'gps',
             location_updated_at = $4::timestamptz, location_measured_at = $5::timestamptz,
             updated_at = $4::timestamptz
           WHERE id = $1 RETURNING *`,
          [id, update.lat, update.lng, now, update.measuredAt],
        );
        await insertAudit(client, id, "incident:location:updated", { kind: "citizen" }, { source: "gps" }, now);
        const incident = publicRecord(await readRecord(client, updated.rows[0]));
        await insertOutbox(outbox, client, "incident:location:updated", incident, now);
        return incident;
      });
    },

    async requestWithdrawalByCitizenTokenDigest(digest: string): Promise<PublicIncident> {
      return withTransaction(pool, async (client) => {
        const row = await lockIncidentByToken(client, digest);
        if (!row) throw new ApiError(404, "incident_not_found", "No active incident was found for this token.");
        const current = await readRecord(client, row);
        if (current.withdrawalRequestedAt) return publicRecord(current);
        if (current.status === "referred" || current.status === "resolved") {
          throw new ApiError(409, "incident_terminal", "This incident no longer accepts withdrawal requests.");
        }
        const now = new Date().toISOString();
        const updated = await client.query<IncidentRow>(
          `UPDATE incidents SET withdrawal_requested_at = $2::timestamptz, updated_at = $2::timestamptz
           WHERE id = $1 RETURNING *`, [row.id, now],
        );
        await insertWorkflow(client, row, "withdrawal_requested", { kind: "citizen" }, now, null, operationalStatus(row.status), row.owner_staff_id);
        await insertAudit(client, row.id, "incident:withdrawal:requested", { kind: "citizen" }, { outcome: "pending" }, now);
        const incident = publicRecord(await readRecord(client, updated.rows[0]));
        await insertOutbox(outbox, client, "incident:withdrawal:requested", incident, now);
        return incident;
      });
    },

    async transition(id, nextStatus, access, input): Promise<StaffIncident> {
      return withTransaction(pool, async client => {
        const { row, principal } = await lockStaffIncident(client, id, access);
        requireEscalationCapability(principal, operationalStatus(row.status), nextStatus);
        assertExpectedActive(row, input.expectedStatus);
        assertOwner(row, principal);
        if (nextStatus === 'assigned' || !INCIDENT_TRANSITIONS[operationalStatus(row.status)].includes(nextStatus)) {
          throw new ApiError(409, 'invalid_transition', 'This staging transition is not allowed; assignment uses the roster action.');
        }
        if (row.withdrawal_requested_at && row.withdrawal_outcome === null &&
            (nextStatus === 'resolved' || nextStatus === 'referred')) {
          throw new ApiError(409, 'withdrawal_decision_required', 'Decide the pending withdrawal request before closing or referring this incident.');
        }
        const reason = validateReason(input.reason, ['triaged','resolved','referred','delivery_failed','escalation_pending'].includes(nextStatus));
        await assertPinnedSop(client, access, row, input);
        const now = new Date().toISOString();
        const updated = await client.query<IncidentRow>('UPDATE incidents SET status=$2,updated_at=$3::timestamptz WHERE id=$1 RETURNING *', [id,nextStatus,now]);
        await insertStatusEvent(client,row,nextStatus,principal.id,input,reason,now);
        await insertWorkflow(client,row,'transition',{kind:'staff',staffId:principal.id},now,reason,nextStatus,row.owner_staff_id,input);
        await insertAudit(client,id,'incident:status:updated',{kind:'staff',staffId:principal.id},
          {from:row.status,to:nextStatus,sopId:input.sopId,sopVersion:input.sopVersion,configVersion:row.config_version},now);
        const record = await readRecord(client,updated.rows[0]);
        await insertOutbox(outbox,client,'incident:status:updated',publicRecord(record),now);
        return staffRecord(record,principal);
      });
    },

    async assignIncidentUnit(id, unitId, access, input): Promise<StaffIncident> {
      return withTransaction(pool, async client => {
        const { row, principal } = await lockStaffIncident(client,id,access);
        requireEscalationCapability(principal,operationalStatus(row.status));
        assertExpectedActive(row,input.expectedStatus);
        assertOwner(row,principal);
        if (!INCIDENT_TRANSITIONS[operationalStatus(row.status)].includes('assigned')) throw new ApiError(409,'invalid_transition','Incident must be triaged or awaiting supervisor escalation.');
        const reason = validateReason(input.reason,true);
        await assertPinnedSop(client,access,row,input);
        const config = await createOperationsConfigRepository().load(client,access,row.region_id);
        const responder = config?.responders.find(unit => unit.id === unitId);
        if (!config || !responder || !responder.enabled || responder.availability !== 'available' || responder.simulated !== true ||
            !responder.coverageRegionIds.includes(row.region_id) || !responder.categoryIds.includes(row.category_id)) {
          throw new ApiError(409,'responder_unavailable','Responder must be enabled, available, simulated and cover this category and region in the current configuration.');
        }
        const now = new Date().toISOString();
        const snapshot: AssignmentSnapshot = {responderId:responder.id,label:responder.label,configVersion:config.version,
          assignedAt:now,simulated:true,externalDispatchAcknowledged:false};
        const updated = await client.query<IncidentRow>(`UPDATE incidents SET status='assigned',unit_id=$2,
          assignment_config_version=$3,assignment_label=$4,assigned_at=$5::timestamptz,updated_at=$5::timestamptz WHERE id=$1 RETURNING *`,
          [id,responder.id,config.version,responder.label,now]);
        await insertStatusEvent(client,row,'assigned',principal.id,input,reason,now);
        await insertWorkflow(client,row,'assignment',{kind:'staff',staffId:principal.id},now,reason,'assigned',row.owner_staff_id,input,snapshot);
        await insertAudit(client,id,'incident:assignment:updated',{kind:'staff',staffId:principal.id},
          {from:row.status,to:'assigned',unitId:responder.id,assignmentConfigVersion:config.version,
            sopId:input.sopId,sopVersion:input.sopVersion,configVersion:row.config_version,simulated:true,externalDispatchAcknowledged:false},now);
        const record = await readRecord(client,updated.rows[0]);
        await insertOutbox(outbox,client,'incident:status:updated',publicRecord(record),now);
        return staffRecord(record,principal);
      });
    },

    async changeOwnership(id, action, access, input): Promise<StaffIncident> {
      return withTransaction(pool,async client => {
        const {row,principal} = await lockStaffIncident(client,id,access);
        if (action === 'takeover') requireStaffCapability(principal,'manage_escalations');
        requireEscalationCapability(principal,operationalStatus(row.status));
        assertExpectedActive(row,input.expectedStatus);
        if (row.owner_staff_id !== input.expectedOwnerId) throw new ApiError(409,'incident_owner_conflict','Ownership changed. Refresh before saving.');
        if (action === 'claim' && row.owner_staff_id !== null) throw new ApiError(409,'incident_owner_conflict','Incident is already claimed.');
        if (action === 'release') assertOwner(row,principal);
        if (action === 'takeover' && (row.owner_staff_id === null || row.owner_staff_id === principal.id)) throw new ApiError(409,'incident_owner_conflict','Takeover requires an incident owned by another operator.');
        const reason = validateReason(input.reason,action === 'takeover');
        const owner = action === 'release' ? null : principal.id;
        const now = new Date().toISOString();
        const updated = await client.query<IncidentRow>('UPDATE incidents SET owner_staff_id=$2,updated_at=$3::timestamptz WHERE id=$1 RETURNING *',[id,owner,now]);
        await insertWorkflow(client,row,action,{kind:'staff',staffId:principal.id},now,reason,operationalStatus(row.status),owner);
        await insertAudit(client,id,'incident:ownership:'+action,{kind:'staff',staffId:principal.id},
          {previousOwnerId:row.owner_staff_id,ownerStaffId:owner},now);
        const record = await readRecord(client,updated.rows[0]);
        // The existing safe snapshot event invalidates clients without publishing staff IDs.
        await insertOutbox(outbox,client,'incident:status:updated',publicRecord(record),now);
        return staffRecord(record,principal);
      });
    },

    async decideWithdrawal(id, outcome, access, input): Promise<StaffIncident> {
      return withTransaction(pool,async client => {
        const {row,principal} = await lockStaffIncident(client,id,access);
        requireEscalationCapability(principal,operationalStatus(row.status));
        assertExpectedActive(row,input.expectedStatus);
        assertOwner(row,principal);
        if (!row.withdrawal_requested_at || row.withdrawal_outcome !== null) throw new ApiError(409,'withdrawal_conflict','A pending withdrawal request is required.');
        const reason = validateReason(input.reason,true);
        await assertPinnedSop(client,access,row,input);
        const now = new Date().toISOString();
        const updated = await client.query<IncidentRow>(`UPDATE incidents SET withdrawal_outcome=$2,
          withdrawal_decided_by_staff_id=$3,withdrawal_decision_reason=$4,withdrawal_decided_at=$5::timestamptz,
          updated_at=$5::timestamptz WHERE id=$1 RETURNING *`,[id,outcome,principal.id,reason,now]);
        await insertWorkflow(client,row,outcome === 'accepted' ? 'withdrawal_accepted' : 'withdrawal_denied',
          {kind:'staff',staffId:principal.id},now,reason,operationalStatus(row.status),row.owner_staff_id,input);
        await insertAudit(client,id,'incident:withdrawal:decided',{kind:'staff',staffId:principal.id},
          {outcome,sopId:input.sopId,sopVersion:input.sopVersion,configVersion:row.config_version,trackingStopped:true},now);
        const record = await readRecord(client,updated.rows[0]);
        // Decision is independent of operational status; closure follows the explicit graph.
        await insertOutbox(outbox,client,'incident:status:updated',publicRecord(record),now);
        return staffRecord(record,principal);
      });
    },
  };
}
