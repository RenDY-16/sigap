import 'dotenv/config';
import { createInterface } from 'node:readline';
import { loadDatabaseConfig } from '../src/server/config.js';
import { createDatabasePool, closeDatabasePool } from '../src/server/db/pool.js';
import { bootstrapFirstAdmin } from '../src/server/identity/staff-repository.js';
function readLine(label:string, hidden=false):Promise<string>{
 process.stdout.write(label);
 if(!hidden){const rl=createInterface({input:process.stdin,output:process.stdout});return new Promise(resolve=>rl.question('',answer=>{rl.close();resolve(answer.trim());}));}
 return new Promise((resolve,reject)=>{
   if(!process.stdin.isTTY||!process.stdin.setRawMode){reject(new Error('Hidden password input requires an interactive terminal.'));return;}
   let value=''; const input=process.stdin; input.setRawMode(true);input.resume();
   const finish=(error?:Error)=>{input.setRawMode(false);input.pause();input.removeListener('data',onData);process.stdout.write('\n');error?reject(error):resolve(value);};
   const onData=(chunk:Buffer)=>{for(const byte of chunk){if(byte===3){finish(new Error('Interrupted.'));return;}if(byte===13||byte===10){finish();return;}if(byte===127||byte===8){value=value.slice(0,-1);continue;}if(byte>=32&&byte<=126)value+=String.fromCharCode(byte);}};
   input.on('data',onData);
 });
}
const pool=createDatabasePool(loadDatabaseConfig());
try {const username=await readLine('First admin username: ');const display=await readLine('Display name: ');const password=await readLine('Password (12+ characters): ',true);const confirm=await readLine('Confirm password: ',true);if(password!==confirm)throw new Error('Passwords did not match.');await bootstrapFirstAdmin(pool,username,display,password);process.stdout.write('First staging operator administrator created.\n');}
catch(error){const message=error instanceof Error&&(/^(Bootstrap refused:|Invalid account|Password must|Passwords did not|Hidden password input|Interrupted)/.test(error.message))?error.message:'Bootstrap failed. Check PostgreSQL and server configuration.';process.stderr.write(`${message}\n`);process.exitCode=1;}
finally{await closeDatabasePool(pool);}
