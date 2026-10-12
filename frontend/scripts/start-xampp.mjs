import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { parse } from 'dotenv';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const npm=process.platform==='win32'?'npm.cmd':'npm';
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(npm,args,{cwd,stdio:'inherit',shell:process.platform==='win32'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Command failed')));});}
async function checkPort() {
 let env = {}; try { env = parse(await readFile(path.join(cwd, '.env'), 'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
 const port = Number(env.PORT || 3001);
 if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT di .env harus angka 1–65535.');
 await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `Port ${port} sedang digunakan. Hentikan server SIGAP lama atau ubah PORT di .env.` : 'Port aplikasi tidak dapat digunakan. Periksa izin jaringan laptop.')));
  probe.listen(port, env.HOST || '127.0.0.1', () => probe.close(resolve));
 });
}
try{await checkPort();await run(['run','setup:xampp','--',...(process.argv.includes('--lan')?['--lan']:[])]);await run(['run','build']);await run(['start']);}catch(error){console.error(error.message);process.exitCode=1;}
