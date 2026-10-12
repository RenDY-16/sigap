import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { ApiError } from '../errors.js';
import { DISPATCH_STATUSES, type DispatchStatus } from '../../shared/dispatch.js';
import { createDispatchIntent, getDispatchIntent, listDispatchIntents, reviewDispatchIntent, type DispatchCursor } from '../dispatch/postgres-dispatch-repository.js';
import type { StaffAccess } from '../identity/staff-policy.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function access(r:Request):StaffAccess{if(!r.staffPrincipal||!r.sessionID)throw new ApiError(401,'staff_session_required','Sesi staf aktif diperlukan.');return {principal:r.staffPrincipal,sessionId:r.sessionID};}
function query(v:unknown):string|undefined{if(v===undefined)return undefined;if(typeof v!=='string'||v.length>512)throw new ApiError(400,'invalid_dispatch_query','Parameter antrean harus berupa satu nilai terbatas.');return v;}
function cursor(raw:string|undefined,status:DispatchStatus|null):DispatchCursor|undefined{
 if(raw===undefined)return undefined;
 try{const bytes=Buffer.from(raw,'base64url');if(bytes.toString('base64url')!==raw)throw new Error();const v=JSON.parse(bytes.toString('utf8'));
  if(!v||Object.keys(v).sort().join()!=='id,status,time'||v.status!==status||typeof v.id!=='string'||!uuid.test(v.id)||typeof v.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v.time)||Number(v.time.slice(0,4))<1||new Date(v.time).toISOString()!==v.time.slice(0,23)+'Z')throw new Error();return v;
 }catch{throw new ApiError(400,'invalid_dispatch_cursor','Cursor pengiriman tidak valid; muat halaman pertama.');}
}
export function createStaffDispatchRouter(pool:Pool):ReturnType<typeof Router>{
 const router=Router();
 router.post('/incidents/:id/dispatch',async(r,res)=>{
  const caller=access(r);if(!r.body||typeof r.body!=='object'||Array.isArray(r.body)||Object.keys(r.body).join()!=='scenario')throw new ApiError(400,'invalid_dispatch_input','Isi hanya skenario pengiriman lokal.');
  const id=String(r.params.id);if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new ApiError(400,'invalid_incident_id','ID laporan tidak valid.');
  const result=await createDispatchIntent(pool,caller,id,r.get('Idempotency-Key'),r.body.scenario);res.status(result.created?201:200).json(result.intent);
 });
 router.get('/dispatch',async(r,res)=>{
  const caller=access(r),raw=query(r.query.status);if(raw!==undefined&&!DISPATCH_STATUSES.includes(raw as DispatchStatus))throw new ApiError(400,'invalid_dispatch_status','Status pengiriman tidak dikenal.');
  const status=(raw??null) as DispatchStatus|null,limit=Number(query(r.query.limit)??50);if(!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(400,'invalid_dispatch_limit','Ukuran halaman harus 1–100.');
  res.json(await listDispatchIntents(pool,caller,{status,limit,cursor:cursor(query(r.query.cursor),status)}));
 });
 router.get('/dispatch/:id',async(r,res)=>{const caller=access(r),id=String(r.params.id);if(!uuid.test(id))throw new ApiError(400,'invalid_dispatch_id','ID pengiriman tidak valid.');res.json(await getDispatchIntent(pool,caller,id));});
 router.post('/dispatch/:id/review',async(r,res)=>{
  const caller=access(r),id=String(r.params.id);if(!uuid.test(id))throw new ApiError(400,'invalid_dispatch_id','ID pengiriman tidak valid.');
  if(!r.body||typeof r.body!=='object'||Array.isArray(r.body)||Object.keys(r.body).sort().join()!=='action,reason')throw new ApiError(400,'invalid_dispatch_review','Isi aksi dan alasan review.');
  const result=await reviewDispatchIntent(pool,caller,id,r.body.action,r.body.reason,r.get('Idempotency-Key'));res.status(result.created?201:200).json(result.intent);
 });
 return router;
}
