import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { createApplication } from '../src/server/app.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { bootstrapFirstAdmin } from '../src/server/identity/staff-repository.ts';
import { createLoginThrottle } from '../src/server/security/login-throttle.ts';
// Creates/drops only its own uniquely named synthetic database.
const url=new URL(process.env.SIGAP_VERIFY_DATABASE_URL ?? 'postgresql://sigap_dev:sigap_local_synthetic_only@127.0.0.1:54329/sigap_staging');
const admin=new pg.Pool({connectionString:url.toString()});
const database=`sigap_verify_${Date.now()}_${randomBytes(4).toString('hex')}`;
let created=false;let pool:pg.Pool|undefined;let server:ReturnType<typeof createServer>|undefined;
const checks:string[]=[];const secret=randomBytes(32).toString('hex');const password=randomBytes(24).toString('hex');
const config={databaseUrl:'unused',databasePoolMax:12,host:'127.0.0.1',port:0,sessionSecret:secret,lanDemo:false,secureCookies:false,clientDistPath:'/nonexistent'};
async function start(){const runtime=createApplication(config,pool!);server=createServer(runtime.app);await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const a=server.address();assert(a&&typeof a!=='string');return `http://127.0.0.1:${a.port}`;}
async function stop(){if(server){server.closeAllConnections();await new Promise<void>((r,j)=>server!.close(e=>e?j(e):r()));server=undefined;}}
async function login(base:string,username:string,pass='wrong-synthetic-password'){const response=await fetch(base+'/api/staff/session',{method:'POST',headers:{'X-SIGAP-Request':'staff','Content-Type':'application/json',Origin:base},body:JSON.stringify({username,password:pass})});return {response,body:await response.json()};}
try{
 await admin.query(`CREATE DATABASE "${database}"`);created=true;url.pathname='/'+database;pool=new pg.Pool({connectionString:url.toString(),max:12});
 await runMigrations(pool);await bootstrapFirstAdmin(pool,'verify_admin','Synthetic verification admin',password);let base=await start();
 for(let i=0;i<5;i++){const r=await login(base,'not_registered');assert.equal(r.response.status,401);assert.equal(r.body.error.code,'invalid_credentials');}
 const blocked=await login(base,'not_registered');assert.equal(blocked.response.status,429,'sixth attempt must be throttled');assert.equal(blocked.body.error.code,'login_throttled');assert(Number(blocked.response.headers.get('Retry-After'))>0);
 checks.push('five attempts allowed; sixth blocked with generic response and Retry-After');
 const rows=await pool.query('SELECT bucket_key,attempts,expires_at FROM staff_login_throttle');assert.equal(rows.rowCount,3);assert(rows.rows.every(r=>/^[0-9a-f]{64}$/.test(r.bucket_key)));checks.push('only digests stored');
 const expiryBefore=rows.rows.map(r=>[r.bucket_key,new Date(r.expires_at).toISOString()]).sort();
 await stop();base=await start();assert.equal((await login(base,'not_registered')).response.status,429);checks.push('app recreation retains counters');
 const expiryAfter=await pool.query('SELECT bucket_key,expires_at FROM staff_login_throttle');assert.deepEqual(expiryAfter.rows.map(r=>[r.bucket_key,new Date(r.expires_at).toISOString()]).sort(),expiryBefore);checks.push('blocked attempts do not extend windows');
 await pool.query("UPDATE staff_login_throttle SET expires_at=clock_timestamp()-interval '1 second'");assert.equal((await login(base,'not_registered')).response.status,401);checks.push('expired windows reset');
 await pool.query('TRUNCATE staff_login_throttle');const concurrent=await Promise.all(Array.from({length:20},()=>login(base,'concurrent_missing')));assert.equal(concurrent.filter(r=>r.response.status===401).length,5);assert.equal(concurrent.filter(r=>r.response.status===429).length,15);checks.push('20 concurrent attempts reserve exactly five checks');
 await pool.query('TRUNCATE staff_login_throttle');for(let i=0;i<30;i++)assert.equal((await login(base,`missing_${i}`)).response.status,401);assert.equal((await login(base,'another_missing')).response.status,429);checks.push('source cap limits username rotation');
 await pool.query('TRUNCATE staff_login_throttle');for(let i=0;i<5;i++)assert.equal((await login(base,i%2?'VERIFY_ADMIN':'verify_admin')).response.status,401);assert.equal((await login(base,' verify_admin ',password)).response.status,429);checks.push('normalized usernames share counters; valid credentials do not bypass limit');
 await pool.query("UPDATE staff_login_throttle SET expires_at=clock_timestamp()-interval '1 second'");const valid=await login(base,'verify_admin',password);assert.equal(valid.response.status,200);assert.equal(valid.body.principal.role,'operator_admin');const cookie=valid.response.headers.get('set-cookie')?.split(';')[0];assert(cookie);const accounts=await fetch(base+'/api/staff/accounts',{headers:{cookie}});assert.equal(accounts.status,200);await accounts.text();checks.push('valid login creates usable session after expiry');
 await pool.query('TRUNCATE staff_login_throttle');
 const reserve=createLoginThrottle(pool,secret);for(let i=0;i<30;i++)assert.equal((await reserve(`synthetic-source-${i}`,'distributed_missing')).allowed,true);assert.equal((await reserve('synthetic-source-last','distributed_missing')).allowed,false);checks.push('account cap limits distributed sources');
 await pool.query('ALTER TABLE staff_login_throttle RENAME TO staff_login_throttle_unavailable');const unavailable=await login(base,'missing_again');assert.equal(unavailable.response.status,503);assert.equal(unavailable.body.error.code,'login_protection_unavailable');checks.push('missing storage fails closed');
 console.log(JSON.stringify({status:'passed',scope:'synthetic PostgreSQL + real HTTP login; no browser/production verification',checks},null,2));
}finally{await stop();if(pool)await pool.end();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await admin.query(`DROP DATABASE "${database}"`);}await admin.end();}
