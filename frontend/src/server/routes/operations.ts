import { Router, type Request, type RequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { OperationsConfigurationInput, RequiredIncidentField, ServiceHours, SopRecord, SimulatedResponder } from '../../shared/operations.js';
import { createOperationsConfigRepository } from '../operations/config-repository.js';
import { ApiError } from '../errors.js';
import { lockStaffAccess, requireStaffCapability, type StaffAccess } from '../identity/staff-policy.js';

const STAGING_REGION = 'local-staging';
const MAX_CONFIG_BYTES = 8 * 1024;
const identifierPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function boundedText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max && (allowEmpty || value.trim().length > 0);
}
function id(value: unknown): value is string { return typeof value === 'string' && identifierPattern.test(value); }
function parseArray<T>(value: unknown, max: number, parser: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const parsed = value.map(parser);
  return parsed.some(item => item === null) ? null : parsed as T[];
}
function invalidConfig(): never {
  throw new ApiError(400, 'invalid_operations_config', 'Konfigurasi operasi tidak valid atau melewati batas ukuran.');
}

/** Strict allowlist parser for the complete client-submitted config; no client-supplied metadata is accepted. */
export function parseOperationsConfiguration(value: unknown): OperationsConfigurationInput {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { return invalidConfig(); }
  if (Buffer.byteLength(encoded ?? '', 'utf8') > MAX_CONFIG_BYTES) return invalidConfig();
  const root = record(value);
  if (!root || !exactKeys(root, ['timezone','serviceHours','publicFallback','categories','sops','responders']) || root.timezone !== 'Asia/Makassar') return invalidConfig();

  const serviceHours = parseArray<ServiceHours>(root.serviceHours, 28, item => {
    const row = record(item);
    if (!row || !exactKeys(row, ['weekday','opensAt','closesAt']) || !Number.isInteger(row.weekday) ||
        (row.weekday as number) < 1 || (row.weekday as number) > 7 ||
        typeof row.opensAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.opensAt) ||
        typeof row.closesAt !== 'string' || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(row.closesAt)) return null;
    return { weekday: row.weekday as ServiceHours['weekday'], opensAt: row.opensAt, closesAt: row.closesAt };
  });
  const fallback = record(root.publicFallback);
  if (!serviceHours || !fallback || !exactKeys(fallback, ['copy','contact']) || !boundedText(fallback.copy, 2000) ||
      !(fallback.contact === null || boundedText(fallback.contact, 200))) return invalidConfig();

  const categories = parseArray<OperationsConfigurationInput['categories'][number]>(root.categories, 50, item => {
    const row = record(item);
    if (!row || !exactKeys(row, ['id','label','enabled','requiredFields']) || !id(row.id) ||
        !boundedText(row.label, 200) || typeof row.enabled !== 'boolean') return null;
    const requiredFields = parseArray<RequiredIncidentField>(row.requiredFields, 25, fieldValue => {
      const field = record(fieldValue);
      if (!field) return null;
      const allowedFieldShape = exactKeys(field, ['key','label','type','required','options']) || exactKeys(field, ['key','label','type','required']);
      if (!allowedFieldShape || !['key','label','type','required'].every(key => key in field) || !id(field.key) ||
          ['constructor','prototype','__proto__'].includes(String(field.key)) || !boundedText(field.label, 200) ||
          typeof field.required !== 'boolean' || !['text','boolean','select'].includes(String(field.type)) ||
          (field.key === 'description' && field.type !== 'text')) return null;
      if (field.type === 'select') {
        const options = parseArray<string>(field.options, 50, option => boundedText(option, 200) && option === option.trim() ? option : null);
        if (!options || !options.length || new Set(options).size !== options.length) return null;
        return { key: field.key, label: field.label, type: field.type, required: field.required, options };
      }
      if (field.options !== undefined) return null;
      return { key: field.key, label: field.label, type: field.type as RequiredIncidentField['type'], required: field.required };
    });
    if (!requiredFields || new Set(requiredFields.map(field => field.key)).size !== requiredFields.length) return null;
    return { id: row.id, label: row.label, enabled: row.enabled, requiredFields };
  });
  if (!categories || !categories.length || new Set(categories.map(category => category.id)).size !== categories.length) return invalidConfig();

  const sops = parseArray<SopRecord>(root.sops, 100, item => {
    const row = record(item);
    if (!row || !exactKeys(row, ['id','version','categoryId','title','steps','simulated']) || !id(row.id) ||
        !Number.isSafeInteger(row.version) || (row.version as number) < 1 || !id(row.categoryId) ||
        !boundedText(row.title, 200) || row.simulated !== true) return null;
    const steps = parseArray<string>(row.steps, 50, step => boundedText(step, 2000) ? step : null);
    if (!steps || !steps.length) return null;
    return { id: row.id, version: row.version as number, categoryId: row.categoryId, title: row.title, steps, simulated: true };
  });
  if (!sops || new Set(sops.map(sop => sop.id)).size !== sops.length) return invalidConfig();

  const responders = parseArray<SimulatedResponder>(root.responders, 100, item => {
    const row = record(item);
    if (!row || !exactKeys(row, ['id','label','enabled','simulated','availability','coverageRegionIds','categoryIds']) ||
        !id(row.id) || !boundedText(row.label, 200) || typeof row.enabled !== 'boolean' || row.simulated !== true ||
        !['available','busy','offline'].includes(String(row.availability))) return null;
    const coverage = parseArray<string>(row.coverageRegionIds, 1, regionId => regionId === STAGING_REGION ? STAGING_REGION : null);
    const categoryIds = parseArray<string>(row.categoryIds, 50, categoryId => id(categoryId) ? categoryId : null);
    if (!coverage || !categoryIds || new Set(coverage).size !== coverage.length || new Set(categoryIds).size !== categoryIds.length) return null;
    return { id: row.id, label: row.label, enabled: row.enabled, simulated: true,
      availability: row.availability as SimulatedResponder['availability'], coverageRegionIds: coverage, categoryIds };
  });
  if (!responders || new Set(responders.map(responder => responder.id)).size !== responders.length) return invalidConfig();

  const knownCategories = new Set(categories.map(category => category.id));
  if (sops.some(sop => !knownCategories.has(sop.categoryId)) ||
      responders.some(responder => responder.categoryIds.some(categoryId => !knownCategories.has(categoryId))) ||
      categories.some(category => category.enabled && !sops.some(sop => sop.categoryId === category.id))) return invalidConfig();
  return { timezone: 'Asia/Makassar', serviceHours, publicFallback: { copy: fallback.copy, contact: fallback.contact }, categories, sops, responders };
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  } finally { client.release(); }
}

function staffAccess(request: Request): StaffAccess {
  if (!request.staffPrincipal || !request.sessionID) throw new ApiError(401, 'staff_session_required', 'Sesi staf aktif diperlukan.');
  return { principal: request.staffPrincipal, sessionId: request.sessionID };
}
function queryVersion(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) throw new ApiError(400, 'invalid_config_version', 'version harus berupa integer positif.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) throw new ApiError(400, 'invalid_config_version', 'version harus berupa integer positif.');
  return parsed;
}

export function createPublicOperationsRouter(pool: Pool): ReturnType<typeof Router> {
  const router = Router();
  const repository = createOperationsConfigRepository();
  router.get('/public-config', async (_request, response) => {
    const client = await pool.connect();
    try {
      const config = await repository.loadPublic(client, STAGING_REGION);
      if (!config) throw new ApiError(503, 'operations_config_unavailable', 'Konfigurasi layanan staging belum tersedia.');
      response.setHeader('Cache-Control', 'no-store');
      response.json(config);
    } finally { client.release(); }
  });
  return router;
}

export function createStaffOperationsRouter(pool: Pool): ReturnType<typeof Router> {
  const router = Router();
  const repository = createOperationsConfigRepository();
  const requireAdmin: RequestHandler = (request, _response, next) => {
    try { requireStaffCapability(request.staffPrincipal, 'manage_staff'); next(); } catch (error) { next(error); }
  };
  router.get('/work-config', async (request, response) => {
    requireStaffCapability(request.staffPrincipal, 'work_incidents');
    const rawIncidentId = request.query.incidentId;
    if (rawIncidentId !== undefined && (typeof rawIncidentId !== 'string' || rawIncidentId.length < 1 || rawIncidentId.length > 128)) {
      throw new ApiError(400, 'invalid_incident_id', 'incidentId must be a bounded incident identifier.');
    }
    const result = await transaction(pool, async client => {
      const access = staffAccess(request);
      const principal = await lockStaffAccess(client, access, 'work_incidents');
      let pinnedVersion: number | undefined;
      if (typeof rawIncidentId === 'string') {
        const row = await client.query<{ config_version: number }>(`SELECT config_version FROM incidents
          WHERE id=$1 AND region_id=$2 AND region_id=ANY($3::text[]) FOR SHARE`, [rawIncidentId, STAGING_REGION, principal.regionIds]);
        if (!row.rows[0]) throw new ApiError(404, 'incident_not_found', 'Incident was not found in the current staff region.');
        pinnedVersion = row.rows[0].config_version;
      }
      const config = await repository.loadForWork(client, access, STAGING_REGION, pinnedVersion);
      if (!config) throw new ApiError(503, 'operations_config_unavailable', 'Konfigurasi workflow staging belum tersedia.');
      return config;
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(result);
  });
  router.get('/config', requireAdmin, async (request, response) => {
    const version = queryVersion(request.query.version);
    const result = await transaction(pool, async client => {
      const principal = await lockStaffAccess(client, staffAccess(request), 'manage_staff');
      if (principal.role !== 'operator_admin') throw new ApiError(403, 'staff_permission_required', 'Hanya operator administrator yang dapat membaca konfigurasi operasi.');
      const config = await repository.load(client, staffAccess(request), STAGING_REGION, version);
      if (!config) throw new ApiError(404, 'operations_config_not_found', 'Snapshot konfigurasi tidak ditemukan.');
      return config;
    });
    response.json(result);
  });
  router.put('/config', requireAdmin, async (request, response) => {
    const body = record(request.body);
    if (!body || !exactKeys(body, ['expectedVersion','configuration']) || !Number.isSafeInteger(body.expectedVersion) ||
        (body.expectedVersion as number) < 0 || (body.expectedVersion as number) >= 2147483647) {
      throw new ApiError(400, 'invalid_config_version', 'expectedVersion harus berupa integer valid.');
    }
    const configuration = parseOperationsConfiguration(body.configuration);
    const result = await transaction(pool, async client => repository.replace(
      client, staffAccess(request), STAGING_REGION, body.expectedVersion as number, configuration,
    ));
    response.json(result);
  });
  return router;
}
