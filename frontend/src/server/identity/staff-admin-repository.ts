import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { StaffAccount, StaffAccountInput, StaffAdminAuditEntry } from '../../shared/staff.js';
import { ApiError } from '../errors.js';
import { hashPassword } from './password.js';
import { isStaffRole, normalizeUsername, STAFF_ADMIN_ADVISORY_LOCK_KEY } from './staff-repository.js';
import { lockStaffAccess, type StaffAccess } from './staff-policy.js';

type AccountRow = { id: string; username: string; display_name: string; role: StaffAccount['role']; active: boolean; created_at: Date; updated_at: Date };
type AccountUpdate = { displayName: string; role: StaffAccount['role']; regionIds: string[] };
export function validateAccountUpdate(value: Record<string, unknown>): AccountUpdate {
  if (typeof value.displayName !== 'string' || value.displayName.trim().length < 1 || value.displayName.trim().length > 100 || !isStaffRole(value.role)) {
    throw new ApiError(400, 'invalid_staff_account', 'A display name of 1–100 characters and a supported staging role are required.');
  }
  if (!Array.isArray(value.regionIds) || value.regionIds.length !== 1 || value.regionIds.some(id => id !== 'local-staging')) {
    throw new ApiError(400, 'invalid_staff_regions', 'Only the synthetic local-staging region is configured.');
  }
  return { displayName: value.displayName.trim(), role: value.role, regionIds: [...new Set(value.regionIds)] as string[] };
}
export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value, 'utf8') > 1024) {
    throw new ApiError(400, 'invalid_password', 'Password must contain at least 12 characters and at most 1024 bytes.');
  }
  return value;
}
async function audit(client: PoolClient, access: StaffAccess, target: string | null, action: string, details: Record<string, unknown> = {}): Promise<void> {
  const regionId = access.principal.regionIds[0];
  if (!regionId) throw new ApiError(401, 'staff_session_required', 'A valid staff region is required.');
  await client.query('INSERT INTO staff_admin_audit_events(id,actor_staff_id,target_staff_id,action,details,region_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
    [randomUUID(), access.principal.id, target, action, JSON.stringify(details), regionId]);
}
async function account(client: PoolClient, id: string): Promise<StaffAccount> {
  const result = await client.query<AccountRow>('SELECT id,username,display_name,role,active,created_at,updated_at FROM staff_accounts WHERE id=$1', [id]);
  const row = result.rows[0];
  if (!row) throw new ApiError(404, 'staff_account_not_found', 'Staff account was not found.');
  const regions = await client.query<{region_id: string}>('SELECT region_id FROM staff_account_regions WHERE staff_id=$1 ORDER BY region_id', [id]);
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, active: row.active,
    regionIds: regions.rows.map(r => r.region_id), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
async function replaceRegions(client: PoolClient, id: string, regionIds: string[]): Promise<void> {
  await client.query('DELETE FROM staff_account_regions WHERE staff_id=$1', [id]);
  for (const regionId of regionIds) await client.query('INSERT INTO staff_account_regions(staff_id,region_id) VALUES($1,$2)', [id, regionId]);
}
async function invalidateSessions(client: PoolClient, id: string): Promise<void> {
  await client.query(`UPDATE staff_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),generation=generation+1,
    session_data='{}'::jsonb WHERE principal_id=$1`, [id]);
}
export function createStaffAdminRepository(pool: Pool) {
  async function transaction<T>(access: StaffAccess, targetId: string | null, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Same mutex as CLI bootstrap. Serialize admin mutations including concurrent
      // self-demotions and disabling another admin; avoid opposite actor/target lock order.
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [STAFF_ADMIN_ADVISORY_LOCK_KEY]);
      await client.query('SELECT id FROM staff_accounts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [[...new Set([access.principal.id, ...(targetId ? [targetId] : [])])].sort()]);
      await lockStaffAccess(client, access, 'manage_staff');
      if (targetId) await account(client, targetId);
      const result = await work(client);
      const remaining = await client.query(`SELECT 1 FROM staff_accounts a WHERE a.active AND a.role='operator_admin'
        AND EXISTS(SELECT 1 FROM staff_account_regions r WHERE r.staff_id=a.id) LIMIT 1`);
      if (!remaining.rowCount) throw new ApiError(409, 'last_active_admin', 'Keep at least one active operator administrator with an assigned region.');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof ApiError) throw error;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new ApiError(409, 'staff_account_conflict', 'This account identifier is unavailable.');
      }
      throw new ApiError(503, 'staff_storage_unavailable', 'Staff storage is unavailable.');
    } finally { client.release(); }
  }
  return {
    async listAudit(access: StaffAccess, limit: number): Promise<StaffAdminAuditEntry[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_limit', 'limit must be 1–100.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const principal = await lockStaffAccess(client, access, 'read_audit');
        const result = await client.query<{ id: string; region_id: string; actor_staff_id: string | null; target_staff_id: string | null; action: string; details: Record<string, unknown>; occurred_at: Date }>(
          `SELECT id,region_id,actor_staff_id,target_staff_id,action,details,occurred_at
            FROM staff_admin_audit_events WHERE region_id=ANY($1::text[])
              AND (action='bootstrap_first_admin' OR action LIKE 'staff:%' OR action IN ('outbox:list','outbox:retry'))
            ORDER BY occurred_at DESC,id DESC LIMIT $2`, [principal.regionIds, limit]);
        // Copy only explicitly allowed audit details. Credentials, verifiers, session
        // payloads and raw request bodies are not copied. Review reasons are an
        // intentional private audit field for the specific outbox retry action.
        const allowedDetails = ['role', 'fromRole', 'regionId', 'regionIds', 'fromRegionIds', 'count', 'limit', 'access'];
        const rows = result.rows.map(row => {
          const allowed = row.action === 'outbox:retry'
            ? ['eventId','incidentId','eventType','failedAttempts','totalFailures','reason']
            : row.action === 'outbox:list' ? ['state','limit'] : allowedDetails;
          return { id: row.id, regionId: row.region_id, actorStaffId: row.actor_staff_id,
            targetStaffId: row.target_staff_id, action: row.action,
            details: Object.fromEntries(Object.entries(row.details).filter(([key]) => allowed.includes(key))),
            occurredAt: new Date(row.occurred_at).toISOString() };
        });
        await audit(client, { ...access, principal }, null, 'staff:audit_access_attempt', { count: rows.length, regionIds: principal.regionIds, access: 'attempt' });
        await client.query('COMMIT');
        return rows;
      } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'staff_storage_unavailable', 'Staff audit storage is unavailable.');
      } finally { client.release(); }
    },
    list(access: StaffAccess): Promise<StaffAccount[]> {
      return transaction(access, null, async client => {
        const result = await client.query<{id: string}>('SELECT id FROM staff_accounts ORDER BY created_at,id LIMIT 500');
        const accounts: StaffAccount[] = [];
        for (const row of result.rows) accounts.push(await account(client, row.id));
        await audit(client, access, null, 'staff:list', { count: accounts.length, limit: 500, access: 'attempt' });
        return accounts;
      });
    },
    async create(access: StaffAccess, input: StaffAccountInput): Promise<StaffAccount> {
      const username = normalizeUsername(input.username);
      if (!username) throw new ApiError(400, 'invalid_staff_identifier', 'Use an account identifier with 3–64 lowercase letters, digits, dots, underscores or dashes.');
      const update = validateAccountUpdate(input as unknown as Record<string, unknown>);
      const credential = await hashPassword(validatePassword(input.password));
      return transaction(access, null, async client => {
        const id = randomUUID();
        await client.query('INSERT INTO staff_accounts(id,username,display_name,role,password_salt,password_verifier) VALUES($1,$2,$3,$4,$5,$6)', [id, username, update.displayName, update.role, credential.salt, credential.verifier]);
        await replaceRegions(client, id, update.regionIds);
        await audit(client, access, id, 'staff:create', { role: update.role, regionIds: update.regionIds });
        return account(client, id);
      });
    },
    update(access: StaffAccess, id: string, update: AccountUpdate): Promise<StaffAccount> {
      return transaction(access, id, async client => {
        const before = await account(client, id);
        await client.query('UPDATE staff_accounts SET display_name=$2,role=$3,credential_version=credential_version+1,updated_at=clock_timestamp() WHERE id=$1', [id, update.displayName, update.role]);
        await replaceRegions(client, id, update.regionIds);
        await invalidateSessions(client, id);
        await audit(client, access, id, 'staff:update_access', { fromRole: before.role, role: update.role, fromRegionIds: before.regionIds, regionIds: update.regionIds });
        return account(client, id);
      });
    },
    setActive(access: StaffAccess, id: string, active: boolean): Promise<StaffAccount> {
      return transaction(access, id, async client => {
        await client.query('UPDATE staff_accounts SET active=$2,credential_version=credential_version+1,updated_at=clock_timestamp() WHERE id=$1', [id, active]);
        await invalidateSessions(client, id);
        await audit(client, access, id, active ? 'staff:enable' : 'staff:disable');
        return account(client, id);
      });
    },
    async resetPassword(access: StaffAccess, id: string, password: string): Promise<StaffAccount> {
      const credential = await hashPassword(validatePassword(password));
      return transaction(access, id, async client => {
        await client.query('UPDATE staff_accounts SET password_salt=$2,password_verifier=$3,credential_version=credential_version+1,updated_at=clock_timestamp() WHERE id=$1', [id, credential.salt, credential.verifier]);
        await invalidateSessions(client, id);
        await audit(client, access, id, 'staff:reset_password');
        return account(client, id);
      });
    },
    revokeSessions(access: StaffAccess, id: string): Promise<StaffAccount> {
      return transaction(access, id, async client => {
        // Version bump also blocks a concurrent login verified before revocation.
        await client.query('UPDATE staff_accounts SET credential_version=credential_version+1,updated_at=clock_timestamp() WHERE id=$1', [id]);
        await invalidateSessions(client, id);
        await audit(client, access, id, 'staff:revoke_sessions');
        return account(client, id);
      });
    },
  };
}
