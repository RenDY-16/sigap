import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../errors.js';
import { lockStaffAccess, requireStaffCapability, type StaffAccess, type StaffCapability } from '../identity/staff-policy.js';
import { STAFF_ADMIN_ADVISORY_LOCK_KEY, type StaffPrincipal } from '../identity/staff-repository.js';
import { DISPATCH_SCENARIOS, type DispatchScenario, type DispatchIntent, type DispatchDetail, type DispatchStatus, type DispatchPage } from '../../shared/dispatch.js';
type Row = {id:string;incident_id:string;region_id:string;status:DispatchStatus;scenario:DispatchScenario;attempt_count:number;next_attempt_at:Date|null;replay_of:string|null;reviewed_at:Date|null;reviewed_by_staff_id:string|null;review_reason:string|null;created_at:Date;updated_at:Date;cursor_time:string;payload_digest:string};
function project(r:Row):DispatchIntent{return {id:r.id,incidentId:r.incident_id,regionId:r.region_id,status:r.status,scenario:r.scenario,attemptCount:r.attempt_count,nextAttemptAt:r.next_attempt_at?.toISOString()??null,replayOf:r.replay_of,reviewedAt:r.reviewed_at?.toISOString()??null,createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString(),simulated:true};}
async function transaction<T>(pool:Pool,access:StaffAccess,work:(client:PoolClient,p:StaffPrincipal)=>Promise<T>,capability:StaffCapability='work_incidents'):Promise<T>{
 requireStaffCapability(access.principal,capability);const client=await pool.connect();
 try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)',[STAFF_ADMIN_ADVISORY_LOCK_KEY]);const p=await lockStaffAccess(client,access,capability);const result=await work(client,p);await client.query('COMMIT');return result;}
 catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}
const columns=`d.*,to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time`;
const visibility=`d.region_id=ANY($1::text[]) AND ($2::boolean OR i.owner_staff_id=$3)`;
export async function createDispatchIntent(pool:Pool,access:StaffAccess,incidentId:string,key:unknown,scenario:unknown):Promise<{intent:DispatchIntent;created:boolean}>{
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(key))throw new ApiError(400,'invalid_dispatch_key','Gunakan Idempotency-Key yang valid untuk retry pengiriman.');
 if(typeof scenario!=='string'||!DISPATCH_SCENARIOS.includes(scenario as DispatchScenario))throw new ApiError(400,'invalid_dispatch_scenario','Pilih skenario pengiriman lokal yang tersedia.');
 const digest=createHash('sha256').update('dispatch:v1:'+key).digest('hex');
 const payload=createHash('sha256').update(JSON.stringify({incidentId,scenario,adapter:'local-mock',version:1,target:'local-staging-mock'})).digest('hex');
 return transaction(pool,access,async(client,p)=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sigap-dispatch:'+digest]);
  const incident=(await client.query(`SELECT id,region_id,owner_staff_id,status,withdrawal_requested_at,withdrawal_outcome FROM incidents WHERE id=$1 AND region_id=ANY($2::text[]) FOR UPDATE`,[incidentId,p.regionIds])).rows[0];
  if(!incident)throw new ApiError(404,'incident_not_found','Laporan tidak tersedia.');
  if(incident.owner_staff_id!==p.id)throw new ApiError(409,'dispatch_owner_required','Klaim laporan sebelum membuat pengiriman.');
  const old=(await client.query<Row>('SELECT * FROM dispatch_intents WHERE idempotency_digest=$1',[digest])).rows[0];
  if(old){if(old.payload_digest!==payload)throw new ApiError(409,'dispatch_idempotency_conflict','Key pengiriman sudah digunakan untuk payload berbeda.');return {intent:project(old),created:false};}
  if(!['triaged','assigned','in_progress'].includes(incident.status)||(incident.withdrawal_requested_at&&incident.withdrawal_outcome!=='denied'))throw new ApiError(409,'dispatch_incident_ineligible','Status laporan atau permintaan penghentian belum mengizinkan pengiriman.');
  const r=(await client.query<Row>(`INSERT INTO dispatch_intents(id,incident_id,region_id,created_by_staff_id,idempotency_digest,payload_digest,correlation_id,scenario) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[randomUUID(),incidentId,incident.region_id,p.id,digest,payload,randomUUID(),scenario])).rows[0];
  await client.query(`INSERT INTO audit_events(id,incident_id,event,actor_kind,staff_id,details) VALUES($1,$2,'dispatch:intent:created','staff',$3,$4::jsonb)`,[randomUUID(),incidentId,p.id,JSON.stringify({intentId:r.id,status:'queued',simulated:true})]);
  return {intent:project(r),created:true};
 });
}
export interface DispatchCursor{time:string;id:string;status:DispatchStatus|null}
export async function listDispatchIntents(pool:Pool,access:StaffAccess,f:{status:DispatchStatus|null;limit:number;cursor?:DispatchCursor}):Promise<DispatchPage>{
 return transaction(pool,access,async(client,p)=>{
  const rows=(await client.query<Row>(`SELECT ${columns} FROM dispatch_intents d JOIN incidents i ON i.id=d.incident_id WHERE ${visibility} AND ($4::text IS NULL OR d.status=$4) AND ($5::timestamptz IS NULL OR (d.created_at,d.id)<($5::timestamptz,$6::uuid)) ORDER BY d.created_at DESC,d.id DESC LIMIT $7 FOR SHARE OF d,i`,[p.regionIds,p.role==='supervisor',p.id,f.status,f.cursor?.time??null,f.cursor?.id??null,f.limit+1])).rows;
  const items=rows.slice(0,f.limit),last=items.at(-1);return {items:items.map(project),nextCursor:rows.length>f.limit&&last?Buffer.from(JSON.stringify({time:last.cursor_time,id:last.id,status:f.status})).toString('base64url'):null};
 });
}
export async function getDispatchIntent(pool:Pool,access:StaffAccess,id:string):Promise<DispatchDetail>{
 return transaction(pool,access,async(client,p)=>{
  const r=(await client.query<Row>(`SELECT ${columns} FROM dispatch_intents d JOIN incidents i ON i.id=d.incident_id WHERE ${visibility} AND d.id=$4 FOR SHARE OF d,i`,[p.regionIds,p.role==='supervisor',p.id,id])).rows[0];
  if(!r)throw new ApiError(404,'dispatch_not_found','Pengiriman tidak tersedia.');
  const attempts=(await client.query('SELECT attempt_number,started_at,finished_at,result FROM dispatch_attempts WHERE intent_id=$1 ORDER BY attempt_number',[id])).rows;
  const acks=(await client.query('SELECT attempt_number,acknowledgement,source,recorded_at FROM dispatch_acknowledgements WHERE intent_id=$1 ORDER BY recorded_at,id',[id])).rows;
  return {...project(r),attempts:attempts.map(a=>({attemptNumber:a.attempt_number,startedAt:a.started_at.toISOString(),finishedAt:a.finished_at?.toISOString()??null,result:a.result,simulated:true})),acknowledgements:acks.map(a=>({attemptNumber:a.attempt_number,acknowledgement:a.acknowledgement,source:a.source,recordedAt:a.recorded_at.toISOString(),simulated:true}))};
 });
}

/** Review never manufactures delivery evidence. Replay is a separate linked intent. */
export async function reviewDispatchIntent(pool:Pool,access:StaffAccess,id:string,action:unknown,rawReason:unknown,key:unknown):Promise<{intent:DispatchIntent;created:boolean}>{
 if(action!=='close'&&action!=='replay')throw new ApiError(400,'invalid_dispatch_review','Pilih tutup review atau replay yang tersedia.');
 if(typeof rawReason!=='string'||!rawReason.trim()||rawReason.trim().length>500)throw new ApiError(400,'dispatch_review_reason_required','Isi alasan review 1–500 karakter.');
 const reason=rawReason.trim();
 if(action==='replay'&&(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(key)))throw new ApiError(400,'invalid_dispatch_key','Replay memerlukan Idempotency-Key yang valid.');
 const digest=action==='replay'?createHash('sha256').update('dispatch:v1:'+String(key)).digest('hex'):null;
 return transaction(pool,access,async(client,p)=>{
  if(digest)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sigap-dispatch:'+digest]);
  const r=(await client.query<Row&{incident_status:string;withdrawal_requested_at:Date|null;withdrawal_outcome:string|null}>(`SELECT d.*,i.status AS incident_status,i.withdrawal_requested_at,i.withdrawal_outcome FROM dispatch_intents d JOIN incidents i ON i.id=d.incident_id WHERE d.id=$1 AND d.region_id=ANY($2::text[]) FOR UPDATE OF d,i`,[id,p.regionIds])).rows[0];
  if(!r)throw new ApiError(404,'dispatch_not_found','Pengiriman tidak tersedia.');
  if(action==='close'){
   if(r.status==='cancelled'&&r.reviewed_by_staff_id===p.id&&r.review_reason===reason)return {intent:project(r),created:false};
   if(!['unknown','manual_review'].includes(r.status)||r.reviewed_at)throw new ApiError(409,'dispatch_review_conflict','Item sudah berubah atau tidak memerlukan penutupan review.');
   const updated=(await client.query<Row>(`UPDATE dispatch_intents SET status='cancelled',reviewed_by_staff_id=$2,reviewed_at=statement_timestamp(),review_reason=$3,updated_at=statement_timestamp() WHERE id=$1 RETURNING *`,[id,p.id,reason])).rows[0];
   await client.query(`INSERT INTO audit_events(id,incident_id,event,actor_kind,staff_id,details) VALUES($1,$2,'dispatch:reviewed','staff',$3,$4::jsonb)`,[randomUUID(),r.incident_id,p.id,JSON.stringify({intentId:id,action,reason,status:'cancelled',simulated:true})]);
   return {intent:project(updated),created:false};
  }
  const payload=createHash('sha256').update(JSON.stringify({replayOf:id,incidentId:r.incident_id,scenario:r.scenario,reason,adapter:'local-mock',version:1,target:'local-staging-mock'})).digest('hex');
  const old=(await client.query<Row>('SELECT * FROM dispatch_intents WHERE idempotency_digest=$1',[digest])).rows[0];
  if(old){if(old.payload_digest!==payload||old.replay_of!==id)throw new ApiError(409,'dispatch_idempotency_conflict','Key replay sudah digunakan untuk payload berbeda.');return {intent:project(old),created:false};}
  if(r.status!=='dead_letter'||r.reviewed_at)throw new ApiError(409,'dispatch_replay_conflict','Replay hanya tersedia untuk retry yang habis dan belum direview. Hasil tidak pasti tidak boleh dikirim ulang.');
  if(!['triaged','assigned','in_progress'].includes(r.incident_status)||(r.withdrawal_requested_at&&r.withdrawal_outcome!=='denied'))throw new ApiError(409,'dispatch_incident_ineligible','Laporan belum mengizinkan replay.');
  const linked=(await client.query<Row>(`INSERT INTO dispatch_intents(id,incident_id,region_id,created_by_staff_id,idempotency_digest,payload_digest,correlation_id,scenario,replay_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[randomUUID(),r.incident_id,r.region_id,p.id,digest,payload,randomUUID(),r.scenario,id])).rows[0];
  await client.query('UPDATE dispatch_intents SET reviewed_by_staff_id=$2,reviewed_at=statement_timestamp(),review_reason=$3,updated_at=statement_timestamp() WHERE id=$1',[id,p.id,reason]);
  await client.query(`INSERT INTO audit_events(id,incident_id,event,actor_kind,staff_id,details) VALUES($1,$2,'dispatch:intent:created','staff',$3,$4::jsonb)`,[randomUUID(),r.incident_id,p.id,JSON.stringify({intentId:linked.id,replayOf:id,status:'queued',simulated:true})]);
  await client.query(`INSERT INTO audit_events(id,incident_id,event,actor_kind,staff_id,details) VALUES($1,$2,'dispatch:reviewed','staff',$3,$4::jsonb)`,[randomUUID(),r.incident_id,p.id,JSON.stringify({intentId:id,replayIntentId:linked.id,action,reason,simulated:true})]);
  return {intent:project(linked),created:true};
 },'manage_escalations');
}
