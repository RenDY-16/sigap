import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createServer } from 'node:http';
import { createApplication } from '../src/server/app.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { bootstrapFirstAdmin } from '../src/server/identity/staff-repository.ts';

// Always use an isolated synthetic database; never mutate the presentation data.
const url = new URL(process.env.SIGAP_VERIFY_DATABASE_URL ?? 'postgresql://sigap_dev:sigap_local_synthetic_only@127.0.0.1:54329/sigap_staging');
const admin = new pg.Pool({ connectionString: url.toString() });
const name = `sigap_dispatch_${Date.now()}_${randomBytes(4).toString('hex')}`;
let created = false;
let pool: pg.Pool | undefined;
let server: ReturnType<typeof createServer> | undefined;
const password = randomBytes(24).toString('hex');
const checks: string[] = [];
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = '/' + name;
  pool = new pg.Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 3000 });
  const migration = await runMigrations(pool);
  assert.equal(migration.currentVersion, '8', 'dispatch schema must be present');
  await bootstrapFirstAdmin(pool, 'dispatch_schema_admin', 'Synthetic admin', password);
  const actor = (await pool.query('SELECT id FROM staff_accounts LIMIT 1')).rows[0].id;
  const incident = randomUUID();
  await pool.query(`INSERT INTO incidents(id,access_token_digest,idempotency_digest,payload_digest,category,description,status,location_mode,category_id,config_version,create_payload_version)
    VALUES($1,$2,$3,$4,'security','Synthetic dispatch schema fixture','triaged','gps','security',1,2)`,
    [incident, randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), randomBytes(32).toString('hex')]);
  const intent = randomUUID();
  const digest = randomBytes(32).toString('hex');
  const insert = `INSERT INTO dispatch_intents(id,incident_id,region_id,created_by_staff_id,idempotency_digest,payload_digest,correlation_id,scenario)
    VALUES($1,$2,'local-staging',$3,$4,$5,$6,'accepted')`;
  await pool.query(insert, [intent, incident, actor, digest, randomBytes(32).toString('hex'), randomUUID()]);
  const row = (await pool.query('SELECT * FROM dispatch_intents WHERE id=$1', [intent])).rows[0];
  assert.equal(row.status, 'queued');
  assert.equal(row.simulated, true);
  assert.equal(row.adapter_key, 'local-mock');
  assert.equal(row.target_key, 'local-staging-mock');
  assert.equal(row.attempt_count, 0);
  checks.push('schema v8 creates separate durable dispatch intents with safe local defaults');
  async function denied(sql: string, values: unknown[], code = '23514') {
    await assert.rejects(pool!.query(sql, values), (error: any) => error.code === code);
  }
  for (const [column, value] of [['adapter_key','external'],['target_key','real-service'],['simulated',false],['status','delivered'],['scenario','arbitrary'],['attempt_count',4],['idempotency_digest','raw-key']]) {
    await denied(`UPDATE dispatch_intents SET ${column}=$2 WHERE id=$1`, [intent,value]);
  }
  await denied(insert, [randomUUID(),incident,actor,digest,randomBytes(32).toString('hex'),randomUUID()], '23505');
  await pool.query("INSERT INTO regions(id,name) VALUES('dispatch-other','Synthetic other')");
  await denied("UPDATE dispatch_intents SET region_id='dispatch-other' WHERE id=$1", [intent], '23503');
  await denied("UPDATE dispatch_intents SET status='sending' WHERE id=$1", [intent]);
  await denied('UPDATE dispatch_intents SET lease_token=$2 WHERE id=$1', [intent,randomUUID()]);
  checks.push('adapter/target, simulation, enums, attempt cap, digest, idempotency and incident-region constraints reject invalid state');
  const lease = randomUUID();
  await pool.query(`UPDATE dispatch_intents SET status='sending',attempt_count=1,next_attempt_at=NULL,
    lease_token=$2,leased_by='schema-worker',lease_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1`, [intent,lease]);
  const attempt = randomUUID();
  await pool.query(`INSERT INTO dispatch_attempts(id,intent_id,attempt_number,lease_token) VALUES($1,$2,1,$3)`, [attempt,intent,lease]);
  await denied('INSERT INTO dispatch_attempts(id,intent_id,attempt_number,lease_token) VALUES($1,$2,1,$3)', [randomUUID(),intent,randomUUID()], '23505');
  await denied("UPDATE dispatch_attempts SET result='raw-response' WHERE id=$1", [attempt]);
  await denied('UPDATE dispatch_attempts SET finished_at=started_at-interval \'1 second\' WHERE id=$1', [attempt]);
  await pool.query("UPDATE dispatch_attempts SET result='accepted',diagnostic_code='mock_accepted',finished_at=clock_timestamp() WHERE id=$1", [attempt]);
  await pool.query(`INSERT INTO dispatch_acknowledgements(id,intent_id,attempt_number,acknowledgement,source) VALUES($1,$2,1,'accepted','local-mock')`, [randomUUID(),intent]);
  await denied(`INSERT INTO dispatch_acknowledgements(id,intent_id,attempt_number,acknowledgement,source) VALUES($1,$2,2,'accepted','local-mock')`, [randomUUID(),intent], '23503');
  await denied(`INSERT INTO dispatch_acknowledgements(id,intent_id,attempt_number,acknowledgement,source,simulated) VALUES($1,$2,1,'accepted','local-mock',false)`, [randomUUID(),intent]);
  await pool.query("UPDATE dispatch_intents SET status='accepted',lease_token=NULL,leased_by=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[intent]);
  checks.push('attempt numbers are unique, outcomes bounded, timestamps ordered and acknowledgements reference real attempts');
  await pool.end();
  pool = new pg.Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 3000 });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dispatch_attempts')).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dispatch_acknowledgements')).rows[0].n, 1);
  assert.equal((await pool.query('SELECT status FROM incidents WHERE id=$1',[incident])).rows[0].status,'triaged');
  checks.push('pool recreation preserves dispatch records without changing incident status');
  const { LocalMockAdapter } = await import('../src/server/dispatch/local-mock-adapter.ts');
  const adapter = new LocalMockAdapter();
  for (const [scenario, expected] of [['accepted','accepted'],['rejected','rejected'],['transient','transient_failure'],['unknown','unknown']] as const) {
    const input = { intentId:intent,correlationId:randomUUID(),attemptNumber:1,scenario };
    assert.deepEqual(await adapter.send(input), await adapter.send(input));
    assert.equal((await adapter.send(input)).result, expected);
    assert.equal((await adapter.send(input)).simulated, true);
  }
  checks.push('local adapter deterministically classifies four outcomes without claiming real delivery');
  server = createServer(createApplication({databaseUrl:'unused',databasePoolMax:2,host:'127.0.0.1',port:0,sessionSecret:randomBytes(32).toString('hex'),lanDemo:false,secureCookies:false,clientDistPath:'/nonexistent'},pool).app);
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const address=server.address(); assert(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  async function call(path:string,method='GET',body?:unknown,cookie?:string,key?:string) {
    const headers:Record<string,string>={Origin:base,'X-SIGAP-Request':'staff'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(cookie)headers.Cookie=cookie;
    if(key)headers['Idempotency-Key']=key;
    const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const root=(await call('/api/staff/session','POST',{username:'dispatch_schema_admin',password})).cookie;
  assert(root);
  for(const [username,role]of [['dispatch_operator','dispatcher'],['dispatch_peer','dispatcher'],['dispatch_supervisor','supervisor'],['dispatch_auditor','auditor']] as const) {
    assert.equal((await call('/api/staff/accounts','POST',{username,password,displayName:'Synthetic '+role,role,regionIds:['local-staging']},root)).status,201);
  }
  const login=async(username:string)=>{const response=await call('/api/staff/session','POST',{username,password});assert.equal(response.status,200);assert(response.cookie);return response.cookie;};
  const operator=await login('dispatch_operator'), peer=await login('dispatch_peer'), supervisor=await login('dispatch_supervisor'), auditor=await login('dispatch_auditor');
  const operatorId=(await pool.query("SELECT id FROM staff_accounts WHERE username='dispatch_operator'")).rows[0].id;
  await pool.query('UPDATE incidents SET owner_staff_id=$2 WHERE id=$1',[incident,operatorId]);
  const endpoint=`/api/staff/incidents/${incident}/dispatch`, key=randomBytes(24).toString('hex');
  assert.equal((await call('/api/staff/dispatch')).status,401);
  assert.equal((await call(endpoint,'POST',{scenario:'accepted'},root,key)).status,409);
  assert.equal((await call(endpoint,'POST',{scenario:'accepted'},peer,key)).status,409);
  assert.equal((await call(endpoint,'POST',{scenario:'invalid'},operator,key)).status,400);
  const responses=await Promise.all([call(endpoint,'POST',{scenario:'accepted'},operator,key),call(endpoint,'POST',{scenario:'accepted'},operator,key)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  assert.equal(responses[0].data.id,responses[1].data.id);
  const newId=responses[0].data.id;
  assert.equal((await call(endpoint,'POST',{scenario:'unknown'},operator,key)).status,409);
  assert.equal((await call('/api/staff/dispatch/'+newId,'GET',undefined,operator)).status,200);
  assert.equal((await call('/api/staff/dispatch/'+newId,'GET',undefined,peer)).status,404);
  assert.equal((await call('/api/staff/dispatch/'+newId,'GET',undefined,auditor)).status,403);
  assert.equal((await call('/api/staff/dispatch/'+newId,'GET',undefined,supervisor)).status,200);
  const page=await call('/api/staff/dispatch?status=queued','GET',undefined,operator);
  assert.equal(page.status,200); assert.equal(page.data.items.length,1);
  for(const field of ['created_by_staff_id','idempotency_digest','payload_digest','lease_token','description','location','correlation_id'])assert(!(field in page.data.items[0]));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE event='dispatch:intent:created'")).rows[0].n,1);
  await pool.query('UPDATE incidents SET withdrawal_requested_at=clock_timestamp() WHERE id=$1',[incident]);
  assert.equal((await call(endpoint,'POST',{scenario:'accepted'},operator,randomBytes(24).toString('hex'))).status,409);
  // A previously confirmed idempotent result remains readable even when eligibility changes.
  assert.equal((await call(endpoint,'POST',{scenario:'accepted'},operator,key)).status,200);
  checks.push('HTTP session/role/ownership enforced; concurrent idempotency, scoped metadata and withdrawal eligibility verified');
  await pool.query('UPDATE incidents SET withdrawal_requested_at=NULL WHERE id=$1',[incident]);
  await pool.query(`CREATE FUNCTION reject_dispatch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='dispatch:intent:created' THEN RAISE EXCEPTION 'synthetic dispatch audit failure'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER reject_dispatch_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_dispatch_audit()');
  const before=(await pool.query('SELECT count(*)::int AS n FROM dispatch_intents')).rows[0].n;
  assert.equal((await call(endpoint,'POST',{scenario:'accepted'},operator,randomBytes(24).toString('hex'))).status,500);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dispatch_intents')).rows[0].n,before);
  await pool.query('DROP TRIGGER reject_dispatch_audit ON audit_events');
  checks.push('failed audit insert rolls back intent atomically');
  for(let i=0;i<3;i++)assert.equal((await call(endpoint,'POST',{scenario:'accepted'},operator,randomBytes(24).toString('hex'))).status,201);
  await pool.query("UPDATE dispatch_intents SET created_at='2026-10-12T00:00:00.123456Z',updated_at=clock_timestamp() WHERE status='queued'");
  let next:string|null=null;const seen=new Set<string>();
  do{const p=await call('/api/staff/dispatch?status=queued&limit=1'+(next?'&cursor='+encodeURIComponent(next):''),'GET',undefined,operator);assert.equal(p.status,200);assert.equal(p.data.items.length,1);assert(!seen.has(p.data.items[0].id));seen.add(p.data.items[0].id);next=p.data.nextCursor;}while(next);
  assert.equal(seen.size,4);
  assert.equal((await call('/api/staff/dispatch?cursor=invalid','GET',undefined,operator)).status,400);
  assert.equal((await call('/api/staff/dispatch?limit=0','GET',undefined,operator)).status,400);
  const {processDispatchBatch}=await import('../src/server/dispatch/dispatch-coordinator.ts');
  assert.equal(await processDispatchBatch(pool,adapter,'http-verification-worker'),4);
  const processed=await call('/api/staff/dispatch/'+newId,'GET',undefined,operator);
  assert.equal(processed.status,200);assert.equal(processed.data.status,'accepted');
  assert.equal(processed.data.attempts.length,1);assert.equal(processed.data.acknowledgements.length,1);assert.equal(processed.data.simulated,true);
  checks.push('HTTP detail exposes the committed worker outcome with attempt/ack history and explicit simulation marker');
  const supervisorId=(await pool.query("SELECT id FROM staff_accounts WHERE username='dispatch_supervisor'")).rows[0].id;
  await pool.query('DELETE FROM staff_account_regions WHERE staff_id=$1',[supervisorId]);
  await pool.query("INSERT INTO staff_account_regions(staff_id,region_id) VALUES($1,'dispatch-other')",[supervisorId]);
  assert.equal((await call('/api/staff/dispatch/'+newId,'GET',undefined,supervisor)).status,404);
  assert.equal((await call('/api/staff/dispatch','GET',undefined,supervisor)).data.items.length,0);
  assert.equal((await call('/api/staff/dispatch/'+newId+'/review','POST',{action:'close',reason:'Synthetic foreign review'},supervisor)).status,404);
  await pool.query('UPDATE staff_accounts SET active=false WHERE id=$1',[operatorId]);
  assert.equal((await call('/api/staff/dispatch','GET',undefined,operator)).status,401);
  checks.push('microsecond cursor pagination has no repeats; region changes and disabled accounts invalidate access immediately');
  await pool.query('UPDATE staff_accounts SET active=true WHERE id=$1',[operatorId]);
  await pool.query('DELETE FROM staff_account_regions WHERE staff_id=$1',[supervisorId]);
  await pool.query("INSERT INTO staff_account_regions(staff_id,region_id) VALUES($1,'local-staging')",[supervisorId]);
  const unknownReview=(await call(endpoint,'POST',{scenario:'unknown'},operator,randomBytes(24).toString('hex'))).data.id;
  const rejectionReview=(await call(endpoint,'POST',{scenario:'rejected'},operator,randomBytes(24).toString('hex'))).data.id;
  const exhausted=(await call(endpoint,'POST',{scenario:'transient'},operator,randomBytes(24).toString('hex'))).data.id;
  await processDispatchBatch(pool,adapter,'review-fixture-worker');
  for(let n=0;n<2;n++){await pool.query('UPDATE dispatch_intents SET next_attempt_at=clock_timestamp() WHERE id=$1',[exhausted]);await processDispatchBatch(pool,adapter,'review-fixture-worker');}
  const reviewPath=(id:string)=>'/api/staff/dispatch/'+id+'/review';
  const close={action:'close',reason:'Synthetic review: no delivery evidence'};
  assert.equal((await call(reviewPath(unknownReview),'POST',close,operator)).status,403);
  assert.equal((await call(reviewPath(unknownReview),'POST',close,auditor)).status,403);
  assert.equal((await call(reviewPath(unknownReview),'POST',{action:'close',reason:''},supervisor)).status,400);
  assert.equal((await call(reviewPath(unknownReview),'POST',{action:'replay',reason:'Synthetic replay'},supervisor,randomBytes(24).toString('hex'))).status,409);
  assert.equal((await call(reviewPath(unknownReview),'POST',close,supervisor)).status,200);
  assert.equal((await call(reviewPath(unknownReview),'POST',close,supervisor)).status,200);
  assert.equal((await call(reviewPath(unknownReview),'POST',{...close,reason:'Changed review'},supervisor)).status,409);
  assert.equal((await call(reviewPath(rejectionReview),'POST',close,supervisor)).status,200);
  assert.equal((await call('/api/staff/dispatch/'+unknownReview,'GET',undefined,supervisor)).data.status,'cancelled');
  checks.push('only supervisor closes unknown/permanent rejection; retries are stable and unknown cannot be replayed');
  await pool.query(`CREATE FUNCTION reject_dispatch_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='dispatch:reviewed' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER reject_dispatch_review_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_dispatch_review_audit()');
  const replayKey=randomBytes(24).toString('hex'),replay={action:'replay',reason:'Synthetic confirmed transient review'};
  const countBeforeReview=(await pool.query('SELECT count(*)::int AS n FROM dispatch_intents')).rows[0].n;
  assert.equal((await call(reviewPath(exhausted),'POST',replay,supervisor,replayKey)).status,500);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dispatch_intents')).rows[0].n,countBeforeReview);
  assert.equal((await pool.query('SELECT reviewed_at FROM dispatch_intents WHERE id=$1',[exhausted])).rows[0].reviewed_at,null);
  await pool.query('DROP TRIGGER reject_dispatch_review_audit ON audit_events');
  const replayed=await Promise.all([call(reviewPath(exhausted),'POST',replay,supervisor,replayKey),call(reviewPath(exhausted),'POST',replay,supervisor,replayKey)]);
  assert.deepEqual(replayed.map(r=>r.status).sort(),[200,201]);assert.equal(replayed[0].data.id,replayed[1].data.id);
  assert.equal(replayed[0].data.replayOf,exhausted);assert.equal(replayed[0].data.status,'queued');
  assert.equal((await call(reviewPath(exhausted),'POST',{...replay,reason:'Changed review payload'},supervisor,replayKey)).status,409);
  assert.equal((await call(reviewPath(exhausted),'POST',replay,supervisor,randomBytes(24).toString('hex'))).status,409);
  assert.equal((await call('/api/staff/dispatch/'+exhausted,'GET',undefined,supervisor)).data.status,'dead_letter');
  assert((await call('/api/staff/dispatch/'+exhausted,'GET',undefined,supervisor)).data.reviewedAt);
  checks.push('reviewed dead-letter replay creates one linked intent with new attempt budget; audit failure rolls back replay and review');
  console.log(JSON.stringify({ status:'passed',scope:'isolated PostgreSQL + real HTTP intent API with local worker outcome; UI and real provider unverified',checks }, null, 2));
} finally {
  if(server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));}
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
