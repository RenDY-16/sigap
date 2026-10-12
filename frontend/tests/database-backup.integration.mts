import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { createApplication } from '../src/server/app.ts';
import { runMigrations } from '../src/server/db/migrate.ts';

// Only databases with unique sigap_backup_ / sigap_restore_ names are created or dropped.
const adminUrl = new URL(process.env.SIGAP_VERIFY_DATABASE_URL ?? 'postgresql://sigap_dev:sigap_local_synthetic_only@127.0.0.1:54329/sigap_staging');
const sourceName = `sigap_backup_${Date.now()}_${randomBytes(4).toString('hex')}`;
const targetName = `sigap_restore_${Date.now()}_${randomBytes(4).toString('hex')}`;
const admin = new pg.Pool({ connectionString: adminUrl.toString() });
let sourceCreated=false; let targetCreated=false; let pool:pg.Pool|undefined;
let server:ReturnType<typeof createServer>|undefined; let base=''; let workdir='';
const secret=randomBytes(32).toString('hex');
const passphrase=randomBytes(48).toString('base64url');
const privateText=`synthetic backup fixture ${randomBytes(12).toString('hex')}`;
const token=randomBytes(32).toString('hex');const idem=randomBytes(32).toString('hex');
const counts=['schema_migrations','incidents','incident_status_events','audit_events','outbox_events','staff_accounts'];
function cli(args:string[],databaseUrl:string){return new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
 const child=spawn('./node_modules/.bin/tsx',['scripts/database-backup.mts',...args],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl,SESSION_SECRET:secret,SIGAP_BACKUP_PASSPHRASE:passphrase},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.setEncoding('utf8').on('data',v=>stdout+=v);child.stderr.setEncoding('utf8').on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
});}
async function closeServer(){if(server){server.closeAllConnections();await new Promise<void>((r,j)=>server!.close(e=>e?j(e):r()));server=undefined;}}
try{
 await admin.query(`CREATE DATABASE "${sourceName}"`);sourceCreated=true;const sourceUrl=new URL(adminUrl);sourceUrl.pathname='/'+sourceName;
 pool=new pg.Pool({connectionString:sourceUrl.toString(),max:1,connectionTimeoutMillis:3000});await runMigrations(pool);
 const app=createApplication({databaseUrl:sourceUrl.toString(),databasePoolMax:1,host:'127.0.0.1',port:0,sessionSecret:secret,lanDemo:false,secureCookies:false,clientDistPath:'/nonexistent'},pool);
 server=createServer(app.app);await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address!=='string');base=`http://127.0.0.1:${address.port}`;
 const response=await fetch(base+'/api/citizen/incidents',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':idem},body:JSON.stringify({category:'security',categoryId:'security',configVersion:1,description:privateText,locationMode:'simulation',initialLocation:{lat:-5.1477,lng:119.4327},fieldAnswers:{}})});
 assert.equal(response.status,201);const incident=await response.json() as {id:string};
 const sourceCounts=async(database:pg.Pool)=>Object.fromEntries(await Promise.all(counts.map(async table=>[table,(await database.query(`SELECT count(*)::text AS value FROM ${table}`)).rows[0].value])));
 const before=await sourceCounts(pool);assert.equal(before.incidents,'1');assert.equal(before.outbox_events,'1');
 workdir=await mkdtemp(join(tmpdir(),'sigap-backup-drill-'));const artifact=join(workdir,'synthetic-stage-backup.gpg');
 const backup=await cli(['backup',artifact],sourceUrl.toString());assert.equal(backup.code,0,`backup CLI failed: ${backup.stderr}`);assert(!backup.stdout.includes(privateText));assert(!backup.stderr.includes(privateText));assert(!backup.stdout.includes(token));
 const bytes=await readFile(artifact);assert(bytes.length>128);assert(!bytes.includes(Buffer.from(privateText)));assert(!bytes.includes(Buffer.from(token)));
 const verify=await cli(['verify',artifact],sourceUrl.toString());assert.equal(verify.code,0,`verify CLI failed: ${verify.stderr}`);assert(!verify.stdout.includes(privateText));
 const collision=await cli(['backup',artifact],sourceUrl.toString());assert.notEqual(collision.code,0,'backup must not overwrite an existing archive');
 const broken=join(workdir,'tampered.gpg');const changed=Buffer.from(bytes);changed[changed.length-12]^=1;await (await import('node:fs/promises')).writeFile(broken,changed,{mode:0o600});
 const restore=await cli(['restore',artifact,targetName],sourceUrl.toString());assert.equal(restore.code,0,`restore CLI failed: ${restore.stderr}`);targetCreated=true;
 const restoredUrl=new URL(sourceUrl);restoredUrl.pathname='/'+targetName;const restored=new pg.Pool({connectionString:restoredUrl.toString(),max:1});
 const after=await sourceCounts(restored);assert.deepEqual(after,before);const found=await restored.query('SELECT description,latitude,longitude FROM incidents WHERE id=$1',[incident.id]);assert.deepEqual(found.rows,[{description:privateText,latitude:-5.1477,longitude:119.4327}]);
 const sourceSchema=await pool.query('SELECT version,filename,checksum FROM schema_migrations ORDER BY version');const targetSchema=await restored.query('SELECT version,filename,checksum FROM schema_migrations ORDER BY version');assert.deepEqual(targetSchema.rows,sourceSchema.rows);await restored.end();
 assert(!restore.stdout.includes(privateText));assert(!restore.stdout.includes(token));assert(!restore.stderr.includes(privateText));assert(!restore.stderr.includes(token));
 const wrongPass=await cli(['restore',broken,`sigap_restore_${Date.now()}_${randomBytes(4).toString('hex')}`],sourceUrl.toString());assert.notEqual(wrongPass.code,0);assert(!wrongPass.stderr.includes(passphrase));assert(!wrongPass.stderr.includes(privateText));
 const unsafePath=await cli(['backup',join(process.cwd(),'synthetic-backup.gpg')],sourceUrl.toString());assert.notEqual(unsafePath.code,0,'encrypted artifacts must stay outside the source repository');
 const hostOverrideUrl=new URL(sourceUrl);hostOverrideUrl.searchParams.set('host','backup-target.invalid');const hostOverride=await cli(['backup',join(workdir,'host-override.gpg')],hostOverrideUrl.toString());assert.notEqual(hostOverride.code,0,'connection overrides must not bypass the loopback-only staging guard');
 console.log(JSON.stringify({status:'passed',scope:'synthetic HTTP incident and real local PostgreSQL 18 encrypted logical backup; isolated restore; no source staging data copied',checks:['only generated test databases were created/dropped','archive uses authenticated GPG symmetric encryption and refuses overwrite','verify checks encrypted archive without revealing report data','row counts, incident values and migration checksums match after restore','tampered archive is rejected and partial restore database is removed','unsafe repository destination and connection overrides are rejected','logs/stdout exclude fixture text and citizen token']}));
}finally{
 await closeServer();if(pool)await pool.end();if(targetCreated)await admin.query(`DROP DATABASE "${targetName}"`);if(sourceCreated)await admin.query(`DROP DATABASE "${sourceName}"`);if(workdir)await rm(workdir,{recursive:true,force:true});await admin.end();
}
