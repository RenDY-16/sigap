import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {DispatchScenario,DispatchStatus} from '../../shared/dispatch.js';
import type {DispatchAdapter,DispatchOutcome,DispatchSendInput} from './contracts.js';

export interface DispatchLease extends DispatchSendInput {leaseToken:string;incidentId:string}
const MAX_ATTEMPTS=3;
async function transaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
 catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}
async function audit(client:PoolClient,incidentId:string,event:string,details:Record<string,unknown>):Promise<void>{
 await client.query(`INSERT INTO audit_events(id,incident_id,event,actor_kind,details) VALUES($1,$2,$3,'system',$4::jsonb)`,[randomUUID(),incidentId,event,JSON.stringify({...details,simulated:true})]);
}

/** A crashed sender might already have issued its handoff. Never resend an expired lease. */
export async function recoverExpiredDispatchLeases(pool:Pool):Promise<number>{
 return transaction(pool,async client=>{
  const rows=(await client.query(`SELECT d.id,d.incident_id,d.lease_token,d.attempt_count FROM dispatch_intents d JOIN incidents i ON i.id=d.incident_id
   WHERE d.status='sending' AND d.lease_expires_at<=clock_timestamp() ORDER BY d.lease_expires_at,d.id LIMIT 10 FOR UPDATE OF d,i SKIP LOCKED`)).rows;
  for(const r of rows){
   const result=await client.query(`UPDATE dispatch_attempts SET finished_at=statement_timestamp(),result='unknown',diagnostic_code='lease_expired'
    WHERE intent_id=$1 AND lease_token=$2 AND result IS NULL`,[r.id,r.lease_token]);
   if(result.rowCount!==1)throw new Error('Dispatch lease has no unfinished attempt.');
   await client.query(`UPDATE dispatch_intents SET status='unknown',next_attempt_at=NULL,lease_token=NULL,leased_by=NULL,lease_expires_at=NULL,updated_at=statement_timestamp() WHERE id=$1`,[r.id]);
   await audit(client,r.incident_id,'dispatch:lease:expired',{intentId:r.id,attemptNumber:r.attempt_count,status:'unknown'});
  }
  return rows.length;
 });
}

/** Claim and append the attempt before releasing locks and invoking the adapter. */
export async function claimDueDispatchIntent(pool:Pool,workerId:string):Promise<DispatchLease|null>{
 if(!workerId||workerId.length>128)throw new Error('Invalid dispatch worker ID.');
 return transaction(pool,async client=>{
  for(let skipped=0;skipped<10;skipped++){
   const r=(await client.query(`SELECT d.id,d.incident_id,d.scenario,d.correlation_id,d.attempt_count,i.status AS incident_status,i.withdrawal_requested_at,i.withdrawal_outcome
    FROM dispatch_intents d JOIN incidents i ON i.id=d.incident_id WHERE d.status IN ('queued','retry_wait') AND d.next_attempt_at<=clock_timestamp()
    ORDER BY d.next_attempt_at,d.id LIMIT 1 FOR UPDATE OF d,i SKIP LOCKED`)).rows[0];
   if(!r)return null;
   const cancelled=['resolved','referred'].includes(r.incident_status)||(r.withdrawal_requested_at&&r.withdrawal_outcome!=='denied');
   if(cancelled||r.attempt_count>=MAX_ATTEMPTS){
    const status=cancelled?'cancelled':'dead_letter';
    await client.query('UPDATE dispatch_intents SET status=$2,next_attempt_at=NULL,updated_at=statement_timestamp() WHERE id=$1',[r.id,status]);
    await audit(client,r.incident_id,cancelled?'dispatch:intent:cancelled':'dispatch:intent:exhausted',{intentId:r.id,status});continue;
   }
   const leaseToken=randomUUID(),attemptNumber=r.attempt_count+1;
   await client.query(`UPDATE dispatch_intents SET status='sending',attempt_count=$2,next_attempt_at=NULL,lease_token=$3,leased_by=$4,
    lease_expires_at=statement_timestamp()+interval '30 seconds',updated_at=statement_timestamp() WHERE id=$1`,[r.id,attemptNumber,leaseToken,workerId]);
   await client.query('INSERT INTO dispatch_attempts(id,intent_id,attempt_number,lease_token) VALUES($1,$2,$3,$4)',[randomUUID(),r.id,attemptNumber,leaseToken]);
   await audit(client,r.incident_id,'dispatch:attempt:started',{intentId:r.id,attemptNumber});
   return {intentId:r.id,incidentId:r.incident_id,correlationId:r.correlation_id,scenario:r.scenario as DispatchScenario,attemptNumber,leaseToken};
  }
  return null;
 });
}

function safeOutcome(outcome:DispatchOutcome):DispatchOutcome{
 const allowed:Record<string,string>={mock_accepted:'accepted',mock_rejected:'rejected',mock_transient:'transient_failure',mock_unknown:'unknown',adapter_exception:'unknown'};
 if(!outcome||outcome.simulated!==true||!Object.hasOwn(allowed,outcome.diagnosticCode)||allowed[outcome.diagnosticCode]!==outcome.result)return {result:'unknown',diagnosticCode:'adapter_exception',simulated:true};
 return {result:outcome.result,diagnosticCode:outcome.diagnosticCode,simulated:true};
}

/** Fence stale/late workers. Attempt, ack, final state and audit share one commit. */
export async function completeDispatchAttempt(pool:Pool,lease:DispatchLease,rawOutcome:DispatchOutcome):Promise<boolean>{
 const outcome=safeOutcome(rawOutcome);
 return transaction(pool,async client=>{
  const r=(await client.query(`SELECT d.id,d.incident_id,d.attempt_count FROM dispatch_intents d JOIN incidents i ON i.id=d.incident_id
   WHERE d.id=$1 AND d.status='sending' AND d.lease_token=$2 AND d.attempt_count=$3 AND d.lease_expires_at>clock_timestamp() FOR UPDATE OF d,i`,[lease.intentId,lease.leaseToken,lease.attemptNumber])).rows[0];
  if(!r)return false;
  const status:DispatchStatus=outcome.result==='accepted'?'accepted':outcome.result==='rejected'?'manual_review':outcome.result==='unknown'?'unknown':r.attempt_count>=MAX_ATTEMPTS?'dead_letter':'retry_wait';
  const attempt=await client.query(`UPDATE dispatch_attempts SET result=$3,diagnostic_code=$4,finished_at=statement_timestamp() WHERE intent_id=$1 AND lease_token=$2 AND result IS NULL`,[r.id,lease.leaseToken,outcome.result,outcome.diagnosticCode]);
  if(attempt.rowCount!==1)throw new Error('Dispatch completion has no unfinished attempt.');
  if(outcome.result==='accepted'||outcome.result==='rejected'||outcome.diagnosticCode==='mock_unknown'){
   await client.query(`INSERT INTO dispatch_acknowledgements(id,intent_id,attempt_number,acknowledgement,source) VALUES($1,$2,$3,$4,'local-mock')`,[randomUUID(),r.id,r.attempt_count,outcome.result]);
  }
  await client.query(`UPDATE dispatch_intents SET status=$2,next_attempt_at=CASE WHEN $2='retry_wait' THEN statement_timestamp()+($3::integer*interval '1 second') ELSE NULL END,
   lease_token=NULL,leased_by=NULL,lease_expires_at=NULL,updated_at=statement_timestamp() WHERE id=$1`,[r.id,status,r.attempt_count===1?1:2]);
  await audit(client,r.incident_id,'dispatch:attempt:completed',{intentId:r.id,attemptNumber:r.attempt_count,status,result:outcome.result});
  return true;
 });
}

async function sendWithDeadline(adapter:DispatchAdapter,input:DispatchSendInput):Promise<DispatchOutcome>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return safeOutcome(await Promise.race([adapter.send(input),new Promise<DispatchOutcome>(resolve=>{timer=setTimeout(()=>resolve({result:'unknown',diagnosticCode:'adapter_exception',simulated:true}),10_000);})]));}
 catch{return {result:'unknown',diagnosticCode:'adapter_exception',simulated:true};}
 finally{if(timer)clearTimeout(timer);}
}
export async function processDispatchBatch(pool:Pool,adapter:DispatchAdapter,workerId:string,shouldStop:()=>boolean=()=>false):Promise<number>{
 if(adapter.key!=='local-mock'||adapter.version!==1)throw new Error('Unsupported dispatch adapter.');
 await recoverExpiredDispatchLeases(pool);
 let processed=0;
 for(let n=0;n<10&&!shouldStop();n++){
  const lease=await claimDueDispatchIntent(pool,workerId);if(!lease)break;
  const outcome=await sendWithDeadline(adapter,lease);
  await completeDispatchAttempt(pool,lease,outcome);processed++;
 }
 return processed;
}
export function createDispatchCoordinator(pool:Pool,adapter:DispatchAdapter,workerId:string=randomUUID()):{start():void;stop():Promise<void>}{
 let running=false,stopped=false,timer:ReturnType<typeof setTimeout>|undefined,active:Promise<void>|undefined;
 const tick=()=>{
  if(!running)return;
  active=processDispatchBatch(pool,adapter,workerId,()=>!running).then(()=>{},()=>{process.stderr.write('SIGAP dispatch batch failed; durable state retained for recovery.\n');}).finally(()=>{
   active=undefined;if(running){timer=setTimeout(tick,500);timer.unref();}
  });
 };
 return {start(){if(running||stopped)return;running=true;tick();},async stop(){running=false;stopped=true;if(timer)clearTimeout(timer);if(active)await active;}};
}
