import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access, mkdir, copyFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { X509Certificate } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { parse } from 'dotenv';
import { generate } from 'selfsigned';
import { createDatabasePool, closeDatabasePool } from '../src/server/db/pool.js';
import { runMigrations } from '../src/server/db/migrate.js';
import { SetupError, checkRuntime, checkDatabaseVersion, describeSetupError } from './setup-diagnostics.mts';

const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(directory);
const {values:options}=parseArgs({options:{lan:{type:'boolean'},reconfigure:{type:'boolean'},database:{type:'string',default:'sigap'},user:{type:'string',default:'root'},host:{type:'string',default:'127.0.0.1'},port:{type:'string',default:'3306'}}});
function askPassword():Promise<string>{
 if(!process.stdin.isTTY||!process.stdin.setRawMode)return Promise.resolve('');
 process.stdout.write('Password database XAMPP (Enter jika kosong): ');
 return new Promise((resolve,reject)=>{
  let password='';const input=process.stdin;input.setRawMode(true);input.resume();
  const finish=(error?:Error)=>{input.setRawMode(false);input.pause();input.off('data',receive);process.stdout.write('\n');error?reject(error):resolve(password);};
  const receive=(chunk:Buffer)=>{for(const byte of chunk){if(byte===3){finish(new Error('Setup cancelled.'));return;}if(byte===13||byte===10){finish();return;}if(byte===8||byte===127){password=password.slice(0,-1);continue;}if(byte>=32&&byte<=126)password+=String.fromCharCode(byte);}};
  input.on('data',receive);
 });
}
async function command(args:string[]):Promise<void>{
 const executable=process.platform==='win32'?'npm.cmd':'npm';
 // cmd.exe is needed to run Windows npm.cmd; the command arguments are fixed by this script.
 await new Promise<void>((resolve,reject)=>{const child=spawn(executable,args,{cwd:directory,stdio:'inherit',shell:process.platform==='win32'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Setup command failed.')));});
}
async function lanCertificates(env:Record<string,string>):Promise<void>{
 const addresses=[...new Set(Object.values(networkInterfaces()).flatMap(list=>(list??[]).filter(item=>item.family==='IPv4'&&!item.internal).map(item=>item.address)))];
 if(!addresses.length)throw new Error('No LAN IPv4 address found. Connect Wi-Fi first.');
 await mkdir('.local-certs',{recursive:true,mode:0o700});
 const certPath='.local-certs/xampp-lan.pem',keyPath='.local-certs/xampp-lan-key.pem';
 let reusable=false;
 try{const cert=new X509Certificate(await readFile(certPath));await access(keyPath);reusable=new Date(cert.validTo).getTime()>Date.now()+86400000&&addresses.every(ip=>Boolean(cert.checkIP(ip)));}catch{}
 if(!reusable){
  const pems=await generate([{name:'commonName',value:'SIGAP local LAN'}],{keySize:2048,algorithm:'sha256',notAfterDate:new Date(Date.now()+30*86400000),extensions:[{name:'basicConstraints',cA:false},{name:'keyUsage',digitalSignature:true,keyEncipherment:true},{name:'extKeyUsage',serverAuth:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'},...addresses.map(ip=>({type:7 as const,ip}))]}]});
  await writeFile(certPath,pems.cert,{mode:0o600});await writeFile(keyPath,pems.private,{mode:0o600});
 }
 env.HOST='0.0.0.0';env.LAN_DEMO='1';env.TLS_CERT_PATH=certPath;env.TLS_KEY_PATH=keyPath;
 for(const ip of addresses)console.log(`Akses HP: https://${ip}:${env.PORT||3001}`);
 console.log('Sertifikat lokal dibuat otomatis. Browser HP tetap perlu mempercayai sertifikat dan memberi izin GPS.');
}
let stage = 'pemeriksaan runtime';
try{
 checkRuntime(process.versions.node, process.env.npm_config_user_agent);
 stage = 'konfigurasi';
 let previous:string|undefined;try{previous=await readFile('.env','utf8');}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
 let env=previous?parse(previous):{};
 if(previous&&!options.reconfigure&&!/^(mysql|mariadb):/.test(env.DATABASE_URL??''))throw new Error('Existing .env uses another database. Run npm run setup:xampp -- --reconfigure to make a private backup and configure XAMPP.');
 if(!previous||options.reconfigure){
  if(!process.stdin.isTTY)throw new SetupError('Setup pertama memerlukan terminal interaktif untuk memasukkan password database.');
  if(!/^[A-Za-z0-9_]{1,64}$/.test(options.database!))throw new Error('Invalid database name. Use letters, numbers and underscores.');
  const password=await askPassword();
  const url=new URL('mysql://127.0.0.1');url.hostname=options.host!;url.port=options.port!;url.username=options.user!;url.password=password;url.pathname='/'+options.database!;
  env={...env,DATABASE_URL:url.toString(),DATABASE_POOL_MAX:'10',SESSION_SECRET:randomBytes(32).toString('hex'),HOST:'127.0.0.1',PORT:env.PORT||'3001',LAN_DEMO:'0',TLS_CERT_PATH:'',TLS_KEY_PATH:'',VITE_DEMO_MAP_CENTER_LAT:env.VITE_DEMO_MAP_CENTER_LAT||'0',VITE_DEMO_MAP_CENTER_LNG:env.VITE_DEMO_MAP_CENTER_LNG||'0',VITE_MAP_TILE_URL:env.VITE_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',VITE_MAP_ATTRIBUTION:env.VITE_MAP_ATTRIBUTION||'© OpenStreetMap contributors'};
 }
 if(!env.SESSION_SECRET||Buffer.byteLength(env.SESSION_SECRET)<32)env.SESSION_SECRET=randomBytes(32).toString('hex');
 const url=new URL(env.DATABASE_URL);if(!['mysql:','mariadb:'].includes(url.protocol))throw new Error('XAMPP setup requires mysql:// or mariadb://.');
 const database=decodeURIComponent(url.pathname.slice(1));if(!/^[A-Za-z0-9_]{1,64}$/.test(database))throw new Error('Invalid database name.');
 stage = 'koneksi database';
 const connection=await mysql.createConnection({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),connectTimeout:5000});
 try{
  const [rows] = await connection.query<RowDataPacket[]>('SELECT VERSION() AS version');
  checkDatabaseVersion(String(rows[0]?.version ?? ''));
  console.log('Server MariaDB kompatibel.');
  stage = 'pemilihan database';
  try { await connection.query('USE `'+database+'`'); }
  catch (error) {
   if ((error as {code?:string}).code !== 'ER_BAD_DB_ERROR') throw error;
   stage = 'pembuatan database';
   await connection.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin');
  }
 }finally{await connection.end();}
 if(options.lan)await lanCertificates(env);
 if(previous&&options.reconfigure){await mkdir('backups/private',{recursive:true,mode:0o700});const backup='backups/private/env-before-xampp-'+Date.now()+'.env';await copyFile('.env',backup);await chmod(backup,0o600);}
 // JSON quoting is understood by dotenv and preserves spaces/URL metacharacters.
 const contents=Object.entries(env).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n';
 if(!previous)await writeFile('.env',contents,{flag:'wx',mode:0o600});else if(options.reconfigure||options.lan||contents!==previous)await writeFile('.env',contents,{mode:0o600});
 Object.assign(process.env,env);
 stage = 'migrasi database';
 const pool=createDatabasePool({databaseUrl:env.DATABASE_URL,databasePoolMax:Number(env.DATABASE_POOL_MAX||10)});
 let hasAdmin=false;
 try{const result=await runMigrations(pool);console.log(`Database XAMPP siap. Schema versi ${result.currentVersion}.`);hasAdmin=Boolean((await pool.query("SELECT 1 FROM staff_accounts WHERE role='operator_admin' LIMIT 1")).rowCount);}finally{await closeDatabasePool(pool);}
 stage = 'pembuatan administrator';
 if(!hasAdmin){if(!process.stdin.isTTY)throw new Error('First admin requires an interactive terminal. Run npm run staff:bootstrap.');await command(['run','staff:bootstrap']);}
 console.log('Konfigurasi lokal tersimpan. Tidak perlu mengisi .env satu per satu.');
}catch(error){
 const known = error instanceof Error && /^(Existing \.env|Invalid database|XAMPP setup|First admin|No LAN|Setup cancelled)/.test(error.message);
 console.error(known ? error.message : describeSetupError(error, stage));process.exitCode=1;
}
