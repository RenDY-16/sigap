import type { StaffAccess } from '../identity/staff-policy.js';
import type { CreateIncidentInput, GeoPoint, IncidentStatus, LocationSource, PublicIncident, StaffIncident, WorkflowActionInput, OwnershipActionInput } from "../../shared/domain.js";
import type { IncidentListFilter, IncidentListPage } from "../db/contracts.js";
import type { GpsLocationUpdate } from "../../shared/socket-events.js";

/** Persistence boundary for citizen access and dispatcher reads. */
export interface IncidentRepository {
  create(
    input: CreateIncidentInput,
    accessTokenDigest: string,
    idempotencyDigest: string,
  ): Promise<PublicIncident>;
  getByCitizenTokenDigest(digest: string): Promise<PublicIncident | null>;
  getForStaff(id: string, access: StaffAccess): Promise<StaffIncident>;
  listAuditForStaff(access: StaffAccess, limit: number): Promise<unknown[]>;
  listForStaff(access: StaffAccess, filter?: IncidentListFilter): Promise<IncidentListPage>;
  updateLocationByCitizenTokenDigest(digest: string, point: GeoPoint, source: LocationSource, measuredAt: string | null): Promise<PublicIncident>;
  updateGpsLocation(id: string, update: GpsLocationUpdate): Promise<PublicIncident>;
  requestWithdrawalByCitizenTokenDigest(digest: string): Promise<PublicIncident>;
  transition(id: string, nextStatus: IncidentStatus, access: StaffAccess, input: WorkflowActionInput): Promise<StaffIncident>;
  assignIncidentUnit(id: string, unitId: string, access: StaffAccess, input: WorkflowActionInput): Promise<StaffIncident>;
  changeOwnership(id: string, action: 'claim' | 'release' | 'takeover', access: StaffAccess, input: OwnershipActionInput): Promise<StaffIncident>;
  decideWithdrawal(id: string, outcome: 'accepted' | 'denied', access: StaffAccess, input: WorkflowActionInput): Promise<StaffIncident>;
}
