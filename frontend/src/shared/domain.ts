/** Persisted category identifier; citizen creation remains restricted by server validation. */
export type IncidentCategoryId = string;

export const INCIDENT_STATUSES = [
  "received",
  "acknowledged",
  "triaged",
  "assigned",
  "in_progress",
  "referred",
  "delivery_failed",
  "escalation_pending",
  "resolved",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type LocationSource = "gps" | "simulation";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface IncidentLocation extends GeoPoint {
  source: LocationSource;
  updatedAt: string;
  measuredAt: string | null;
}

export interface StatusHistoryItem {
  status: IncidentStatus;
  actor: "citizen" | "staff" | "staff-demo" | "system";
  changedAt: string;
}

export interface CreateIncidentInput {
  category: "security";
  categoryId?: IncidentCategoryId;
  configVersion?: number;
  fieldAnswers?: IncidentFieldAnswers;
  description: string;
  locationMode: LocationSource;
  initialLocation: GeoPoint | null;
}

/** Server-only record. The digest fields must never cross an API/socket boundary. */
export interface IncidentRecord {
  id: string;
  accessTokenDigest: string;
  idempotencyDigest: string;
  createPayloadDigest: string;
  category: "security";
  categoryId: IncidentCategoryId;
  configVersion: number;
  fieldAnswers: IncidentFieldAnswers;
  description: string;
  status: IncidentStatus;
  locationMode: LocationSource;
  location: IncidentLocation | null;
  unitId: string | null;
  withdrawalRequestedAt: string | null;
  withdrawalDecision: WithdrawalDecision | null;
  assignment: AssignmentSnapshot | null;
  ownerStaffId: string | null;
  workflowHistory: IncidentWorkflowEvent[];
  statusHistory: StatusHistoryItem[];
  createdAt: string;
  updatedAt: string;
}

export type PublicAssignmentSnapshot = Omit<AssignmentSnapshot, "responderId" | "label">;

export type PublicIncident = Omit<
  IncidentRecord,
  "accessTokenDigest" | "idempotencyDigest" | "createPayloadDigest" | "ownerStaffId" | "workflowHistory" | "unitId" | "assignment"
> & { assignment: PublicAssignmentSnapshot | null };

export type IncidentFieldAnswers = Record<string, string | boolean>;
export interface SopReference { sopId: string; sopVersion: number }
export interface WorkflowActionInput extends SopReference {
  expectedStatus: IncidentStatus;
  reason: string | null;
}
export interface OwnershipActionInput {
  expectedStatus: IncidentStatus;
  expectedOwnerId: string | null;
  reason: string | null;
}
export interface WithdrawalDecision {
  outcome: "accepted" | "denied";
  actor: "staff";
  decidedAt: string;
  /** Tracking stays stopped regardless of the decision; retained facts are not erased. */
  trackingStopped: true;
}
export interface AssignmentSnapshot {
  responderId: string;
  label: string;
  configVersion: number;
  assignedAt: string;
  simulated: true;
  externalDispatchAcknowledged: false;
}
export type IncidentWorkflowAction = "claim" | "release" | "takeover" | "transition" | "assignment" | "withdrawal_requested" | "withdrawal_accepted" | "withdrawal_denied";
/** Authorized staff detail only; never publish in citizen responses or outbox. */
export interface IncidentWorkflowEvent {
  id: string;
  action: IncidentWorkflowAction;
  actor: "staff" | "citizen";
  staffId: string | null;
  occurredAt: string;
  reason: string | null;
  fromStatus: IncidentStatus;
  toStatus: IncidentStatus;
  previousOwnerId: string | null;
  ownerStaffId: string | null;
  sop: (SopReference & { configVersion: number }) | null;
  assignment: AssignmentSnapshot | null;
}
export interface StaffIncident extends PublicIncident {
  unitId: string | null;
  assignment: AssignmentSnapshot | null;
  ownerStaffId: string | null;
  queueAgeMinutes: number;
  workflowHistory: IncidentWorkflowEvent[];
  allowedActions: IncidentWorkflowAction[];
  allowedTransitions: IncidentStatus[];
}

export interface DemoUnit {
  id: string;
  label: string;
}

export const DEMO_UNITS: readonly DemoUnit[] = [
  { id: "unit-01", label: "Unit 01 — simulasi" },
  { id: "unit-02", label: "Unit 02 — simulasi" },
  { id: "unit-03", label: "Unit 03 — simulasi" },
];
