import { createStaffAdminRepository, validateAccountUpdate, validatePassword } from '../identity/staff-admin-repository.js';
import { requireStaffCapability, type StaffCapability, type StaffAccess } from '../identity/staff-policy.js';
import { Router, type RequestHandler } from "express";

import type { ServerConfig } from "../config.js";
import type { Pool } from "pg";
import { authenticateStaff } from "../identity/staff-repository.js";
import { ApiError } from "../errors.js";
import type { IncidentServices } from "../services/incident-service.js";
import type { IncidentListFilter, OperationalIncidentStatus } from "../db/contracts.js";
import { isIncidentStatus, validateWorkflowAction, validateOwnershipAction } from "../services/incident-service.js";
import {
  createStaffSession,
  type StaffSessionManager,
} from "../auth/staff-session.js";

export interface StaffRoutes {
  router: ReturnType<typeof Router>;
  sessions: StaffSessionManager;
}

function isBody(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const incidentStatuses: readonly OperationalIncidentStatus[] = [
  "received", "acknowledged", "triaged", "assigned", "in_progress",
  "referred", "delivery_failed", "escalation_pending", "resolved",
];

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 512) throw new ApiError(400, "invalid_query", `${name} must be a bounded single query value.`);
  return value;
}

function ageQuery(value: unknown, name: string): number | undefined {
  const raw = queryString(value, name);
  if (raw === undefined) return undefined;
  if (!/^(0|[1-9]\d{0,5})$/.test(raw)) throw new ApiError(400, "invalid_age_filter", `${name} must be an integer from 0 to 525600.`);
  const age = Number(raw);
  if (age > 525600) throw new ApiError(400, "invalid_age_filter", `${name} must be an integer from 0 to 525600.`);
  return age;
}

function incidentListFilter(query: Record<string, unknown>): IncidentListFilter {
  const rawLimit = queryString(query.limit, "limit");
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, "invalid_limit", "limit must be an integer from 1 to 100.");
  }
  const rawStatuses = queryString(query.statuses, "statuses");
  let statuses: OperationalIncidentStatus[] | undefined;
  if (rawStatuses) {
    statuses = rawStatuses.split(",").map((status) => status.trim()) as OperationalIncidentStatus[];
    if (statuses.length > 9 || new Set(statuses).size !== statuses.length || statuses.some((status) => !incidentStatuses.includes(status))) {
      throw new ApiError(400, "invalid_status_filter", "statuses contains an unsupported incident status.");
    }
  }
  const createdAfter = queryString(query.createdAfter, "createdAfter");
  const createdBefore = queryString(query.createdBefore, "createdBefore");
  const cursor = queryString(query.cursor, "cursor");
  const owner = queryString(query.owner, "owner");
  if (owner !== undefined && owner !== 'me' && owner !== 'unclaimed' && !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(owner)) {
    throw new ApiError(400, 'invalid_owner_filter', 'owner must be a staff ID, me, or unclaimed.');
  }
  const rawWithdrawalPending = queryString(query.withdrawalPending, 'withdrawalPending');
  if (rawWithdrawalPending !== undefined && rawWithdrawalPending !== 'true' && rawWithdrawalPending !== 'false') {
    throw new ApiError(400, 'invalid_withdrawal_filter', 'withdrawalPending must be true or false.');
  }
  const minAgeMinutes = ageQuery(query.minAgeMinutes, 'minAgeMinutes');
  const maxAgeMinutes = ageQuery(query.maxAgeMinutes, 'maxAgeMinutes');
  if (minAgeMinutes !== undefined && maxAgeMinutes !== undefined && minAgeMinutes > maxAgeMinutes) {
    throw new ApiError(400, 'invalid_age_range', 'minAgeMinutes must be less than or equal to maxAgeMinutes.');
  }
  return {
    limit,
    ...(statuses ? { statuses } : {}),
    ...(createdAfter ? { createdAfter } : {}),
    ...(createdBefore ? { createdBefore } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(rawWithdrawalPending !== undefined ? { withdrawalPending: rawWithdrawalPending === 'true' } : {}),
    ...(minAgeMinutes !== undefined ? { minAgeMinutes } : {}),
    ...(maxAgeMinutes !== undefined ? { maxAgeMinutes } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function createStaffIncidentsRouter(
  config: ServerConfig,
  pool: Pool,
  services: IncidentServices,
  disconnectStaffSession: (sessionId: string) => void,
  disconnectStaffAccount: (staffId: string) => void = () => {},
): StaffRoutes {
  const router = Router();
  const sessions = createStaffSession(config, pool);

  const admin = createStaffAdminRepository(pool);
  const access = (request: Parameters<RequestHandler>[0]): StaffAccess => ({ principal: request.staffPrincipal!, sessionId: request.sessionID });
  const requireCapability = (capability: StaffCapability): RequestHandler => (request, _response, next) => {
    try { requireStaffCapability(request.staffPrincipal, capability); next(); } catch (error) { next(error); }
  };

  const requireStaff: RequestHandler = (request, _response, next) => {
    if (!request.staffPrincipal) {
      next(new ApiError(401, "staff_session_required", "A valid staff session is required."));
      return;
    }
    next();
  };

  router.get("/session", (request, response) => {
    response.json({ authenticated: Boolean(request.staffPrincipal), principal: request.staffPrincipal ? { id: request.staffPrincipal.id, username: request.staffPrincipal.username, displayName: request.staffPrincipal.displayName, role: request.staffPrincipal.role, regionIds: request.staffPrincipal.regionIds } : null });
  });

  router.post("/session", async (request, response) => {
    if (!isBody(request.body)) {
      throw new ApiError(400, "invalid_body", "Request body must include username and password.");
    }
    const { username, password } = request.body;
    if (typeof username !== "string" || username.length > 128 || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 1024) {
      throw new ApiError(400, "invalid_credentials", "Username and password are required.");
    }
    const principal = await authenticateStaff(pool, username, password);
    if (!principal || !principal.regionIds.length) {
      throw new ApiError(401, "invalid_credentials", "Credentials were not accepted.");
    }

    await sessions.regenerate(request);
    request.session.staffPrincipalId = principal.id;
    request.session.staffCredentialVersion = principal.credentialVersion;
    await sessions.save(request);
    response.json({ authenticated: true, principal: { id: principal.id, username: principal.username, displayName: principal.displayName, role: principal.role, regionIds: principal.regionIds } });
  });

  router.delete("/session", requireStaff, async (request, response) => {
    const sessionId = request.sessionID;
    await sessions.destroy(request);
    if (sessionId) disconnectStaffSession(sessionId);
    response.json({ authenticated: false });
  });

  router.get("/incidents", requireCapability("read_incidents"), async (request, response) => {
    const filter = incidentListFilter(request.query);
    response.json(await services.listIncidentsForStaff(access(request), filter));
  });

  router.get("/incidents/:id", requireCapability("read_incidents"), async (request, response) => {
    const incidentId = request.params.id;
    if (typeof incidentId !== "string") {
      throw new ApiError(400, "invalid_incident_id", "Incident id is invalid.");
    }
    response.json(await services.getIncidentForStaff(incidentId, access(request)));
  });

  function incidentId(request: Parameters<RequestHandler>[0]): string {
    const id = request.params.id;
    if (typeof id !== 'string' || !id || id.length > 128) throw new ApiError(400,'invalid_incident_id','Incident id is invalid.');
    return id;
  }
  router.patch('/incidents/:id/status', requireCapability('work_incidents'), async (request,response) => {
    if (!isBody(request.body) || !isIncidentStatus(request.body.status) || request.body.status === 'received' || request.body.status === 'assigned') {
      throw new ApiError(400,'invalid_status','Choose a staging workflow status; assignment uses the simulated responder action.');
    }
    response.json(await services.setIncidentStatus(incidentId(request),request.body.status,access(request),validateWorkflowAction(request.body)));
  });
  router.patch('/incidents/:id/assignment', requireCapability('work_incidents'), async (request,response) => {
    if (!isBody(request.body) || typeof request.body.unitId !== 'string') throw new ApiError(400,'invalid_body','unitId is required.');
    response.json(await services.assignIncidentUnit(incidentId(request),request.body.unitId,access(request),validateWorkflowAction(request.body)));
  });
  for (const action of ['claim','release','takeover'] as const) {
    router.post('/incidents/:id/'+action,requireCapability(action === 'takeover' ? 'manage_escalations' : 'work_incidents'),async (request,response) => {
      response.json(await services.changeOwnership(incidentId(request),action,access(request),validateOwnershipAction(request.body)));
    });
  }
  router.post('/incidents/:id/withdrawal-decision',requireCapability('work_incidents'),async (request,response) => {
    if (!isBody(request.body) || (request.body.outcome !== 'accepted' && request.body.outcome !== 'denied')) {
      throw new ApiError(400,'invalid_withdrawal_outcome','Choose accepted or denied.');
    }
    response.json(await services.decideWithdrawal(incidentId(request),request.body.outcome,access(request),validateWorkflowAction(request.body)));
  });

  router.get("/audit/incidents", requireCapability("read_audit"), async (request, response) => {
    const limit = Number(queryString(request.query.limit, "limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "invalid_limit", "limit must be 1–100.");
    response.json(await services.listIncidentAuditForStaff(access(request), limit));
  });

  router.get("/audit/staff", requireCapability("read_audit"), async (request, response) => {
    const limit = Number(queryString(request.query.limit, "limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "invalid_limit", "limit must be 1–100.");
    response.json(await admin.listAudit(access(request), limit));
  });

  router.get("/accounts", requireCapability("manage_staff"), async (request, response) => {
    response.json(await admin.list(access(request)));
  });
  router.post("/accounts", requireCapability("manage_staff"), async (request, response) => {
    if (!isBody(request.body)) throw new ApiError(400, "invalid_body", "Staff account fields are required.");
    const update = validateAccountUpdate(request.body);
    if (typeof request.body.username !== "string") throw new ApiError(400, "invalid_staff_identifier", "Account identifier is required.");
    const created = await admin.create(access(request), { ...update, username: request.body.username, password: validatePassword(request.body.password) });
    response.status(201).json(created);
  });
  async function finishAccountChange(request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1], changed: Awaited<ReturnType<typeof admin.update>>) {
    // Callback is deliberately after commit/release; realtime can use its own pool safely.
    disconnectStaffAccount(changed.id);
    const requiresReauthentication = changed.id === request.staffPrincipal!.id;
    if (requiresReauthentication) {
      const previousSessionId = request.sessionID;
      await sessions.regenerate(request);
      if (previousSessionId) disconnectStaffSession(previousSessionId);
    }
    response.json({ account: changed, requiresReauthentication });
  }
  function targetId(request: Parameters<RequestHandler>[0]): string {
    const id = request.params.id;
    if (typeof id !== "string" || id.length > 128) throw new ApiError(400, "invalid_staff_id", "Staff id is invalid.");
    return id;
  }
  router.patch("/accounts/:id", requireCapability("manage_staff"), async (request, response) => {
    if (!isBody(request.body)) throw new ApiError(400, "invalid_body", "Display name, role and regions are required.");
    await finishAccountChange(request, response, await admin.update(access(request), targetId(request), validateAccountUpdate(request.body)));
  });
  router.patch("/accounts/:id/active", requireCapability("manage_staff"), async (request, response) => {
    if (!isBody(request.body) || typeof request.body.active !== "boolean") throw new ApiError(400, "invalid_body", "An active boolean is required.");
    await finishAccountChange(request, response, await admin.setActive(access(request), targetId(request), request.body.active));
  });
  router.post("/accounts/:id/reset-password", requireCapability("manage_staff"), async (request, response) => {
    if (!isBody(request.body)) throw new ApiError(400, "invalid_body", "A new password is required.");
    await finishAccountChange(request, response, await admin.resetPassword(access(request), targetId(request), validatePassword(request.body.password)));
  });
  router.post("/accounts/:id/revoke-sessions", requireCapability("manage_staff"), async (request, response) => {
    await finishAccountChange(request, response, await admin.revokeSessions(access(request), targetId(request)));
  });

  return { router, sessions };
}
