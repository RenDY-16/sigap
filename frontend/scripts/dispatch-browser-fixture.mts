// Isolated, loopback-only browser test fixture. No production authentication bypass.
import express from 'express';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import {runMigrations} from '../src/server/db/migrate.ts';
import {bootstrapFirstAdmin} from '../src/server/identity/staff-repository.ts';
import {createApplication} from '../src/server/app.ts';
import {createDispatchCoordinator} from '../src/server/dispatch/dispatch-coordinator.ts';
import {LocalMockAdapter} from '../src/server/dispatch/local-mock-adapter.ts';
const url=new URL(process.env.SIGAP_VERIFY_DATABASE_URL??'postgresql://sigap_dev:sigap_local_synthetic_only@127.0.0.1:54329/sigap_staging');
const admin=new pg.Pool({connectionString:url.toString()}),name=`sigap_browser_${Date.now()}_${randomBytes(4).toString('hex')}`;
await admin.query(`CREATE DATABASE "${name}"`);url.pathname='/'+name;const pool=new pg.Pool({connectionString:url.toString(),max:4});
await runMigrations(pool);await bootstrapFirstAdmin(pool,'browser_fixture','Petugas sintetis',randomBytes(24).toString('hex'));
const actor=(await pool.query('SELECT id FROM staff_accounts LIMIT 1')).rows[0].id;
await pool.query("UPDATE staff_accounts SET role='supervisor' WHERE id=$1",[actor]);
const incident=randomUUID();
await pool.query(`INSERT INTO incidents(id,access_token_digest,idempotency_digest,payload_digest,category,description,status,location_mode,category_id,config_version,create_payload_version,owner_staff_id)
 VALUES($1,$2,$3,$4,'security','Synthetic browser test incident','triaged','gps','security',1,2,$5)`,[incident,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),actor]);
for(const [scenario,status,count]of [['accepted','accepted',1],['unknown','unknown',1],['transient','dead_letter',3]] as const){
 const id=randomUUID();await pool.query(`INSERT INTO dispatch_intents(id,incident_id,region_id,created_by_staff_id,idempotency_digest,payload_digest,correlation_id,scenario,status,attempt_count,next_attempt_at)
  VALUES($1,$2,'local-staging',$3,$4,$5,$6,$7,$8,$9,NULL)`,[id,incident,actor,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),randomUUID(),scenario,status,count]);
 for(let n=1;n<=count;n++)await pool.query(`INSERT INTO dispatch_attempts(id,intent_id,attempt_number,lease_token,started_at,finished_at,result,diagnostic_code)
  VALUES($1,$2,$3,$4,statement_timestamp(),statement_timestamp(),$5,$6)`,[randomUUID(),id,n,randomUUID(),scenario==='transient'?'transient_failure':scenario,scenario==='transient'?'mock_transient':scenario==='accepted'?'mock_accepted':'mock_unknown']);
 if(scenario==='accepted')await pool.query("INSERT INTO dispatch_acknowledgements(id,intent_id,attempt_number,acknowledgement,source) VALUES($1,$2,1,'accepted','local-mock')",[randomUUID(),id]);
}
const runtime=createApplication({databaseUrl:url.toString(),databasePoolMax:4,host:'127.0.0.1',port:3108,sessionSecret:randomBytes(32).toString('hex'),lanDemo:false,secureCookies:false,clientDistPath:path.resolve('dist/client')},pool);
const wrapper=express();
// This route exists only in this synthetic fixture process and its isolated DB.
wrapper.get('/fixture/session',runtime.staffSessions.middleware,async(req,res)=>{
 await runtime.staffSessions.regenerate(req);req.session.staffPrincipalId=actor;req.session.staffCredentialVersion=1;await runtime.staffSessions.save(req);
 res.redirect('/dashboard/dispatch?incidentId='+incident);
});
// Keep responses lost until explicit fixture recovery, including browser transport retries.
let dropRejectedResponses=true;
wrapper.get('/fixture/recover',(_req,res)=>{dropRejectedResponses=false;res.redirect('/dashboard/dispatch?incidentId='+incident);});
wrapper.use((req,res,next)=>{
 const json=res.json.bind(res);
 res.json=(body)=>{
  if(dropRejectedResponses&&req.method==='POST'&&req.originalUrl.endsWith('/dispatch')&&req.body?.scenario==='rejected'&&[200,201].includes(res.statusCode)){process.stdout.write('Synthetic committed response intentionally lost.\n');req.socket.destroy();return res;}
  return json(body);
 };
 next();
});
wrapper.use(runtime.app);const server=createServer(wrapper),worker=createDispatchCoordinator(pool,new LocalMockAdapter());
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await worker.stop();await runtime.services.stopAcceptingMutations();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
server.once('error',()=>{void stop();process.exitCode=1;});worker.start();server.listen(3108,'127.0.0.1',()=>console.log('Synthetic browser fixture: http://127.0.0.1:3108/fixture/session'));
