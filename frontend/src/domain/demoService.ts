import { STAFF_REQUEST_HEADER, STAFF_REQUEST_VALUE } from '../shared/request-security';
import type { PublicIncident, CreateIncidentInput as SharedCreateIncidentInput, StaffIncident, WorkflowActionInput, OwnershipActionInput } from '../shared/domain';
export type { StaffIncident, WorkflowActionInput, OwnershipActionInput } from '../shared/domain';
import type { StaffIdentity, StaffAccount, StaffAccountInput, StaffAdminAuditEntry, IncidentAuditEntry } from '../shared/staff';
import type { OperationsConfiguration, OperationsConfigurationInput, OperationsWorkConfiguration, PublicOperationsConfiguration } from '../shared/operations';
export type { OperationsConfiguration, OperationsConfigurationInput, OperationsWorkConfiguration, PublicOperationsConfiguration } from '../shared/operations';
export type { StaffIdentity, StaffAccount, StaffAccountInput, StaffAdminAuditEntry, IncidentAuditEntry } from '../shared/staff';
export type IncidentStatus =
  | "received"
  | "acknowledged"
  | "triaged"
  | "assigned"
  | "in_progress"
  | "referred"
  | "delivery_failed"
  | "escalation_pending"
  | "resolved";

export type LocationSource = "gps" | "simulation";

export type DemoUnitId = string;

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

export type Incident = PublicIncident;
export type CreateIncidentInput = SharedCreateIncidentInput;

export interface PendingCreateDraft {
  token: string;
  idempotencyKey: string;
  input: CreateIncidentInput;
}

export type DemoServiceErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "network"
  | "storage";

export class DemoServiceError extends Error {
  constructor(
    public readonly code: DemoServiceErrorCode,
    message: string,
    public readonly status?: number,
    public readonly apiCode?: string,
  ) {
    super(message);
    this.name = "DemoServiceError";
  }
}

export const DEMO_UNITS: readonly { id: DemoUnitId; label: string }[] = [
  { id: "unit-01", label: "Unit 01 (simulasi)" },
  { id: "unit-02", label: "Unit 02 (simulasi)" },
  { id: "unit-03", label: "Unit 03 (simulasi)" },
];

const PENDING_CREATE_STORAGE_KEY = "sigap.pending-create.v1";

interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

function errorCodeForStatus(status: number): DemoServiceErrorCode {
  if (status === 400) return "invalid_input";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "network";
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    const method = (options.method ?? "GET").toUpperCase();
    const headers = new Headers(options.headers);
    if (/^\/api\/staff(?:\/|$)/.test(path) && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers.set(STAFF_REQUEST_HEADER, STAFF_REQUEST_VALUE);
    }
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new DemoServiceError(
      "network",
      "Server demo tidak dapat dijangkau. Periksa koneksi lalu coba lagi.",
    );
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    const payload = typeof body === "object" && body !== null ? body as ApiErrorPayload : null;
    const message = payload?.error?.message ?? "Permintaan belum dapat diproses. Silakan coba lagi.";
    throw new DemoServiceError(errorCodeForStatus(response.status), message, response.status, payload?.error?.code);
  }

  return body as T;
}

function jsonRequest(method: string, body?: unknown, headers: HeadersInit = {}): RequestInit {
  return {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function citizenHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function randomHex(byteLength: number): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new DemoServiceError("invalid_input", "Secure browser randomness is unavailable.");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeCreateInput(input: CreateIncidentInput): CreateIncidentInput {
  return {
    category: "security",
    categoryId: input.categoryId ?? 'security',
    ...(input.configVersion === undefined ? {} : { configVersion: input.configVersion }),
    fieldAnswers: Object.fromEntries(Object.entries(input.fieldAnswers ?? {}).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,value]) => [key,typeof value === 'string' ? value.trim() : value])),
    description: input.description.trim(),
    locationMode: input.locationMode,
    initialLocation: input.initialLocation ? { ...input.initialLocation } : null,
  };
}

function isCreateInput(value: unknown): value is CreateIncidentInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Partial<CreateIncidentInput>;
  return input.category === "security" &&
    (input.categoryId === undefined || (typeof input.categoryId === 'string' && input.categoryId.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/.test(input.categoryId))) &&
    (input.configVersion === undefined || (Number.isSafeInteger(input.configVersion) && input.configVersion > 0 && input.configVersion <= 2147483647)) &&
    (input.fieldAnswers === undefined || (typeof input.fieldAnswers === 'object' && input.fieldAnswers !== null && !Array.isArray(input.fieldAnswers) &&
      Object.entries(input.fieldAnswers).length <= 25 && Object.entries(input.fieldAnswers).every(([key,answer]) => /^[a-z0-9][a-z0-9_-]*$/.test(key) && !['description','__proto__','prototype','constructor'].includes(key) &&
        (typeof answer === 'boolean' || (typeof answer === 'string' && answer.length <= 500))))) &&
    typeof input.description === "string" &&
    (input.locationMode === "gps" || input.locationMode === "simulation") &&
    (input.initialLocation === null || (
      typeof input.initialLocation === "object" &&
      input.initialLocation !== null &&
      Number.isFinite(input.initialLocation.lat) &&
      Number.isFinite(input.initialLocation.lng)
    ));
}

export function getPendingCreateDraft(): PendingCreateDraft | null {
  try {
    const serialized = window.sessionStorage.getItem(PENDING_CREATE_STORAGE_KEY);
    if (!serialized) return null;
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null) return null;
    const draft = value as Partial<PendingCreateDraft>;
    if (typeof draft.token !== "string" || !/^[a-f0-9]{64}$/.test(draft.token) ||
        typeof draft.idempotencyKey !== "string" || !/^[a-f0-9]{64}$/.test(draft.idempotencyKey) ||
        draft.token === draft.idempotencyKey || !isCreateInput(draft.input)) {
      window.sessionStorage.removeItem(PENDING_CREATE_STORAGE_KEY);
      return null;
    }
    return { token: draft.token, idempotencyKey: draft.idempotencyKey, input: normalizeCreateInput(draft.input) };
  } catch {
    throw new DemoServiceError("storage", "Browser tidak dapat menyimpan percobaan laporan untuk retry.");
  }
}

export function preparePendingCreate(input: CreateIncidentInput): PendingCreateDraft {
  const normalized = normalizeCreateInput(input);
  const current = getPendingCreateDraft();
  if (current && JSON.stringify(current.input) === JSON.stringify(normalized)) return current;

  const draft = { token: randomHex(32), idempotencyKey: randomHex(32), input: normalized };
  try {
    window.sessionStorage.setItem(PENDING_CREATE_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    throw new DemoServiceError("storage", "Browser tidak dapat menyimpan percobaan laporan untuk retry.");
  }
  return draft;
}

export function clearPendingCreate(token: string): void {
  try {
    const current = getPendingCreateDraft();
    if (current?.token === token) window.sessionStorage.removeItem(PENDING_CREATE_STORAGE_KEY);
  } catch {
    // Create is already confirmed; a storage cleanup failure must not hide success.
  }
}

export async function createIncident(input: CreateIncidentInput, token: string, idempotencyKey: string): Promise<Incident> {
  let readiness: { status?: string };
  try {
    readiness = await request<{ status?: string }>("/api/readyz", { cache: "no-store" });
  } catch (cause) {
    if (cause instanceof DemoServiceError && cause.status === 503) {
      throw new DemoServiceError("storage", "Penyimpanan staging belum siap. Server belum mengonfirmasi laporan tersimpan; coba lagi dengan key yang sama.", 503);
    }
    throw cause;
  }
  if (readiness.status !== "ready") {
    throw new DemoServiceError("storage", "Penyimpanan staging belum siap. Server belum mengonfirmasi laporan tersimpan; coba lagi dengan key yang sama.", 503);
  }
  const incident = await request<Incident>("/api/citizen/incidents", {
    ...jsonRequest("POST", normalizeCreateInput(input), {
      ...citizenHeaders(token),
      "Idempotency-Key": idempotencyKey,
    }),
  });
  return incident;
}

export async function getIncidentByToken(token: string): Promise<Incident> {
  return request<Incident>("/api/citizen/incidents", {
    headers: citizenHeaders(token),
  });
}

export async function setSimulationLocation(token: string, point: GeoPoint): Promise<Incident> {
  return request<Incident>("/api/citizen/incidents/location", {
    ...jsonRequest("PUT", point, citizenHeaders(token)),
  });
}

export async function requestWithdrawal(token: string): Promise<Incident> {
  return request<Incident>("/api/citizen/incidents/withdrawal", {
    ...jsonRequest("POST", undefined, citizenHeaders(token)),
  });
}

export async function loginStaff(username: string, password: string): Promise<StaffIdentity | null> {
  const result = await request<{ authenticated: boolean; principal: StaffIdentity | null }>("/api/staff/session", {
    ...jsonRequest("POST", { username, password }),
    credentials: "include",
  });
  return result.authenticated === true ? result.principal : null;
}

export async function restoreStaffSession(): Promise<StaffIdentity | null> {
  try {
    const result = await request<{ authenticated: boolean; principal: StaffIdentity | null }>("/api/staff/session", {
      credentials: "include",
    });
    return result.authenticated === true ? result.principal : null;
  } catch (cause) {
    if (cause instanceof DemoServiceError && cause.status === 401) return null;
    throw cause;
  }
}

export async function logoutStaff(): Promise<void> {
  try {
    await request<null>("/api/staff/session", {
      ...jsonRequest("DELETE", undefined),
      credentials: "include",
    });
  } catch (cause) {
    if (cause instanceof DemoServiceError && cause.status === 401) return;
    throw cause;
  }
}

export interface StaffQueueFilters {
  statuses?: string[];
  owner?: 'me' | 'unclaimed';
  withdrawalPending?: boolean;
  minAgeMinutes?: number;
  maxAgeMinutes?: number;
  cursor?: string;
  limit?: number;
}
export interface StaffIncidentPage { items: StaffIncident[]; nextCursor: string | null }

export async function listIncidentsForStaff(filters: StaffQueueFilters = {}): Promise<StaffIncidentPage> {
  const query = new URLSearchParams();
  if (filters.statuses?.length) query.set('statuses', filters.statuses.join(','));
  if (filters.owner) query.set('owner', filters.owner);
  if (filters.withdrawalPending !== undefined) query.set('withdrawalPending', String(filters.withdrawalPending));
  if (filters.minAgeMinutes !== undefined) query.set('minAgeMinutes', String(filters.minAgeMinutes));
  if (filters.maxAgeMinutes !== undefined) query.set('maxAgeMinutes', String(filters.maxAgeMinutes));
  if (filters.cursor) query.set('cursor', filters.cursor);
  query.set('limit', String(filters.limit ?? 50));
  return request<StaffIncidentPage>(`/api/staff/incidents?${query.toString()}`, { credentials: 'include' });
}

export async function getPublicOperationsConfig(): Promise<PublicOperationsConfiguration> {
  return request<PublicOperationsConfiguration>('/api/operations/public-config', { cache: 'no-store' });
}
export async function getOperationsWorkConfig(incidentId?: string): Promise<OperationsWorkConfiguration> {
  const query = incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : '';
  return request<OperationsWorkConfiguration>(`/api/staff/operations/work-config${query}`, { credentials: 'include', cache: 'no-store' });
}
export async function getOperationsConfig(version?: number): Promise<OperationsConfiguration> {
  return request<OperationsConfiguration>(`/api/staff/operations/config${version ? `?version=${version}` : ''}`, { credentials: 'include', cache: 'no-store' });
}
export async function updateOperationsConfig(expectedVersion: number, configuration: OperationsConfigurationInput): Promise<OperationsConfiguration> {
  return request<OperationsConfiguration>('/api/staff/operations/config', { ...jsonRequest('PUT', { expectedVersion, configuration }), credentials: 'include' });
}

/** Legacy reason-only calls are rejected until the detail UI supplies an expected status and SOP. */
export async function setIncidentStatus(id: string, next: IncidentStatus, input?: WorkflowActionInput | string): Promise<StaffIncident> {
  if (!input || typeof input === 'string') throw new DemoServiceError('invalid_input','Pilih SOP dan status yang terlihat pada detail sebelum menyimpan.',400);
  return request<StaffIncident>(`/api/staff/incidents/${encodeURIComponent(id)}/status`, {
    ...jsonRequest('PATCH', { status: next, ...input }), credentials: 'include',
  });
}
export async function assignIncidentUnit(id: string, unitId: DemoUnitId, input?: WorkflowActionInput): Promise<StaffIncident> {
  if (!input) throw new DemoServiceError('invalid_input','Pilih SOP dan status yang terlihat pada detail sebelum menetapkan unit simulasi.',400);
  return request<StaffIncident>(`/api/staff/incidents/${encodeURIComponent(id)}/assignment`, {
    ...jsonRequest('PATCH', { unitId, ...input }), credentials: 'include',
  });
}
export async function changeIncidentOwnership(id: string, action: 'claim' | 'release' | 'takeover', input: OwnershipActionInput): Promise<StaffIncident> {
  return request<StaffIncident>(`/api/staff/incidents/${encodeURIComponent(id)}/${action}`, {
    ...jsonRequest('POST', input), credentials: 'include',
  });
}
export async function decideIncidentWithdrawal(id: string, outcome: 'accepted' | 'denied', input: WorkflowActionInput): Promise<StaffIncident> {
  return request<StaffIncident>(`/api/staff/incidents/${encodeURIComponent(id)}/withdrawal-decision`, {
    ...jsonRequest('POST', { outcome, ...input }), credentials: 'include',
  });
}
export async function getIncidentForStaff(id: string): Promise<StaffIncident> {
  return request<StaffIncident>(`/api/staff/incidents/${encodeURIComponent(id)}`, { credentials: 'include' });
}
export async function listStaffAccounts(): Promise<StaffAccount[]> {
  return request<StaffAccount[]>('/api/staff/accounts', { credentials: 'include' });
}
export async function createStaffAccount(input: StaffAccountInput): Promise<StaffAccount> {
  return request<StaffAccount>('/api/staff/accounts', { ...jsonRequest('POST', input), credentials: 'include' });
}
export async function changeStaffAccount(id: string, action: 'access' | 'active' | 'reset-password' | 'revoke-sessions', value: unknown): Promise<{ account: StaffAccount; requiresReauthentication: boolean }> {
  const suffix = action === 'access' ? '' : `/${action}`;
  return request(`/api/staff/accounts/${encodeURIComponent(id)}${suffix}`, {
    ...jsonRequest(action === 'access' || action === 'active' ? 'PATCH' : 'POST', value), credentials: 'include',
  });
}

export async function listIncidentAudit(): Promise<IncidentAuditEntry[]> {
  return request<IncidentAuditEntry[]>('/api/staff/audit/incidents?limit=100', { credentials: 'include' });
}
export async function listStaffAdminAudit(): Promise<StaffAdminAuditEntry[]> {
  return request<StaffAdminAuditEntry[]>('/api/staff/audit/staff?limit=100', { credentials: 'include' });
}
