import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleNotch, Info } from '@phosphor-icons/react';
import { DemoServiceError, listOutboxEvents, retryOutboxEvent, type OutboxQueueState, type OutboxReviewItem, type OutboxReviewPage, type StaffIdentity } from '../domain/demoService';
const time=(value:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Makassar'}).format(new Date(value));
interface Props { principal:StaffIdentity; onSessionEnded():void }
export function StaffOutboxPage({principal,onSessionEnded}:Props){
  const [state,setState]=useState<OutboxQueueState>('dead_letter');
  const [cursors,setCursors]=useState<Array<string|undefined>>([undefined]);
  const [page,setPage]=useState<OutboxReviewPage|null>(null);
  const [loading,setLoading]=useState(true);const [pending,setPending]=useState(false);
  const [error,setError]=useState('');const [actionError,setActionError]=useState('');const [notice,setNotice]=useState('');
  const [selected,setSelected]=useState<OutboxReviewItem|null>(null);const [reason,setReason]=useState('');
  const reasonInput=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(selected)reasonInput.current?.focus();},[selected]);
  const generation=useRef(0);const alive=useRef(false);const lock=useRef(false);
  const currentCursor=cursors.at(-1);const canRetry=principal.role==='operator_admin';
  const failure=useCallback((cause:unknown)=>{if(cause instanceof DemoServiceError&&cause.status===401)onSessionEnded();return cause instanceof Error?cause.message:'Permintaan belum dapat diselesaikan.';},[onSessionEnded]);
  const load=useCallback(async()=>{
    const version=++generation.current;setLoading(true);setError('');setSelected(null);setReason('');
    try{const value=await listOutboxEvents(state,currentCursor);if(alive.current&&version===generation.current)setPage(value);}
    catch(cause){if(alive.current&&version===generation.current){setError(failure(cause));setPage(null);}}
    finally{if(alive.current&&version===generation.current)setLoading(false);}
  },[state,currentCursor,failure]);
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;generation.current++;};},[load]);
  async function submit(event:FormEvent){
    event.preventDefault();if(lock.current||!selected||!reason.trim()||!canRetry)return;
    lock.current=true;setPending(true);setActionError('');setNotice('');
    try{await retryOutboxEvent(selected.id,reason.trim());if(alive.current){setNotice('Event dijadwalkan untuk dicoba ulang. Hasil pengiriman belum terkonfirmasi.');await load();}}
    catch(cause){if(alive.current)setActionError(failure(cause));}
    finally{lock.current=false;if(alive.current)setPending(false);}
  }
  const busy=loading||pending;
  return <main className="dashboard-page dashboard-landing-style outbox-page">
    <header className="dashboard-header"><Link className="brand" to="/dashboard"><span className="brand-word">SIGAP</span><span className="brand-dot"/><span className="brand-demo">STAGING</span></Link><div className="dashboard-head-actions"><span className="staff-identity">{principal.displayName} · {principal.role}</span><Link className="dashboard-home-link" to="/dashboard">Laporan</Link><Link className="dashboard-home-link" to="/dashboard/audit">Audit</Link><Link className="dashboard-home-link" to="/dashboard/monitoring">Monitoring</Link>{canRetry&&<Link className="dashboard-home-link" to="/dashboard/operations">Operasional</Link>}</div></header>
    <div className="dashboard-body">
      <Link className="text-link" to="/dashboard"><ArrowLeft size={16}/> Kembali ke dashboard</Link>
      <section className="outbox-intro"><p className="eyebrow">PEMELIHARAAN REALTIME · {principal.regionIds.join(', ')}</p><h1>Pembaruan yang gagal terkirim</h1><p>Kelola event UI yang berhenti dicoba otomatis. Payload, uraian laporan, dan koordinat tidak ditampilkan di antrean ini.</p></section>
      <p className="staff-policy-note"><Info size={18}/>Event berhenti setelah {page?.maxAttempts??8} kegagalan dalam satu siklus. Coba ulang dapat menghasilkan replay; ini tidak mengirim bantuan darurat dan bukan acknowledgment responder.</p>
      <div className="outbox-toolbar"><label>Antrean<select className="editorial-select" value={state} disabled={busy} onChange={e=>{setState(e.target.value as OutboxQueueState);setCursors([undefined]);setActionError('');setNotice('');}}><option value="dead_letter">Gagal · perlu review</option><option value="pending">Menunggu / backoff</option></select></label><button className="button button-outline" disabled={busy} onClick={()=>{void load();}}>{loading?'Memuat…':'Segarkan antrean'}</button><span>{page?.items.length??0} event di halaman ini</span></div>
      {notice&&<p className="success-note" role="status">{notice}</p>}{actionError&&<p className="form-error" role="alert">{actionError}</p>}
      {loading?<div className="empty-list-state" role="status"><CircleNotch size={25} className="spin"/>Memuat metadata antrean…</div>:error?<div className="editorial-state editorial-error" role="alert">{error}<button className="button button-outline" onClick={()=>{void load();}}>Coba muat ulang</button></div>:page?.items.length===0?<div className="outbox-empty"><h2>{state==='dead_letter'?'Tidak ada event yang perlu ditinjau.':'Antrean menunggu kosong.'}</h2><p>Hasil mengikuti wilayah akun dan keadaan antrean saat dimuat.</p></div>:<div className="outbox-events">{page?.items.map(item=><article className="outbox-event" key={item.id}><div><p className="eyebrow">{item.event}</p><h2>{item.id.slice(0,8).toUpperCase()}</h2><p>Laporan {item.incidentId.slice(0,8).toUpperCase()} · {time(item.occurredAt)}</p></div><dl><div><dt>Gagal dalam siklus</dt><dd>{item.attempts} / {page.maxAttempts}</dd></div><div><dt>Total kegagalan</dt><dd>{item.totalFailures}</dd></div><div><dt>Kesalahan terakhir</dt><dd>{item.lastErrorClass??'—'}</dd></div><div><dt>{state==='dead_letter'?'Berhenti otomatis':'Jadwal berikutnya'}</dt><dd>{time(item.deadLetteredAt??item.nextAttemptAt)}</dd></div></dl>{state==='dead_letter'&&canRetry&&<button className="button button-dark" disabled={pending} onClick={()=>{setSelected(item);setReason('');setActionError('');}}>Tinjau retry <ArrowRight size={16}/></button>}</article>)}</div>}
      <div className="queue-pagination"><button className="button button-outline" disabled={busy||cursors.length===1} onClick={()=>setCursors(current=>current.slice(0,-1))}>Sebelumnya</button><span>Halaman {cursors.length}</span><button className="button button-outline" disabled={busy||!page?.nextCursor} onClick={()=>{if(page?.nextCursor)setCursors(current=>[...current,page.nextCursor!]);}}>Berikutnya</button></div>
      {selected&&canRetry&&<form id="outbox-review-panel" className="outbox-review-panel" onSubmit={event=>{void submit(event);}}><p className="eyebrow">REVIEW · {selected.id.slice(0,8).toUpperCase()}</p><h2>Jadwalkan satu siklus baru.</h2><p>Pastikan penyebab kegagalan sudah ditinjau. Riwayat total kegagalan dipertahankan, dan tindakan ini dicatat di audit.</p><label htmlFor="outbox-retry-reason">Alasan peninjauan<textarea ref={reasonInput} id="outbox-retry-reason" className="editorial-input" maxLength={500} rows={3} required disabled={pending} value={reason} onChange={e=>setReason(e.target.value)}/></label><div><button className="button button-primary" type="submit" disabled={pending||!reason.trim()}>{pending?'Menjadwalkan…':'Jadwalkan coba ulang'}</button><button className="button button-outline" type="button" disabled={pending} onClick={()=>setSelected(null)}>Batal</button></div></form>}
      {!canRetry&&<p className="dashboard-bottom-note">Peran auditor hanya membaca metadata antrean. Retry dijadwalkan oleh operator admin.</p>}
    </div>
  </main>;
}
