import type { PoolClient } from "pg";
import type { PublicIncident } from "../../shared/domain.js";

/** Shared domain adopts this status set in the lifecycle task. */
export type OperationalIncidentStatus =
  | "received" | "acknowledged" | "triaged" | "assigned" | "in_progress"
  | "referred" | "delivery_failed" | "escalation_pending" | "resolved";

export type AuditActor =
  | { kind: "citizen" | "system"; staffId?: never }
  | { kind: "staff"; staffId: string };

export interface IncidentListFilter {
  statuses?: OperationalIncidentStatus[];
  createdAfter?: string;
  createdBefore?: string;
  /** Exact owner ID, `me`, or `unclaimed`; resolved against the locked principal. */
  owner?: string;
  withdrawalPending?: boolean;
  /** Inclusive age bounds relative to database time, in minutes. */
  minAgeMinutes?: number;
  maxAgeMinutes?: number;
  limit: number;
  cursor?: string;
}

export interface IncidentListPage {
  items: import("../../shared/domain.js").StaffIncident[];
  nextCursor: string | null;
}

export type IncidentChangeName =
  | "incident:created" | "incident:location:updated"
  | "incident:status:updated" | "incident:withdrawal:requested";

export interface IncidentOutboxEvent {
  id: string;
  event: IncidentChangeName;
  incident: PublicIncident;
  occurredAt: string;
}

export interface OutboxWriter {
  enqueue(tx: PoolClient, event: IncidentOutboxEvent): Promise<void>;
}
