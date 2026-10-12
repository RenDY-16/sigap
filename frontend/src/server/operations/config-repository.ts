import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { OperationsConfiguration, OperationsConfigurationInput, IncidentCategoryConfiguration, OperationsWorkConfiguration, PublicOperationsConfiguration, SopRecord, SimulatedResponder } from '../../shared/operations.js';
import { ApiError } from '../errors.js';
import { lockStaffAccess, type StaffAccess } from '../identity/staff-policy.js';

interface ConfigRow {
  region_id: string; version: number; timezone: 'Asia/Makassar';
  service_hours: OperationsConfiguration['serviceHours'];
  public_fallback_copy: string; public_fallback_contact: string | null;
  created_at: Date | string;
}

/** Caller owns BEGIN/COMMIT/ROLLBACK and must roll back on any failure.
 * All authority, locks, configuration and audit writes use the supplied connection.
 * Region IDs select a resource; authority always comes from the persisted session.
 */
export interface OperationsConfigRepository {
  loadPublic(client: PoolClient, regionId: string): Promise<PublicOperationsConfiguration | null>;
  load(client: PoolClient, access: StaffAccess, regionId: string, version?: number): Promise<OperationsConfiguration | null>;
  loadForWork(client: PoolClient, access: StaffAccess, regionId: string, pinnedVersion?: number): Promise<OperationsWorkConfiguration | null>;
  replace(client: PoolClient, access: StaffAccess, regionId: string, expectedVersion: number, input: OperationsConfigurationInput): Promise<OperationsConfiguration>;
}

async function authorize(client: PoolClient, access: StaffAccess, regionId: string, write: boolean, capability: 'manage_staff' | 'read_incidents' | 'work_incidents' = write ? 'manage_staff' : 'read_incidents'): Promise<string> {
  const principal = await lockStaffAccess(client, access, capability);
  if (write && principal.role !== 'operator_admin') {
    throw new ApiError(403, 'staff_permission_required', 'Only operator administrators can manage operational configuration.');
  }
  if (regionId !== 'local-staging' || !principal.regionIds.includes(regionId)) {
    throw new ApiError(404, 'operations_region_not_found', 'Operational configuration was not found.');
  }
  const region = await client.query<{ synthetic: boolean }>(
    `SELECT synthetic FROM regions WHERE id=$1 ${write ? 'FOR UPDATE' : 'FOR SHARE'}`, [regionId],
  );
  if (!region.rows[0]?.synthetic) throw new ApiError(404, 'operations_region_not_found', 'Operational configuration was not found.');
  return principal.id;
}

function invalid(): never {
  throw new ApiError(400, 'invalid_operations_config', 'Operational configuration is invalid. Use synthetic staging data only.');
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function identifier(value: unknown, max = 64): value is string {
  return typeof value === 'string' && value.length <= max && /^[a-z0-9][a-z0-9_-]*$/.test(value);
}
function unique(values: string[]): boolean { return new Set(values).size === values.length; }

/** Defense in depth for typed callers; API parsing is responsible for unknown input. */
function validate(input: OperationsConfigurationInput, regionId: string): void {
  if (input.timezone !== 'Asia/Makassar' || !Array.isArray(input.serviceHours) || input.serviceHours.length > 28 ||
      !text(input.publicFallback?.copy, 2000) ||
      (input.publicFallback.contact !== null && !text(input.publicFallback.contact, 200)) ||
      !Array.isArray(input.categories) || !input.categories.length || input.categories.length > 50 ||
      !Array.isArray(input.sops) || input.sops.length > 100 ||
      !Array.isArray(input.responders) || input.responders.length > 100) invalid();
  const windows = new Map<number, { start: string; end: string }[]>();
  for (const hours of input.serviceHours) {
    if (!Number.isInteger(hours.weekday) || hours.weekday < 1 || hours.weekday > 7 ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.opensAt) ||
        !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(hours.closesAt) || hours.opensAt >= hours.closesAt) invalid();
    const day = windows.get(hours.weekday) ?? [];
    if (day.some(w => hours.opensAt < w.end && hours.closesAt > w.start)) invalid();
    day.push({ start: hours.opensAt, end: hours.closesAt }); windows.set(hours.weekday, day);
  }
  if (!unique(input.categories.map(c => c.id)) || !unique(input.sops.map(s => s.id)) ||
      !unique(input.responders.map(r => r.id))) invalid();
  const categories = new Set(input.categories.map(c => c.id));
  for (const category of input.categories) {
    if (!identifier(category.id) || !text(category.label, 200) || typeof category.enabled !== 'boolean' ||
        !Array.isArray(category.requiredFields) || category.requiredFields.length > 25 ||
        !unique(category.requiredFields.map(f => f.key))) invalid();
    for (const field of category.requiredFields) {
      if (!identifier(field.key) || !text(field.label, 200) || typeof field.required !== 'boolean' ||
          !['text', 'boolean', 'select'].includes(field.type)) invalid();
      // Intake reserves description for the existing column and rejects object prototype keys.
      if (['constructor','prototype','__proto__'].includes(field.key) ||
          (field.key === 'description' && field.type !== 'text')) invalid();
      if (field.type === 'select') {
        if (!Array.isArray(field.options) || !field.options.length || field.options.length > 50 ||
            !field.options.every(option => text(option, 200) && option === option.trim()) || !unique(field.options)) invalid();
      } else if (field.options !== undefined) invalid();
    }
  }
  for (const sop of input.sops) {
    if (!identifier(sop.id) || !Number.isSafeInteger(sop.version) || sop.version < 1 || sop.version > 2147483647 ||
        !categories.has(sop.categoryId) || !text(sop.title, 200) || sop.simulated !== true ||
        !Array.isArray(sop.steps) || !sop.steps.length || sop.steps.length > 50 ||
        !sop.steps.every(step => text(step, 2000))) invalid();
  }
  // Enabled intake must have a SOP in this same snapshot, before any write.
  const sopCategoryIds = new Set(input.sops.map(sop => sop.categoryId));
  if (input.categories.some(category => category.enabled && !sopCategoryIds.has(category.id))) invalid();
  for (const responder of input.responders) {
    if (!identifier(responder.id, 128) || !text(responder.label, 200) || responder.simulated !== true ||
        typeof responder.enabled !== 'boolean' || !['available', 'busy', 'offline'].includes(responder.availability) ||
        !Array.isArray(responder.coverageRegionIds) || !unique(responder.coverageRegionIds) ||
        !responder.coverageRegionIds.every(id => id === regionId) ||
        !Array.isArray(responder.categoryIds) || !unique(responder.categoryIds) ||
        !responder.categoryIds.every(id => categories.has(id))) invalid();
  }
}

async function read(client: PoolClient, regionId: string, version?: number): Promise<OperationsConfiguration | null> {
  const config = await client.query<ConfigRow>(`SELECT * FROM operation_config_versions
    WHERE region_id=$1 AND ($2::integer IS NULL OR version=$2) ORDER BY version DESC LIMIT 1`, [regionId, version ?? null]);
  const row = config.rows[0];
  if (!row) return null;
  const args = [regionId, row.version];
  const categories = await client.query<IncidentCategoryConfiguration>(`SELECT id,label,enabled,required_fields AS "requiredFields"
    FROM operation_categories WHERE region_id=$1 AND config_version=$2 ORDER BY id`, args);
  const sops = await client.query<SopRecord>(`SELECT id,version,category_id AS "categoryId",title,steps,simulated
    FROM operation_sops WHERE region_id=$1 AND config_version=$2 ORDER BY id`, args);
  const responders = await client.query<SimulatedResponder>(`SELECT r.id,r.label,r.enabled,r.simulated,r.availability,
    ARRAY(SELECT c.coverage_region_id FROM operation_responder_coverage c
      WHERE c.region_id=r.region_id AND c.config_version=r.config_version AND c.responder_id=r.id ORDER BY c.coverage_region_id) AS "coverageRegionIds",
    ARRAY(SELECT c.category_id FROM operation_responder_categories c
      WHERE c.region_id=r.region_id AND c.config_version=r.config_version AND c.responder_id=r.id ORDER BY c.category_id) AS "categoryIds"
    FROM operation_responders r WHERE r.region_id=$1 AND r.config_version=$2 ORDER BY r.id`, args);
  return { regionId, version: row.version, timezone: row.timezone, serviceHours: row.service_hours,
    publicFallback: { copy: row.public_fallback_copy, contact: row.public_fallback_contact },
    simulated: true, externalDispatchEnabled: false, categories: categories.rows, sops: sops.rows, responders: responders.rows,
    createdAt: new Date(row.created_at).toISOString() };
}

async function assertSopHistory(client: PoolClient, regionId: string, input: OperationsConfigurationInput): Promise<void> {
  for (const sop of input.sops) {
    const history = await client.query<{ version: number; category_id: string; title: string; steps: string[] }>(
      `SELECT version,category_id,title,steps FROM operation_sops WHERE region_id=$1 AND id=$2 ORDER BY version DESC, config_version DESC LIMIT 1`, [regionId, sop.id],
    );
    const previous = history.rows[0];
    if (previous && (sop.version < previous.version ||
        (sop.version === previous.version && (sop.categoryId !== previous.category_id || sop.title !== previous.title ||
          JSON.stringify(sop.steps) !== JSON.stringify(previous.steps))))) {
      throw new ApiError(409, 'sop_version_conflict', 'Changed SOP content requires a new version.');
    }
  }
}

export function createOperationsConfigRepository(): OperationsConfigRepository {
  return {
    async loadPublic(client, regionId) {
      if (regionId !== 'local-staging') return null;
      const config = await client.query<ConfigRow>(`SELECT region_id,version,timezone,service_hours,public_fallback_copy,public_fallback_contact,created_at
        FROM operation_config_versions WHERE region_id=$1 ORDER BY version DESC LIMIT 1`, [regionId]);
      const row = config.rows[0];
      if (!row) return null;
      const region = await client.query<{ synthetic: boolean }>('SELECT synthetic FROM regions WHERE id=$1', [regionId]);
      if (!region.rows[0]?.synthetic) return null;
      const categories = await client.query<IncidentCategoryConfiguration>(`SELECT id,label,required_fields AS "requiredFields"
        FROM operation_categories WHERE region_id=$1 AND config_version=$2 AND enabled=true ORDER BY id`, [regionId,row.version]);
      // Construct an allowlist projection instead of serializing any repository record.
      return {
        version: row.version,
        timezone: row.timezone,
        serviceHours: row.service_hours,
        publicFallback: { copy: row.public_fallback_copy, contact: row.public_fallback_contact },
        categories: categories.rows.map(category => ({
          id: category.id,
          label: category.label,
          requiredFields: category.requiredFields.map(field => ({
            key: field.key, label: field.label, type: field.type, required: field.required,
            ...(field.type === 'select' && Array.isArray(field.options) ? { options: [...field.options] } : {}),
          })),
        })),
      };
    },
    async load(client, access, regionId, version) {
      await authorize(client, access, regionId, false);
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 2147483647)) invalid();
      return read(client, regionId, version);
    },
    async loadForWork(client, access, regionId, pinnedVersion) {
      await authorize(client, access, regionId, false, 'work_incidents');
      const config = await read(client, regionId);
      if (!config) return null;
      const pinned = pinnedVersion === undefined ? null : await read(client, regionId, pinnedVersion);
      if (pinnedVersion !== undefined && !pinned) return null;
      return { version: config.version, categories: config.categories, sops: config.sops, responders: config.responders,
        ...(pinned ? { pinnedConfigVersion: pinned.version, pinnedSops: pinned.sops } : {}) };
    },
    async replace(client, access, regionId, expectedVersion, input) {
      const staffId = await authorize(client, access, regionId, true);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 2147483647) invalid();
      validate(input, regionId);
      const current = await read(client, regionId);
      if ((current?.version ?? 0) !== expectedVersion) {
        throw new ApiError(409, 'operations_version_conflict', 'Operational configuration changed. Refresh before saving.');
      }
      await assertSopHistory(client, regionId, input);
      const version = expectedVersion + 1;
      await client.query(`INSERT INTO operation_config_versions
        (region_id,version,timezone,service_hours,public_fallback_copy,public_fallback_contact,created_by_staff_id)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [regionId, version, input.timezone, JSON.stringify(input.serviceHours), input.publicFallback.copy, input.publicFallback.contact, staffId]);
      for (const category of input.categories) {
        await client.query(`INSERT INTO operation_categories(region_id,config_version,id,label,enabled,required_fields)
          VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [regionId,version,category.id,category.label,category.enabled,JSON.stringify(category.requiredFields)]);
      }
      for (const sop of input.sops) {
        await client.query(`INSERT INTO operation_sops(region_id,config_version,id,version,category_id,title,steps)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [regionId,version,sop.id,sop.version,sop.categoryId,sop.title,JSON.stringify(sop.steps)]);
      }
      for (const responder of input.responders) {
        await client.query(`INSERT INTO operation_responders(region_id,config_version,id,label,enabled,availability)
          VALUES($1,$2,$3,$4,$5,$6)`, [regionId,version,responder.id,responder.label,responder.enabled,responder.availability]);
        for (const coverage of responder.coverageRegionIds) {
          await client.query(`INSERT INTO operation_responder_coverage(region_id,config_version,responder_id,coverage_region_id)
            VALUES($1,$2,$3,$4)`, [regionId,version,responder.id,coverage]);
        }
        for (const categoryId of responder.categoryIds) {
          await client.query(`INSERT INTO operation_responder_categories(region_id,config_version,responder_id,category_id)
            VALUES($1,$2,$3,$4)`, [regionId,version,responder.id,categoryId]);
        }
      }
      await client.query(`INSERT INTO staff_admin_audit_events(id,actor_staff_id,action,details,region_id)
        VALUES($1,$2,'operations:config:replaced',$3::jsonb,$4)`,
      [randomUUID(), staffId, JSON.stringify({ oldVersion: expectedVersion, newVersion: version, simulated: true }), regionId]);
      const saved = await read(client, regionId, version);
      if (!saved) throw new ApiError(503, 'operations_storage_unavailable', 'Operational configuration is unavailable.');
      return saved;
    },
  };
}
