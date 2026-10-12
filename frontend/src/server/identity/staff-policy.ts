import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from '../errors.js';
import { getActivePrincipal, isStaffRole, type StaffPrincipal } from './staff-repository.js';
import type { IncidentStatus } from '../../shared/domain.js';

/** Fixed staging graph; resolved and referred have no outgoing edge. */
export const INCIDENT_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  received: ['acknowledged'], acknowledged: ['triaged'], triaged: ['assigned','referred'],
  assigned: ['in_progress','referred','delivery_failed'], in_progress: ['resolved','referred'],
  delivery_failed: ['escalation_pending'], escalation_pending: ['assigned','referred'],
  referred: [], resolved: [],
};
export function requireEscalationCapability(principal: StaffPrincipal, current: IncidentStatus, next?: IncidentStatus): void {
  if (current === 'escalation_pending' || next === 'escalation_pending') requireStaffCapability(principal, 'manage_escalations');
}

export type StaffCapability = 'read_incidents' | 'work_incidents' | 'manage_escalations' | 'manage_staff' | 'read_audit';
export interface StaffAccess { principal: StaffPrincipal; sessionId: string }
const permissions: Record<string, readonly StaffCapability[]> = {
  dispatcher: ['read_incidents', 'work_incidents'],
  supervisor: ['read_incidents', 'work_incidents', 'manage_escalations'],
  operator_admin: ['read_incidents', 'work_incidents', 'manage_escalations', 'manage_staff', 'read_audit'],
  auditor: ['read_incidents', 'read_audit'],
};
export function hasStaffCapability(principal: Pick<StaffPrincipal, 'role'>, capability: StaffCapability): boolean {
  return isStaffRole(principal.role) && permissions[principal.role].includes(capability);
}
export function requireStaffCapability(principal: StaffPrincipal | undefined, capability: StaffCapability): void {
  if (!principal) throw new ApiError(401, 'staff_session_required', 'A valid staff session is required.');
  if (!hasStaffCapability(principal, capability)) throw new ApiError(403, 'staff_permission_required', 'This role cannot perform this action.');
}
/** All staff operations lock account before session before incident. Admin operations first
 * take the shared bootstrap advisory lock, then account IDs in ascending order. Never call
 * the pool from this path: the caller may own the pool's only connection. */
export async function lockStaffAccess(client: PoolClient, access: StaffAccess, capability: StaffCapability): Promise<StaffPrincipal> {
  if (!access?.principal?.id || !access.sessionId) throw new ApiError(401, 'staff_session_required', 'A valid staff session is required.');
  await client.query('SELECT id FROM staff_accounts WHERE id=$1 FOR SHARE', [access.principal.id]);
  const principal = await getActivePrincipal(client, access.principal.id, access.principal.credentialVersion);
  if (!principal) throw new ApiError(401, 'staff_session_required', 'A valid staff session is required.');
  const session = await client.query(`SELECT 1 FROM staff_sessions WHERE sid_hash=$1 AND principal_id=$2
    AND credential_version=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
  [createHash('sha256').update(access.sessionId).digest('hex'), principal.id, principal.credentialVersion]);
  if (!session.rowCount) throw new ApiError(401, 'staff_session_required', 'A valid staff session is required.');
  requireStaffCapability(principal, capability);
  return principal;
}
