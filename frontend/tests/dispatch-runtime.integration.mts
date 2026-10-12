import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {runMigrations} from '../src/server/db/migrate.ts';
import {bootstrapFirstAdmin} from '../src/server/identity/staff-repository.ts';
const url=new URL(process.env.SIGAP_VERIFY_DATABASE_URL??'postgresql://sigap_dev:sigap_local_synthetic_only@127.0.0.1:54329/sigap_staging');
const admin=new pg.Pool({connectionString:url.toString()}),name=`sigap_dispatch_runtime_${Date.now()}_${randomBytes(4).toString('hex')}`;
let created=false,pool:pg.Pool|undefined,child:ChildProcess|undefined;
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;url.pathname='/'+name;pool=new pg.Pool({connectionString:url.toString(),max:2});await runMigrations(pool);
 await bootstrapFirstAdmin(pool,'runtime_fixture_admin','Synthetic fixture',randomBytes(24).toString('hex'));const actor=(await pool.query('SELECT id FROM staff_accounts LIMIT 1')).rows[0].id;
 const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));const address=reservation.address();assert(address&&typeof address!=='string');const port=address.port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 async function fixture(){const incident=randomUUID(),id=randomUUID();await pool!.query(`INSERT INTO incidents(id,access_token_digest,idempotency_digest,payload_digest,category,description,status,location_mode,category_id,config_version,create_payload_version) VALUES($1,$2,$3,$4,'security','Synthetic process fixture','triaged','gps','security',1,2)`,[incident,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),randomBytes(32).toString('hex')]);await pool!.query(`INSERT INTO dispatch_intents(id,incident_id,region_id,created_by_staff_id,idempotency_digest,payload_digest,correlation_id,scenario) VALUES($1,$2,'local-staging',$3,$4,$5,$6,'accepted')`,[id,incident,actor,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),randomUUID()]);return id;}
 async function start(){
  child=spawn(process.execPath,['--import','tsx','src/server/index.ts'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url.toString(),DATABASE_POOL_MAX:'4',SESSION_SECRET:randomBytes(32).toString('hex'),HOST:'127.0.0.1',PORT:String(port),LAN_DEMO:'0',TLS_CERT_PATH:'',TLS_KEY_PATH:''},stdio:['ignore','ignore','ignore']});
  for(let n=0;n<60;n++){assert(child.exitCode===null,'runtime exited before readiness');try{const response=await fetch(`http://127.0.0.1:${port}/api/readyz`);if(response.ok)return;}catch{}await delay(100);}
  throw new Error('Runtime readiness deadline exceeded.');
 }
 async function processed(id:string){for(let n=0;n<40;n++){if((await pool!.query('SELECT status FROM dispatch_intents WHERE id=$1',[id])).rows[0].status==='accepted')return;await delay(100);}throw new Error('Automatic dispatch deadline exceeded.');}
 async function stop(){const target=child!;const code=await new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>{target.kill('SIGKILL');reject(new Error('Graceful shutdown deadline exceeded.'));},20_000);target.once('exit',code=>{clearTimeout(timer);resolve(code);});target.kill('SIGTERM');});assert.equal(code,0);child=undefined;}
 const first=await fixture();await start();await processed(first);await stop();
 const second=await fixture();await start();await processed(second);await stop();
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM dispatch_attempts WHERE intent_id=$1',[first])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM dispatch_attempts WHERE intent_id=$1',[second])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM dispatch_acknowledgements')).rows[0].n,2);
 console.log(JSON.stringify({status:'passed',scope:'real server entrypoint in child processes with isolated PostgreSQL and local adapter',checks:['startup automatically processes queued intent','SIGTERM shuts down coordinator/server/database cleanly','restart processes new queued work without resending accepted intent']},null,2));
}finally{
 if(child&&child.exitCode===null){const target=child;await new Promise<void>(resolve=>{target.once('exit',()=>resolve());target.kill('SIGKILL');});}
 if(pool)await pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();
}
