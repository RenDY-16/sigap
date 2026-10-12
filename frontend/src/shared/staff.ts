/** Provisional local/synthetic staging roles; operator sign-off is still required. */
export const STAFF_ROLES = ['dispatcher', 'supervisor', 'operator_admin', 'auditor'] as const;
export type StaffRole = typeof STAFF_ROLES[number];
export interface StaffIdentity {
  id: string;
  username: string;
  displayName: string;
  role: StaffRole;
  regionIds: string[];
}
export interface StaffAccount extends StaffIdentity {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface StaffAccountInput {
  username: string;
  displayName: string;
  role: StaffRole;
  regionIds: string[];
  password: string;
}
export interface IncidentAuditEntry {
  id: string;
  incident_id: string;
  event: string;
  actor_kind: 'citizen' | 'staff' | 'system';
  staff_id: string | null;
  details: Record<string, unknown>;
  occurred_at: string;
}
export interface StaffAdminAuditEntry {
  id: string;
  regionId: string;
  actorStaffId: string | null;
  targetStaffId: string | null;
  action: string;
  details: Record<string, unknown>;
  occurredAt: string;
}
