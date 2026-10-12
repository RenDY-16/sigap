import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const npm=process.platform==='win32'?'npm.cmd':'npm';
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(npm,args,{cwd,stdio:'inherit',shell:process.platform==='win32'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Command failed')));});}
try{await run(['run','setup:xampp','--',...(process.argv.includes('--lan')?['--lan']:[])]);await run(['run','build']);await run(['start']);}catch{process.exitCode=1;}
