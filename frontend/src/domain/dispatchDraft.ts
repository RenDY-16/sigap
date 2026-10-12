import {DISPATCH_SCENARIOS,type DispatchScenario} from '../shared/dispatch';
export type DispatchDraftInput={action:'create';targetId:string;scenario:DispatchScenario}|{action:'close'|'replay';targetId:string;reason:string};
export type DispatchDraft=DispatchDraftInput&{version:1;key:string};
const storageKey=(staffId:string)=>'sigap.dispatch.pending.v1.'+encodeURIComponent(staffId);
function validate(value:unknown):DispatchDraft{
 if(!value||typeof value!=='object')throw new Error('Draft pengiriman tidak valid.');
 const v=value as Record<string,unknown>,create=v.action==='create';
 if(v.version!==1||typeof v.targetId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v.targetId)||typeof v.key!=='string'||!/^[0-9a-f]{64}$/.test(v.key)||
  Object.keys(v).sort().join()!==(create?'action,key,scenario,targetId,version':'action,key,reason,targetId,version'))throw new Error('Draft pengiriman tidak valid.');
 if(create){if(typeof v.scenario!=='string'||!DISPATCH_SCENARIOS.includes(v.scenario as DispatchScenario))throw new Error('Draft skenario tidak valid.');}
 else if(!['close','replay'].includes(String(v.action))||typeof v.reason!=='string'||!v.reason||v.reason!==v.reason.trim()||v.reason.length>500)throw new Error('Draft review tidak valid.');
 return value as DispatchDraft;
}
export function prepareDispatchDraft(input:DispatchDraftInput):DispatchDraft{
 const bytes=crypto.getRandomValues(new Uint8Array(32)),key=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return validate({...input,...(input.action==='create'?{}:{reason:input.reason.trim()}),version:1,key});
}
export function readDispatchDraft(storage:Pick<Storage,'getItem'>,staffId:string):DispatchDraft|null{
 try{const raw=storage.getItem(storageKey(staffId));return raw===null?null:validate(JSON.parse(raw));}
 catch{throw new Error('Percobaan pengiriman tersimpan tidak dapat dibaca. Periksa antrean sebelum membuat percobaan baru.');}
}
export function writeDispatchDraft(storage:Pick<Storage,'setItem'>,staffId:string,draft:DispatchDraft):void{
 validate(draft);
 try{storage.setItem(storageKey(staffId),JSON.stringify(draft));}
 catch{throw new Error('Browser belum dapat menyimpan key retry. Pengiriman belum dilakukan.');}
}
export function clearDispatchDraft(storage:Pick<Storage,'removeItem'>,staffId:string):void{
 try{storage.removeItem(storageKey(staffId));}
 catch{throw new Error('Draft retry belum dapat dihapus dari browser.');}
}
