import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
export const STAFF_ADMIN_ADVISORY_LOCK_KEY = '7351926417084';
type Database = Pool | PoolClient;
import { hashPassword, verifyPassword } from './password.js';
const DUMMY_SALT = '00000000000000000000000000000000';
const DUMMY_VERIFIER = '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
import { STAFF_ROLES, type StaffRole } from '../../shared/staff.js';
export { STAFF_ROLES, type StaffRole } from '../../shared/staff.js';
export interface StaffPrincipal { id: string; username: string; displayName: string; role: StaffRole; regionIds: string[]; credentialVersion: number }
export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) ? username : null;
}
export function isStaffRole(value: unknown): value is StaffRole { return typeof value === 'string' && STAFF_ROLES.includes(value as StaffRole); }
export async function authenticateStaff(pool: Pool, rawUsername: unknown, password: unknown): Promise<StaffPrincipal | null> {
  const username = normalizeUsername(rawUsername);
  if (!username || typeof password !== 'string') return null;
  const result = await pool.query<any>(`SELECT id,username,display_name,password_salt,password_verifier,role,credential_version,active FROM staff_accounts WHERE username=$1`, [username]);
  const row = result.rows[0];
  const passwordMatches = await verifyPassword(password, row?.password_salt ?? DUMMY_SALT, row?.password_verifier ?? DUMMY_VERIFIER);
  if (!row || row.active !== true || !isStaffRole(row.role) || !passwordMatches) return null;
  const regions = await pool.query<{region_id:string}>('SELECT region_id FROM staff_account_regions WHERE staff_id=$1 ORDER BY region_id',[row.id]);
  return {id:row.id,username:row.username,displayName:row.display_name,role:row.role,regionIds:regions.rows.map(r=>r.region_id),credentialVersion:row.credential_version};
}
export async function getActivePrincipal(pool: Database, id: string, version: number): Promise<StaffPrincipal | null> {
  const result=await pool.query<any>('SELECT id,username,display_name,role,credential_version FROM staff_accounts WHERE id=$1 AND active AND credential_version=$2',[id,version]);
  const row=result.rows[0]; if(!row||!isStaffRole(row.role)) return null;
  const regions=await pool.query<{region_id:string}>('SELECT region_id FROM staff_account_regions WHERE staff_id=$1 ORDER BY region_id',[id]);
  if (!regions.rows.length) return null;
  return {id:row.id,username:row.username,displayName:row.display_name,role:row.role,regionIds:regions.rows.map(r=>r.region_id),credentialVersion:row.credential_version};
}
export async function bootstrapFirstAdmin(pool: Pool, username: string, displayName: string, password: string): Promise<void> {
  const normalized=normalizeUsername(username); if(!normalized) throw new Error('Invalid account identifier.');
  const creds=await hashPassword(password); const id=randomUUID();
  const client=await pool.connect();
  try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [STAFF_ADMIN_ADVISORY_LOCK_KEY]);
    const existing=await client.query("SELECT 1 FROM staff_accounts WHERE role='operator_admin' LIMIT 1");
    if(existing.rowCount) throw new Error('Bootstrap refused: an operator administrator already exists.');
    await client.query('INSERT INTO staff_accounts(id,username,display_name,password_salt,password_verifier,role) VALUES($1,$2,$3,$4,$5,\'operator_admin\')',[id,normalized,displayName.trim(),creds.salt,creds.verifier]);
    await client.query("INSERT INTO staff_account_regions(staff_id,region_id) VALUES($1,'local-staging')",[id]);
    await client.query("INSERT INTO staff_admin_audit_events(id,actor_staff_id,target_staff_id,action,details,region_id) VALUES($1,NULL,$2,'bootstrap_first_admin',$3::jsonb,'local-staging')",[randomUUID(),id,JSON.stringify({role:'operator_admin',regionId:'local-staging'})]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
