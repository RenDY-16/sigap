import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool as PgPool } from 'pg';
import { compileMysqlQuery } from './mysql-sql.js';

const jsonColumns = new Set(['session_data','details','payload','field_answers','service_hours','required_fields','requiredFields','steps','by_status','coverageRegionIds','categoryIds']);
const booleanColumns = new Set(['active','enabled','synthetic','simulated','external_dispatch_enabled','older']);
function normalizeRow(row: RowDataPacket): Record<string, unknown> {
 const result: Record<string, unknown> = {};
 for(const [key,value] of Object.entries(row)) {
  if(jsonColumns.has(key) && typeof value==='string') result[key]=JSON.parse(value);
  else if(booleanColumns.has(key) && value!==null) result[key]=value===1 || value===true;
  else result[key]=value;
 }
 return result;
}
function valueForMysql(value: unknown): unknown {
 if(value===undefined)return null;
 if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return value.replace('T',' ').replace(/Z$/,'');
 return value;
}
function translateError(error: unknown): unknown {
 if(typeof error!=='object'||error===null)return error;
 const e=error as {errno?:number;code?:string;sqlMessage?:string;constraint?:string};
 if(e.errno===1062){e.code='23505';const key=/for key ['`]([^'`]+)['`]/i.exec(e.sqlMessage??'')?.[1]?.split('.').at(-1);e.constraint=key==='access_token_digest'?'incidents_access_token_digest_key':key==='idempotency_digest'?'incidents_idempotency_digest_key':key;}
 return e;
}
/** Connection-scoped adapter; no global substitution of values into SQL. */
class MysqlClient {
 private inTransaction=false;
 private released=false;
 private transactionLocks=new Set<string>();
 private sessionLocks=new Set<string>();
 constructor(private connection:PoolConnection,private database:string){}
 private lockName(key:unknown):string{return createHash('sha256').update(JSON.stringify([this.database,'sigap',key])).digest('hex');}
 private async lock(name:string,transaction:boolean):Promise<void>{
  const locks=transaction?this.transactionLocks:this.sessionLocks;if(locks.has(name))return;
  const [rows]=await this.connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,10) AS acquired',[name]);
  if(Number(rows[0]?.acquired)!==1)throw new Error('Database lock unavailable.');locks.add(name);
 }
 private async unlockTransactions():Promise<void>{for(const name of this.transactionLocks){await this.connection.query('SELECT RELEASE_LOCK(?)',[name]);}this.transactionLocks.clear();}
 async query(sql:string,values:unknown[]=[]):Promise<{rows:any[];rowCount:number;command:string}>{
  if(this.released)throw new Error('Database connection released.');
  const native=sql.trim().startsWith('/* mysql-native */');
  const operation=sql.trim().replace(/;$/,'').toUpperCase();
  try {
   if(operation==='BEGIN'){
    if(this.inTransaction)throw new Error('Nested transaction unavailable.');
    await this.lock(this.lockName('transaction-coordination'),true);
    try{await this.connection.beginTransaction();this.inTransaction=true;}catch(e){await this.unlockTransactions();throw e;}
    return {rows:[],rowCount:0,command:'BEGIN'};
   }
   if(operation==='COMMIT'||operation==='ROLLBACK'){
    if(operation==='COMMIT')await this.connection.commit();else await this.connection.rollback();
    this.inTransaction=false;await this.unlockTransactions();return {rows:[],rowCount:0,command:operation};
   }
   if(!native && /pg_advisory_(?:xact_)?(?:lock|unlock)/i.test(sql)){
    const transaction=/pg_advisory_xact_/i.test(sql);
    if(transaction&&!this.inTransaction)throw new Error('Transaction lock requires transaction.');
    const name=this.lockName(values[0]);
    if(/pg_advisory_unlock/i.test(sql)){await this.connection.query('SELECT RELEASE_LOCK(?)',[name]);this.sessionLocks.delete(name);}
    else await this.lock(name,transaction);
    return {rows:[{locked:true}],rowCount:1,command:'SELECT'};
   }
   const plan=native?{sql:sql.replace('/* mysql-native */',''),values}:compileMysqlQuery(sql,values);
   let implicit=false;
   if('returning' in plan && plan.returning && !this.inTransaction){await this.query('BEGIN');implicit=true;}
   try{
    let result:RowDataPacket[]|ResultSetHeader;
    try{[result]=await this.connection.query<RowDataPacket[]|ResultSetHeader>({sql:plan.sql,timeout:10000},plan.values.map(valueForMysql));}
    catch(error){
     const e=translateError(error) as {code?:string;constraint?:string};
     if('ignoreDuplicateConstraint' in plan && plan.ignoreDuplicateConstraint && e.code==='23505' && (e.constraint===plan.ignoreDuplicateConstraint||e.constraint===`incidents_${plan.ignoreDuplicateConstraint}_key`)) {
      if(implicit)await this.query('COMMIT');return {rows:[],rowCount:0,command:'INSERT'};
     }
     throw e;
    }
    let rows=Array.isArray(result)?result.map(normalizeRow):[];
    const count=Array.isArray(result)?result.length:result.affectedRows;
    if('returning' in plan && plan.returning && count>0){
     const returning=plan.returning as {sql:string;values:unknown[]};
     const [returned]=await this.connection.query<RowDataPacket[]>({sql:returning.sql,timeout:10000},returning.values.map(valueForMysql));rows=returned.map(normalizeRow);
    }
    if(implicit)await this.query('COMMIT');
    return {rows,rowCount:count,command:plan.sql.trim().split(/\s+/)[0].toUpperCase()};
   }catch(error){if(implicit)await this.query('ROLLBACK').catch(()=>{this.connection.destroy();});throw error;}
  }catch(error){throw translateError(error);}
 }
 release(destroy=false):void {
  if(this.released)return;this.released=true;
  if(destroy||this.inTransaction||this.transactionLocks.size||this.sessionLocks.size)this.connection.destroy();else this.connection.release();
 }
}

export function createMysqlDatabasePool(config:{databaseUrl:string;databasePoolMax?:number}):PgPool {
 const url=new URL(config.databaseUrl);
 const database=decodeURIComponent(url.pathname.slice(1));
 const pool=mysql.createPool({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database,
  connectionLimit:config.databasePoolMax??10,connectTimeout:5000,timezone:'Z',multipleStatements:false,charset:'utf8mb4',enableKeepAlive:true,
  supportBigNumbers:true,bigNumberStrings:true,decimalNumbers:true});
 const adapter={
  dialect:'mysql' as const,
  async connect(){const connection=await pool.getConnection();try{await connection.query("SET time_zone='+00:00'");await connection.query('SET SESSION innodb_lock_wait_timeout=10');await connection.query('SET SESSION group_concat_max_len=1048576');await connection.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");return new MysqlClient(connection,database);}catch(e){connection.destroy();throw e;}},
  async query(sql:string,values:unknown[]=[]){const client=await adapter.connect();try{return await client.query(sql,values);}finally{client.release();}},
  async end(){await pool.end();},
  on(){return adapter;},
 };
 return adapter as unknown as PgPool;
}
export function isMysqlPool(pool:unknown):boolean{return typeof pool==='object'&&pool!==null&&(pool as {dialect?:string}).dialect==='mysql';}
