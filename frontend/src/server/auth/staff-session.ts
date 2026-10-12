import { ApiError } from '../errors.js';
import { createHash } from 'node:crypto';
import session from 'express-session';
import type { Request, RequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { ServerConfig } from '../config.js';
import { getActivePrincipal, type StaffPrincipal } from '../identity/staff-repository.js';
const digest=(sid:string)=>createHash('sha256').update(sid).digest('hex');
type Database = Pool | PoolClient;
declare module 'express-session' { interface SessionData { staffPrincipalId?:string; staffCredentialVersion?:number } }
declare global { namespace Express { interface Request { staffPrincipal?:StaffPrincipal } } }
class PostgresSessionStore extends session.Store {
 constructor(private pool:Pool){super();}
 get(sid:string,cb:(err:any,data?:session.SessionData|null)=>void):void {
   void this.pool.query<{session_data:session.SessionData}>('SELECT session_data FROM staff_sessions WHERE sid_hash=$1 AND revoked_at IS NULL AND expires_at>now()',[digest(sid)]).then(r=>cb(null,r.rows[0]?.session_data??null),e=>cb(e));
 }
 set(sid:string,data:session.SessionData,cb?:(err?:any)=>void):void {
   // Expiry is captured only on first insert. ON CONFLICT never changes it and cannot clear a revocation tombstone.
   const expires=data.cookie?.expires?new Date(data.cookie.expires):new Date(Date.now()+8*3600_000);
   if(!Number.isFinite(expires.getTime())||expires<=new Date()){this.destroy(sid,cb);return;}
   void this.pool.query(`INSERT INTO staff_sessions(sid_hash,session_data,principal_id,credential_version,expires_at) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(sid_hash) DO UPDATE SET session_data=EXCLUDED.session_data, principal_id=EXCLUDED.principal_id, credential_version=EXCLUDED.credential_version
     WHERE staff_sessions.revoked_at IS NULL AND staff_sessions.expires_at>now()`,[digest(sid),JSON.stringify(data),data.staffPrincipalId??null,data.staffCredentialVersion??null,expires]).then(()=>cb?.(),e=>cb?.(e));
 }
 destroy(sid:string,cb?:(err?:any)=>void):void {
   // Keep a tombstone so an in-flight stale set cannot recreate a revoked session.
   void this.pool.query(`INSERT INTO staff_sessions(sid_hash,session_data,expires_at,revoked_at) VALUES($1,'{}'::jsonb,now(),now())
     ON CONFLICT(sid_hash) DO UPDATE SET session_data='{}'::jsonb, principal_id=NULL, credential_version=NULL, revoked_at=COALESCE(staff_sessions.revoked_at,now()), generation=staff_sessions.generation+1`,[digest(sid)]).then(()=>cb?.(),e=>cb?.(e));
 }
 touch(_sid:string,_data:session.SessionData,cb?:(err?:any)=>void):void {
   // Deliberately no-op: cookie/session touches must never move the absolute expiry or revive a tombstone.
   cb?.();
 }
}
export interface StaffSessionManager {
 middleware:RequestHandler;
 principal(request:Request, executor?:Database):Promise<StaffPrincipal|null>;
 resolvePrincipalForSession(sessionId:string, executor?:Database):Promise<StaffPrincipal|null>;
 isSessionActive(sessionId:string, executor?:Database):Promise<boolean>;
 regenerate(request:Request):Promise<void>; save(request:Request):Promise<void>; destroy(request:Request):Promise<void>;
}
export function createStaffSession(config:ServerConfig,pool:Pool):StaffSessionManager {
 const store=new PostgresSessionStore(pool); const base=session({name:'sigap.sid',secret:config.sessionSecret,store,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:config.secureCookies,maxAge:8*3600_000}});
 const resolvePrincipalForSession=async(sid:string,executor:Database=pool):Promise<StaffPrincipal|null>=>{
   const result=await executor.query<{principal_id:string|null;credential_version:number|null}>('SELECT principal_id,credential_version FROM staff_sessions WHERE sid_hash=$1 AND revoked_at IS NULL AND expires_at>now()',[digest(sid)]);
   const row=result.rows[0]; if(!row?.principal_id||!Number.isInteger(row.credential_version))return null;
   return getActivePrincipal(executor,row.principal_id,row.credential_version as number);
 };
 const authenticationUnavailable=()=>new ApiError(503,'staff_authentication_unavailable','Verifikasi sesi sementara tidak tersedia. Silakan coba lagi; gangguan ini belum berarti sesi Anda berakhir.');
 const middleware:RequestHandler=(req,res,next)=>base(req,res,error=>{
   if(error){next(authenticationUnavailable());return;}
   void (async()=>{const sid=req.sessionID;if(sid)req.staffPrincipal=await resolvePrincipalForSession(sid)??undefined;})()
     .then(()=>next(),()=>next(authenticationUnavailable()));
 });
 return {middleware,
   principal:async(req,executor=pool)=>req.sessionID?resolvePrincipalForSession(req.sessionID,executor):null,
   resolvePrincipalForSession,
   isSessionActive:async(sid,executor=pool)=>{try{return Boolean(await resolvePrincipalForSession(sid,executor));}catch{return false;}},
   regenerate:req=>new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve())),
   save:req=>new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve())),
   destroy:req=>new Promise((resolve,reject)=>req.session.destroy(e=>e?reject(e):resolve()))};
}
