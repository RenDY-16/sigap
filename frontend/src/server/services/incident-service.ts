import type { StaffAccess } from '../identity/staff-policy.js';
import { identifier, isPlainRecord, validatePoint, validateCreateInput, reason } from "./incident-input.js";

import {
  INCIDENT_STATUSES,
  type GeoPoint,
  type IncidentStatus,
  type LocationSource,
  type PublicIncident,
  type StaffIncident,
  type WorkflowActionInput,
  type OwnershipActionInput,
} from "../../shared/domain.js";
import type { GpsLocationUpdate } from "../../shared/socket-events.js";
import type { IncidentListFilter, IncidentListPage } from "../db/contracts.js";
import { ApiError } from "../errors.js";
import { digestCitizenToken } from "../security/token-digest.js";
import type { IncidentRepository } from "../store/incident-repository.js";

export interface IncidentServices {
  createIncident(input: unknown, accessToken: string, idempotencyKey: string): Promise<PublicIncident>;
  getIncidentForCitizen(token: string): Promise<PublicIncident>;
  getIncidentForStaff(id: string, access: StaffAccess): Promise<StaffIncident>;
  updateIncidentLocation(token: string, point: GeoPoint, source: LocationSource): Promise<PublicIncident>;
  updateGpsLocation(incidentId: string, update: GpsLocationUpdate): Promise<PublicIncident>;
  requestWithdrawal(token: string): Promise<PublicIncident>;
  listIncidentAuditForStaff(access: StaffAccess, limit: number): Promise<unknown[]>;
  listIncidentsForStaff(access: StaffAccess, filter?: IncidentListFilter): Promise<IncidentListPage>;
  setIncidentStatus(id: string, next: IncidentStatus, access: StaffAccess, input: WorkflowActionInput): Promise<StaffIncident>;
  assignIncidentUnit(id: string, unitId: string, access: StaffAccess, input: WorkflowActionInput): Promise<StaffIncident>;
  changeOwnership(id: string, action: "claim" | "release" | "takeover", access: StaffAccess, input: OwnershipActionInput): Promise<StaffIncident>;
  decideWithdrawal(id: string, outcome: "accepted" | "denied", access: StaffAccess, input: WorkflowActionInput): Promise<StaffIncident>;
  stopAcceptingMutations(): Promise<void>;
}

export function validateWorkflowAction(value: unknown): WorkflowActionInput {
  if (!isPlainRecord(value) || !isIncidentStatus(value.expectedStatus) || !identifier(value.sopId) ||
      !Number.isSafeInteger(value.sopVersion) || (value.sopVersion as number) < 1 || (value.sopVersion as number) > 2147483647) {
    throw new ApiError(400, "invalid_workflow_action", "expectedStatus and a pinned SOP ID/version are required.");
  }
  return { expectedStatus: value.expectedStatus, sopId: value.sopId, sopVersion: value.sopVersion as number, reason: reason(value.reason) };
}
export function validateOwnershipAction(value: unknown): OwnershipActionInput {
  if (!isPlainRecord(value) || !isIncidentStatus(value.expectedStatus) ||
      (value.expectedOwnerId !== null && (typeof value.expectedOwnerId !== "string" || !value.expectedOwnerId || value.expectedOwnerId.length > 128))) {
    throw new ApiError(400, "invalid_ownership_action", "expectedStatus and expectedOwnerId (null when unclaimed) are required.");
  }
  return { expectedStatus: value.expectedStatus, expectedOwnerId: value.expectedOwnerId as string | null, reason: reason(value.reason) };
}

export function createIncidentService(repository: IncidentRepository): IncidentServices {
  let acceptingMutations = true;
  const activeMutations = new Set<Promise<unknown>>();
  const drainWaiters = new Set<() => void>();
  function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (!acceptingMutations) {
      return Promise.reject(new ApiError(503, "server_shutting_down", "The staging server is stopping; this change was not accepted."));
    }
    const pending = operation();
    activeMutations.add(pending);
    void pending.then(
      () => finishMutation(pending),
      () => finishMutation(pending),
    );
    return pending;
  }
  function finishMutation(pending: Promise<unknown>): void {
    activeMutations.delete(pending);
    if (!acceptingMutations && activeMutations.size === 0) {
      drainWaiters.forEach((resolve) => resolve());
      drainWaiters.clear();
    }
  }
  return {
    createIncident(input, accessToken, idempotencyKey) {
      return runMutation(async () => {
      const validated = validateCreateInput(input);
      const accessTokenDigest = digestCitizenToken(accessToken);
      const idempotencyDigest = digestCitizenToken(idempotencyKey);
      if (!accessTokenDigest || !idempotencyDigest) {
        throw new ApiError(400, "invalid_citizen_credentials", "Citizen access token and idempotency key must each encode 32 random bytes.");
      }
      const incident = await repository.create(validated, accessTokenDigest, idempotencyDigest);
      return incident;
      });
    },

    async getIncidentForCitizen(token) {
      const digest = digestCitizenToken(token);
      const incident = digest ? await repository.getByCitizenTokenDigest(digest) : null;
      if (!incident) throw new ApiError(404, "incident_not_found", "No active incident was found for this token.");
      return incident;
    },

    async getIncidentForStaff(id, access) { return repository.getForStaff(id, access); },
    async listIncidentsForStaff(access, filter) { return repository.listForStaff(access, filter); },
    async listIncidentAuditForStaff(access, limit) { return repository.listAuditForStaff(access, limit); },

    updateIncidentLocation(token, rawPoint, source) {
      return runMutation(async () => {
      const digest = digestCitizenToken(token);
      if (!digest) throw new ApiError(404, "incident_not_found", "No active incident was found for this token.");
      if (source !== "simulation") throw new ApiError(400, "invalid_location_source", "Citizen-selected fallback locations must use simulation mode.");
      const incident = await repository.updateLocationByCitizenTokenDigest(digest, validatePoint(rawPoint), source, null);
      return incident;
      });
    },

    updateGpsLocation(incidentId, update) {
      return runMutation(async () => {
      const point = validatePoint(update);
      if (typeof update.measuredAt !== "string" || !Number.isFinite(Date.parse(update.measuredAt))) {
        throw new ApiError(400, "invalid_measurement_time", "measuredAt must be a parseable ISO timestamp.");
      }
      const incident = await repository.updateGpsLocation(incidentId, { ...point, measuredAt: update.measuredAt });
      return incident;
      });
    },

    requestWithdrawal(token) {
      return runMutation(async () => {
      const digest = digestCitizenToken(token);
      if (!digest) throw new ApiError(404, "incident_not_found", "No active incident was found for this token.");
      const incident = await repository.requestWithdrawalByCitizenTokenDigest(digest);
      return incident;
      });
    },

    setIncidentStatus(id, next, access, input) {
      return runMutation(async () => {
        if (!isIncidentStatus(next)) throw new ApiError(400, "invalid_status", "Status is invalid.");
        return repository.transition(id, next, access, validateWorkflowAction(input));
      });
    },
    assignIncidentUnit(id, unitId, access, input) {
      return runMutation(async () => {
        if (!identifier(unitId, 128)) throw new ApiError(400, "invalid_unit", "Choose a configured simulated responder.");
        return repository.assignIncidentUnit(id, unitId, access, validateWorkflowAction(input));
      });
    },
    changeOwnership(id, action, access, input) {
      return runMutation(async () => {
        if (!["claim","release","takeover"].includes(action)) throw new ApiError(400, "invalid_ownership_action", "Ownership action is invalid.");
        return repository.changeOwnership(id, action, access, validateOwnershipAction(input));
      });
    },
    decideWithdrawal(id, outcome, access, input) {
      return runMutation(async () => {
        if (outcome !== "accepted" && outcome !== "denied") throw new ApiError(400, "invalid_withdrawal_outcome", "Choose accepted or denied.");
        return repository.decideWithdrawal(id, outcome, access, validateWorkflowAction(input));
      });
    },

    async stopAcceptingMutations() {
      acceptingMutations = false;
      if (activeMutations.size === 0) return;
      await new Promise<void>((resolve) => drainWaiters.add(resolve));
    },
  };
}

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === "string" && INCIDENT_STATUSES.includes(value as IncidentStatus);
}
