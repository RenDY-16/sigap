import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createApplication } from '../src/server/app.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { bootstrapFirstAdmin } from '../src/server/identity/staff-repository.ts';

// Synthetic fixtures only. The staging database is never modified by this script.
const url=new URL(process.env.SIGAP_VERIFY_DATABASE_URL??'postgresql://sigap_dev:sigap_local_synthetic_only@127.0.0.1:54329/sigap_staging');
const admin=new pg.Pool({connectionString:url.toString()});
const name=`sigap_workflow_${Date.now()}_${randomBytes(4).toString('hex')}`;
let created=false;let pool:pg.Pool|undefined;let server:ReturnType<typeof createServer>|undefined;let base='';
const password=randomBytes(24).toString('hex');const secret=randomBytes(32).toString('hex');
const config={databaseUrl:'unused',databasePoolMax:12,host:'127.0.0.1',port:0,sessionSecret:secret,lanDemo:false,secureCookies:false,clientDistPath:'/nonexistent'};
const checks:string[]=[];
async function start(){server=createServer(createApplication(config,pool!).app);await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const a=server.address();assert(a&&typeof a!=='string');base=`http://127.0.0.1:${a.port}`;}
async function stop(){if(server){server.closeAllConnections();await new Promise<void>((r,j)=>server!.close(e=>e?j(e):r()));server=undefined;}}
async function call(path:string,method='GET',body?:unknown,cookie?:string,token?:string,key?:string){
 const headers:Record<string,string>={Origin:base};if(body!==undefined)headers['Content-Type']='application/json';if(path.startsWith('/api/staff')&&method!=='GET')headers['X-SIGAP-Request']='staff';if(cookie)headers.Cookie=cookie;if(token)headers.Authorization=`Bearer ${token}`;if(key)headers['Idempotency-Key']=key;
 const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();return {status:response.status,data:text?JSON.parse(text):null,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function expect(path:string,status:number,method='GET',body?:unknown,cookie?:string,token?:string,key?:string){const r=await call(path,method,body,cookie,token,key);assert.equal(r.status,status,`${method} ${path}: ${r.data?.error?.code??'unexpected status'}`);return r;}
async function login(username:string){const r=await expect('/api/staff/session',200,'POST',{username,password});assert(r.cookie);return {cookie:r.cookie,id:r.data.principal.id};}
function privateProjectionAbsent(value:unknown){
 const forbidden=new Set(['accessTokenDigest','idempotencyDigest','createPayloadDigest','staffId','ownerStaffId','previousOwnerId','workflowHistory','unitId','responderId','reason','password_verifier','password_salt']);
 if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assert(!forbidden.has(key),`private key leaked: ${key}`);privateProjectionAbsent(item);}
}
const input={category:'security',categoryId:'security',configVersion:1,description:'Synthetic integration incident only',locationMode:'simulation',initialLocation:{lat:0.1,lng:0.2},fieldAnswers:{}};
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;url.pathname='/'+name;pool=new pg.Pool({connectionString:url.toString(),max:12});await runMigrations(pool);await bootstrapFirstAdmin(pool,'workflow_admin','Synthetic admin',password);await start();
 const root=await login('workflow_admin');
 const accounts:Record<string,{cookie:string;id:string}>={};
 for(const [username,role]of [['dispatch_one','dispatcher'],['dispatch_two','dispatcher'],['workflow_supervisor','supervisor'],['workflow_auditor','auditor'],['foreign_dispatch','dispatcher']]){
  const r=await expect('/api/staff/accounts',201,'POST',{username,displayName:'Synthetic '+role,password,role,regionIds:['local-staging']},root.cookie);
  if(username==='foreign_dispatch'){
   await pool.query("INSERT INTO regions(id,name) VALUES('other-synthetic','Synthetic isolated region')");await pool.query('DELETE FROM staff_account_regions WHERE staff_id=$1',[r.data.id]);await pool.query("INSERT INTO staff_account_regions(staff_id,region_id) VALUES($1,'other-synthetic')",[r.data.id]);
  }
  accounts[username]=await login(username);
 }
 checks.push('admin provisions individual accounts; login cookies usable');
 await expect('/api/staff/incidents',401);const publicConfig=await expect('/api/operations/public-config',200);assert(!('responders'in publicConfig.data));assert(!('sops'in publicConfig.data));checks.push('anonymous staff API denied; public config excludes SOP/roster');
 const token=randomBytes(32).toString('hex');const key=randomBytes(32).toString('hex');const made=await expect('/api/citizen/incidents',201,'POST',input,undefined,token,key);const id=made.data.id;privateProjectionAbsent(made.data);
 const retries=await Promise.all(Array.from({length:6},()=>call('/api/citizen/incidents','POST',input,undefined,token,key)));assert(retries.every(r=>r.status===201&&r.data.id===id));const count=await pool.query('SELECT count(*)::integer AS n FROM incidents');assert.equal(count.rows[0].n,1);checks.push('concurrent idempotent create returns one durable incident');
 await expect('/api/citizen/incidents',409,'POST',{...input,description:'Different synthetic payload'},undefined,token,key);await expect('/api/citizen/incidents',409,'POST',input,undefined,randomBytes(32).toString('hex'),key);await expect('/api/citizen/incidents',404,'GET',undefined,undefined,randomBytes(32).toString('hex'));checks.push('changed payload/credential retry rejected; unknown token cannot read');
 const path=`/api/staff/incidents/${id}`;const op1=accounts.dispatch_one;const op2=accounts.dispatch_two;const auditor=accounts.workflow_auditor;const supervisor=accounts.workflow_supervisor;
 const owned={expectedStatus:'received',expectedOwnerId:null,reason:'Synthetic claim'};
 await expect(path+'/claim',403,'POST',owned,root.cookie);await expect(path+'/claim',403,'POST',owned,auditor.cookie);await expect('/api/staff/accounts',403,'GET',undefined,op1.cookie);await expect(path,200,'GET',undefined,auditor.cookie);checks.push('admin/auditor cannot work incidents; dispatcher cannot administer accounts');
 const foreign=accounts.foreign_dispatch;const empty=await expect('/api/staff/incidents',200,'GET',undefined,foreign.cookie);assert.equal(empty.data.items.length,0);await expect(path,404,'GET',undefined,foreign.cookie);checks.push('foreign-region session cannot list/read local incidents');
 const race=await Promise.all([call(path+'/claim','POST',owned,op1.cookie),call(path+'/claim','POST',owned,op2.cookie)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);let detail=race.find(r=>r.status===200)!.data;let worker=detail.ownerStaffId===op1.id?op1:op2;const loser=worker.id===op1.id?op2:op1;checks.push('competing claims yield one owner and one conflict');
 const action=(expectedStatus=detail.status)=>({expectedStatus,sopId:'security-staging',sopVersion:1,reason:'Synthetic internal reason'});
 await expect(path+'/status',409,'PATCH',{...action(),status:'resolved'},worker.cookie);await expect(path+'/status',409,'PATCH',{...action(),status:'acknowledged'},loser.cookie);detail=(await expect(path+'/status',200,'PATCH',{...action(),status:'acknowledged'},worker.cookie)).data;await expect(path+'/status',409,'PATCH',{...action('received'),status:'triaged'},worker.cookie);checks.push('invalid transition, wrong owner and stale expected status rejected');
 const cfg=(await expect('/api/staff/operations/config',200,'GET',undefined,root.cookie)).data;
 const configuration={timezone:cfg.timezone,serviceHours:cfg.serviceHours,publicFallback:cfg.publicFallback,categories:cfg.categories.map((c:any)=>({...c,requiredFields:[...c.requiredFields,{key:'confirmed',label:'Synthetic confirmation',type:'boolean',required:true}]})),sops:cfg.sops,responders:cfg.responders};
 const changed=await expect('/api/staff/operations/config',200,'PUT',{expectedVersion:1,configuration},root.cookie);assert.equal(changed.data.version,2);await expect('/api/staff/operations/config',409,'PUT',{expectedVersion:1,configuration},root.cookie);await expect('/api/citizen/incidents',409,'POST',input,undefined,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'));await expect('/api/citizen/incidents',400,'POST',{...input,configVersion:2},undefined,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'));checks.push('config update versioned; stale config rejected; required field enforced');
 detail=(await expect(path+'/status',200,'PATCH',{...action(),status:'triaged'},worker.cookie)).data;assert.equal(detail.configVersion,1);await expect(path+'/assignment',409,'PATCH',{...action(),sopVersion:999,unitId:'unit-01'},worker.cookie);detail=(await expect(path+'/assignment',200,'PATCH',{...action(),unitId:'unit-01'},worker.cookie)).data;assert.equal(detail.status,'assigned');assert.equal(detail.assignment.externalDispatchAcknowledged,false);assert.equal(detail.assignment.configVersion,2);checks.push('old incident keeps pinned SOP; assignment is versioned internal selection only');
 await expect(path+'/takeover',403,'POST',{expectedStatus:detail.status,expectedOwnerId:worker.id,reason:'Synthetic takeover'},loser.cookie);detail=(await expect(path+'/takeover',200,'POST',{expectedStatus:detail.status,expectedOwnerId:worker.id,reason:'Synthetic takeover'},supervisor.cookie)).data;worker=supervisor;assert.equal(detail.ownerStaffId,worker.id);assert(detail.workflowHistory.some((e:any)=>e.action==='takeover'&&e.staffId===supervisor.id));detail=(await expect(path+'/status',200,'PATCH',{...action(),status:'in_progress'},worker.cookie)).data;checks.push('supervisor takeover authorized and audited');
 await expect('/api/citizen/incidents/location',200,'PUT',{lat:0.3,lng:0.4},undefined,token);const withdrawal=await expect('/api/citizen/incidents/withdrawal',200,'POST',undefined,undefined,token);const repeat=await expect('/api/citizen/incidents/withdrawal',200,'POST',undefined,undefined,token);assert.equal(repeat.data.withdrawalRequestedAt,withdrawal.data.withdrawalRequestedAt);await expect('/api/citizen/incidents/location',409,'PUT',{lat:0.5,lng:0.6},undefined,token);await expect(path+'/status',409,'PATCH',{...action(),status:'resolved'},worker.cookie);checks.push('withdrawal retry stable; pending request stops location and blocks closure');
 detail=(await expect(path+'/withdrawal-decision',200,'POST',{...action(),outcome:'denied'},worker.cookie)).data;assert.equal(detail.withdrawalDecision.trackingStopped,true);await expect('/api/citizen/incidents/location',409,'PUT',{lat:0.5,lng:0.6},undefined,token);detail=(await expect(path+'/status',200,'PATCH',{...action(),status:'resolved'},worker.cookie)).data;await expect(path+'/status',409,'PATCH',{...action(),status:'in_progress'},worker.cookie);checks.push('withdrawal denial does not restart tracking; resolved is terminal');
 const citizen=(await expect('/api/citizen/incidents',200,'GET',undefined,undefined,token)).data;assert.equal(citizen.status,'resolved');privateProjectionAbsent(citizen);assert(citizen.statusHistory.every((e:any)=>['staff','citizen','system'].includes(e.actor)));assert(!('label'in citizen.assignment));assert(!JSON.stringify(citizen).includes('Synthetic internal reason'));
 const outbox=await pool.query('SELECT payload FROM outbox_events');assert(outbox.rowCount!>0);for(const r of outbox.rows){privateProjectionAbsent(r.payload);const report=r.payload.incident;assert(report.statusHistory.every((e:any)=>['staff','citizen','system'].includes(e.actor)));if(report.assignment)assert(!('label'in report.assignment));assert(!JSON.stringify(r.payload).includes(token));}checks.push('public report and durable outbox redact ownership, staff IDs, reasons and responder identity');
 const audit=(await expect('/api/staff/audit/incidents',200,'GET',undefined,root.cookie)).data;assert(audit.some((e:any)=>e.incident_id===id&&e.event==='incident:ownership:takeover'&&e.staff_id===supervisor.id));await expect('/api/staff/audit/incidents',403,'GET',undefined,op1.cookie);checks.push('audit accessible to authorized role only');
 const token2=randomBytes(32).toString('hex');const additional={...input,configVersion:2,fieldAnswers:{confirmed:true}};
 const second=(await expect('/api/citizen/incidents',201,'POST',additional,undefined,token2,randomBytes(32).toString('hex'))).data;
 const secondPath=`/api/staff/incidents/${second.id}`;
 let secondDetail=(await expect(secondPath+'/claim',200,'POST',{expectedStatus:'received',expectedOwnerId:null,reason:'Synthetic claim'},op1.cookie)).data;
 secondDetail=(await expect(secondPath+'/release',200,'POST',{expectedStatus:'received',expectedOwnerId:op1.id,reason:'Synthetic release'},op1.cookie)).data;assert.equal(secondDetail.ownerStaffId,null);
 secondDetail=(await expect(secondPath+'/claim',200,'POST',{expectedStatus:'received',expectedOwnerId:null,reason:'Synthetic claim'},op2.cookie)).data;checks.push('release permits another operator to claim');
 const secondAction=()=>({expectedStatus:secondDetail.status,sopId:'security-staging',sopVersion:1,reason:'Synthetic escalation reason'});
 for(const status of ['acknowledged','triaged'])secondDetail=(await expect(secondPath+'/status',200,'PATCH',{...secondAction(),status},op2.cookie)).data;
 secondDetail=(await expect(secondPath+'/assignment',200,'PATCH',{...secondAction(),unitId:'unit-02'},op2.cookie)).data;
 secondDetail=(await expect(secondPath+'/status',200,'PATCH',{...secondAction(),status:'delivery_failed'},op2.cookie)).data;
 await expect(secondPath+'/status',403,'PATCH',{...secondAction(),status:'escalation_pending'},op2.cookie);
 secondDetail=(await expect(secondPath+'/takeover',200,'POST',{expectedStatus:secondDetail.status,expectedOwnerId:op2.id,reason:'Synthetic escalation takeover'},supervisor.cookie)).data;
 secondDetail=(await expect(secondPath+'/status',200,'PATCH',{...secondAction(),status:'escalation_pending'},supervisor.cookie)).data;
 const busyConfiguration={...configuration,responders:configuration.responders.map((r:any)=>({...r,availability:r.id==='unit-02'?'busy':r.availability}))};
 await expect('/api/staff/operations/config',200,'PUT',{expectedVersion:2,configuration:busyConfiguration},root.cookie);
 await expect(secondPath+'/assignment',409,'PATCH',{...secondAction(),unitId:'unit-02'},supervisor.cookie);
 secondDetail=(await expect(secondPath+'/assignment',200,'PATCH',{...secondAction(),unitId:'unit-01'},supervisor.cookie)).data;assert.equal(secondDetail.assignment.configVersion,3);
 secondDetail=(await expect(secondPath+'/status',200,'PATCH',{...secondAction(),status:'referred'},supervisor.cookie)).data;
 await expect(secondPath+'/status',409,'PATCH',{...secondAction(),status:'in_progress'},supervisor.cookie);
 checks.push('delivery failure escalates only via supervisor; busy responder rejected; referral terminal');
 const token3=randomBytes(32).toString('hex');const third=(await expect('/api/citizen/incidents',201,'POST',{...additional,configVersion:3},undefined,token3,randomBytes(32).toString('hex'))).data;
 const thirdPath=`/api/staff/incidents/${third.id}`;await expect(thirdPath+'/claim',200,'POST',{expectedStatus:'received',expectedOwnerId:null,reason:'Synthetic claim'},op1.cookie);
 await expect('/api/citizen/incidents/withdrawal',200,'POST',undefined,undefined,token3);
 const pending=(await expect('/api/staff/incidents?withdrawalPending=true',200,'GET',undefined,op1.cookie)).data;assert.equal(pending.items.length,1);assert.equal(pending.items[0].id,third.id);
 const accepted=(await expect(thirdPath+'/withdrawal-decision',200,'POST',{expectedStatus:'received',sopId:'security-staging',sopVersion:1,reason:'Synthetic acceptance',outcome:'accepted'},op1.cookie)).data;
 assert.equal(accepted.withdrawalDecision.outcome,'accepted');assert.equal(accepted.withdrawalDecision.trackingStopped,true);await expect('/api/citizen/incidents/location',409,'PUT',{lat:0.7,lng:0.8},undefined,token3);
 const noPending=(await expect('/api/staff/incidents?withdrawalPending=true',200,'GET',undefined,op1.cookie)).data;assert.equal(noPending.items.length,0);checks.push('pending withdrawal filter and acceptance work; tracking remains stopped');
 let cursor:string|null=null;const seen=new Set<string>();do{const result=(await expect('/api/staff/incidents?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''),200,'GET',undefined,root.cookie)).data;assert.equal(result.items.length,1);assert(!seen.has(result.items[0].id));seen.add(result.items[0].id);cursor=result.nextCursor;}while(cursor);assert.equal(seen.size,3);
 const received=(await expect('/api/staff/incidents?statuses=received&owner=me',200,'GET',undefined,op1.cookie)).data;assert.equal(received.items.length,1);assert.equal(received.items[0].id,third.id);checks.push('cursor pagination has no repeats; status and owner filters agree');
 await expect('/api/staff/incidents?limit=0',400,'GET',undefined,root.cookie);await expect('/api/staff/incidents?minAgeMinutes=10&maxAgeMinutes=1',400,'GET',undefined,root.cookie);checks.push('invalid pagination and age filters rejected');
 await expect(`/api/staff/accounts/${root.id}/active`,409,'PATCH',{active:false},root.cookie);checks.push('last active operator admin cannot be disabled');
 await stop();await pool.end();pool=new pg.Pool({connectionString:url.toString(),max:12});await start();assert.equal((await expect('/api/citizen/incidents',200,'GET',undefined,undefined,token)).data.status,'resolved');await expect(path,200,'GET',undefined,worker.cookie);checks.push('app and pool recreation preserve report, workflow and staff session');
 await expect(`/api/staff/accounts/${worker.id}/active`,200,'PATCH',{active:false},root.cookie);await expect('/api/staff/incidents',401,'GET',undefined,worker.cookie);checks.push('disabling account invalidates existing HTTP session');
 console.log(JSON.stringify({status:'passed',scope:'real HTTP + PostgreSQL synthetic workflow; no browser/socket delivery/provider verification',checks},null,2));
}finally{await stop();if(pool)await pool.end();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}await admin.end();}
