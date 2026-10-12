import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ArrowRight,CircleNotch,Info} from '@phosphor-icons/react';
import {DemoServiceError,getDispatchDetail,getIncidentForStaff,listDispatchQueue,submitDispatchDraft,type StaffIdentity,type StaffIncident,type DispatchDetail,type DispatchIntent,type DispatchPage,type DispatchScenario,type DispatchStatus} from '../domain/demoService';
import {clearDispatchDraft,prepareDispatchDraft,readDispatchDraft,writeDispatchDraft,type DispatchDraft,type DispatchDraftInput} from '../domain/dispatchDraft';
import {DISPATCH_STATUSES} from '../shared/dispatch';
const labels:Record<DispatchStatus,string>={queued:'Menunggu',sending:'Sedang diproses',accepted:'Diterima adapter lokal',rejected:'Ditolak adapter lokal',retry_wait:'Menunggu coba ulang',unknown:'Hasil belum diketahui',manual_review:'Perlu review supervisor',dead_letter:'Batas retry tercapai',cancelled:'Dibatalkan / review ditutup'};
const time=(value:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Makassar'}).format(new Date(value));
const outcome=(value:string|null)=>value==='transient_failure'?'Gangguan sementara':value==='accepted'?'Diterima simulasi':value==='rejected'?'Ditolak simulasi':value==='unknown'?'Belum pasti':'Belum selesai';
const scenarioLabels:Record<DispatchScenario,string>={accepted:'Diterima simulasi',rejected:'Ditolak · perlu review',transient:'Gangguan sementara · retry terbatas',unknown:'Hasil belum pasti · tanpa retry'};

export function DispatchPendingPayload({draft}:{draft:DispatchDraft}){
 return <p>{draft.action==='create'?`Skenario terkunci: ${scenarioLabels[draft.scenario]}.`:`Alasan terkunci: ${draft.reason}`}</p>;
}

export function DispatchQueueCards({items,selectedId,pending,onSelect}:{items:DispatchIntent[];selectedId:string|null;pending:boolean;onSelect(id:string):void}){
 if(!items.length)return <div className="outbox-empty"><h2>Antrean pengiriman kosong.</h2><p>Hasil mengikuti filter, wilayah akun, dan kepemilikan laporan saat dimuat.</p></div>;
 return <div className="outbox-events">{items.map(item=><article className={`outbox-event dispatch-card ${selectedId===item.id?'dispatch-selected':''}`} key={item.id}>
  <div><span className="dispatch-simulation">SIMULASI</span><h2>{item.id.slice(0,8).toUpperCase()}</h2><p>Laporan {item.incidentId.slice(0,8).toUpperCase()} · {time(item.createdAt)}</p></div>
  <dl><div><dt>Status</dt><dd>{labels[item.status]}</dd></div><div><dt>Percobaan</dt><dd>{item.attemptCount} / 3</dd></div><div><dt>Wilayah</dt><dd>{item.regionId}</dd></div><div><dt>{item.reviewedAt?'Direview':'Jadwal berikutnya'}</dt><dd>{item.reviewedAt?time(item.reviewedAt):item.nextAttemptAt?time(item.nextAttemptAt):'—'}</dd></div></dl>
  <button className="button button-outline" disabled={pending} aria-pressed={selectedId===item.id} onClick={()=>onSelect(item.id)}>Lihat detail <ArrowRight size={16}/></button>
 </article>)}</div>;
}

export function DispatchDetailPanel({detail,canReview,pending,onReview}:{detail:DispatchDetail;canReview:boolean;pending:boolean;onReview(action:'close'|'replay'):void}){
 const close=['unknown','manual_review'].includes(detail.status)&&!detail.reviewedAt,replay=detail.status==='dead_letter'&&!detail.reviewedAt;
 return <section className="dispatch-detail" aria-labelledby="dispatch-detail-title"><p className="eyebrow">DETAIL PENGIRIMAN · {detail.id.slice(0,8).toUpperCase()}</p><span className="dispatch-simulation">SIMULASI</span><h2 id="dispatch-detail-title">{labels[detail.status]}</h2>
  <p>Hasil ini berasal dari adapter lokal. Tidak ada layanan darurat resmi yang menerima pengiriman ini.</p>
  <dl className="dispatch-detail-meta"><div><dt>Laporan</dt><dd>{detail.incidentId.slice(0,12).toUpperCase()}</dd></div><div><dt>Percobaan</dt><dd>{detail.attemptCount} / 3</dd></div><div><dt>Diperbarui</dt><dd>{time(detail.updatedAt)}</dd></div>{detail.replayOf&&<div><dt>Replay dari</dt><dd>{detail.replayOf.slice(0,12).toUpperCase()}</dd></div>}</dl>
  <h3>Riwayat percobaan</h3>{detail.attempts.length?<ol className="dispatch-attempts">{detail.attempts.map(a=><li key={a.attemptNumber}><strong>Percobaan {a.attemptNumber} · {outcome(a.result)}</strong><span>{time(a.startedAt)}{a.finishedAt?` → ${time(a.finishedAt)}`:' · sedang berlangsung'}</span></li>)}</ol>:<p>Belum ada percobaan yang dimulai.</p>}
  <h3>Catatan penerimaan</h3>{detail.acknowledgements.length?<ol className="dispatch-attempts">{detail.acknowledgements.map((a,i)=><li key={i}><strong>{outcome(a.acknowledgement)} · percobaan {a.attemptNumber}</strong><span>{time(a.recordedAt)} · {a.source==='manual'?'Review internal':'Adapter lokal'}</span></li>)}</ol>:<p>Belum ada bukti penerimaan yang dicatat.</p>}
  {detail.status==='unknown'&&<p className="staff-policy-note"><Info size={17}/>Hasil belum pasti. Kirim ulang tidak tersedia; supervisor perlu meninjau sebelum menutup item.</p>}
  {detail.reviewedAt&&<p className="success-note">Review dicatat {time(detail.reviewedAt)}. Riwayat pengiriman tetap disimpan.</p>}
  {canReview&&(close||replay)&&<div className="dispatch-review-actions"><button className="button button-primary" disabled={pending} onClick={()=>onReview(close?'close':'replay')}>{close?'Tutup review':'Tinjau replay'}</button></div>}
 </section>;
}

export function DispatchCreateControls({scenario,disabled,onScenario,onSubmit}:{scenario:DispatchScenario;disabled:boolean;onScenario(value:DispatchScenario):void;onSubmit():void}){
 return <form className="dispatch-create-controls" onSubmit={event=>{event.preventDefault();onSubmit();}}><fieldset disabled={disabled}><legend>Skenario adapter lokal</legend><label htmlFor="dispatch-scenario">Pilih hasil simulasi<select id="dispatch-scenario" className="editorial-select" value={scenario} onChange={e=>onScenario(e.target.value as DispatchScenario)}><option value="accepted">Diterima simulasi</option><option value="rejected">Ditolak · perlu review</option><option value="transient">Gangguan sementara · retry terbatas</option><option value="unknown">Hasil belum pasti · tanpa retry</option></select></label><button type="submit" className="button button-primary" disabled={disabled}>Buat pengiriman lokal <ArrowRight size={16}/></button></fieldset></form>;
}

interface Props{principal:StaffIdentity;onSessionEnded():void}
export function StaffDispatchPage({principal,onSessionEnded}:Props){
 const [params]=useSearchParams();
 const [status,setStatus]=useState<DispatchStatus|''>(''),[cursors,setCursors]=useState<Array<string|undefined>>([undefined]);
 const [page,setPage]=useState<DispatchPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [selectedId,setSelectedId]=useState<string|null>(null),[detail,setDetail]=useState<DispatchDetail|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
 const [incidentId,setIncidentId]=useState(params.get('incidentId')??''),[incident,setIncident]=useState<StaffIncident|null>(null),[incidentLoading,setIncidentLoading]=useState(false),[incidentError,setIncidentError]=useState('');
 const [restored]=useState(()=>{try{return {draft:typeof window==='undefined'?null:readDispatchDraft(window.sessionStorage,principal.id),error:''};}catch(cause){return {draft:null,error:cause instanceof Error?cause.message:'Draft belum tersedia.'};}});
 const [scenario,setScenario]=useState<DispatchScenario>(restored.draft?.action==='create'?restored.draft.scenario:'accepted'),[reviewAction,setReviewAction]=useState<'close'|'replay'|null>(null),[reason,setReason]=useState('');
 const [draft,setDraft]=useState<DispatchDraft|null>(restored.draft),[storageError,setStorageError]=useState(restored.error);
 const [pending,setPending]=useState(false),[actionError,setActionError]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(false),queueGeneration=useRef(0),detailGeneration=useRef(0),incidentGeneration=useRef(0),lock=useRef(false),selectedRef=useRef<string|null>(null),reasonInput=useRef<HTMLTextAreaElement>(null);
 const canReview=principal.role==='supervisor',currentCursor=cursors.at(-1);
 const failure=useCallback((cause:unknown)=>{if(cause instanceof DemoServiceError&&cause.status===401)onSessionEnded();return cause instanceof Error?cause.message:'Permintaan belum dapat dikonfirmasi.';},[onSessionEnded]);
 const load=useCallback(async()=>{const version=++queueGeneration.current;setLoading(true);setError('');try{const value=await listDispatchQueue(status||undefined,currentCursor);if(alive.current&&version===queueGeneration.current)setPage(value);}catch(cause){if(alive.current&&version===queueGeneration.current)setError(failure(cause));}finally{if(alive.current&&version===queueGeneration.current)setLoading(false);}},[status,currentCursor,failure]);
 const loadDetail=useCallback(async(id:string)=>{const version=++detailGeneration.current;setDetailLoading(true);setDetailError('');try{const value=await getDispatchDetail(id);if(alive.current&&version===detailGeneration.current)setDetail(value);}catch(cause){if(alive.current&&version===detailGeneration.current){setDetail(null);setDetailError(failure(cause));}}finally{if(alive.current&&version===detailGeneration.current)setDetailLoading(false);}},[failure]);
 const loadIncident=useCallback(async(id:string)=>{const version=++incidentGeneration.current;setIncidentLoading(true);setIncidentError('');setIncident(null);try{const value=await getIncidentForStaff(id);if(alive.current&&version===incidentGeneration.current)setIncident(value);}catch(cause){if(alive.current&&version===incidentGeneration.current)setIncidentError(failure(cause));}finally{if(alive.current&&version===incidentGeneration.current)setIncidentLoading(false);}},[failure]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;queueGeneration.current++;detailGeneration.current++;incidentGeneration.current++;};},[load]);
 useEffect(()=>{if(selectedId){selectedRef.current=selectedId;void loadDetail(selectedId);}else{selectedRef.current=null;setDetail(null);}},[selectedId,loadDetail]);
 useEffect(()=>{const id=params.get('incidentId');if(id)void loadIncident(id);},[params,loadIncident]);
 useEffect(()=>{const timer=window.setInterval(()=>{if(document.visibilityState==='visible'&&!lock.current){void load();if(selectedRef.current)void loadDetail(selectedRef.current);}},5000);return()=>window.clearInterval(timer);},[load,loadDetail]);
 useEffect(()=>{if(reviewAction)reasonInput.current?.focus();},[reviewAction]);
 const eligible=incident&&incident.ownerStaffId===principal.id&&['triaged','assigned','in_progress'].includes(incident.status)&&(!incident.withdrawalRequestedAt||incident.withdrawalDecision?.outcome==='denied');
 const reviewEligible=detail&&canReview&&!detail.reviewedAt&&(reviewAction==='close'?['unknown','manual_review'].includes(detail.status):detail.status==='dead_letter');
 async function execute(task:DispatchDraft){
  if(lock.current)return;lock.current=true;setPending(true);setActionError('');setNotice('');
  try{
   writeDispatchDraft(window.sessionStorage,principal.id,task);setDraft(task);
   const result=await submitDispatchDraft(task);if(!alive.current)return;
   setNotice(`Server mengonfirmasi: ${labels[result.status]}. Pengiriman tetap simulasi lokal.`);
   try{clearDispatchDraft(window.sessionStorage,principal.id);setDraft(null);setStorageError('');}catch(cause){setActionError(cause instanceof Error?cause.message:'Draft belum dapat dihapus.');}
   setReviewAction(null);setReason('');setSelectedId(result.id);await loadDetail(result.id);await load();
  }catch(cause){if(alive.current)setActionError(failure(cause));}finally{lock.current=false;if(alive.current)setPending(false);}
 }
 function begin(input:DispatchDraftInput){if(lock.current||draft||storageError)return;try{void execute(prepareDispatchDraft(input));}catch(cause){setActionError(failure(cause));}}
 function choose(id:string){if(pending)return;detailGeneration.current++;setDetail(null);setDetailError('');setSelectedId(id);setReviewAction(null);setReason('');setActionError('');if(selectedId===id)void loadDetail(id);}
 function review(event:FormEvent){event.preventDefault();if(detail&&reviewAction&&reviewEligible&&reason.trim())begin({action:reviewAction,targetId:detail.id,reason});}
 function discard(){if(pending)return;try{clearDispatchDraft(window.sessionStorage,principal.id);setDraft(null);setStorageError('');setActionError('');}catch(cause){setStorageError(failure(cause));}}
 const busy=loading||pending;
 return <main className="dashboard-page dashboard-landing-style outbox-page dispatch-page"><header className="dashboard-header"><Link className="brand" to="/dashboard"><span className="brand-word">SIGAP</span><span className="brand-dot"/><span className="brand-demo">LAPORAN</span></Link><div className="dashboard-head-actions"><span className="staff-identity">{principal.displayName} · {principal.role}</span><Link className="dashboard-home-link" to="/dashboard">Laporan</Link><Link className="dashboard-home-link" to="/dashboard/monitoring">Monitoring</Link></div></header>
  <div className="dashboard-body"><Link className="text-link" to="/dashboard"><ArrowLeft size={16}/> Kembali ke dashboard</Link><section className="outbox-intro"><p className="eyebrow">PENGIRIMAN INTERNAL · {principal.regionIds.join(', ')}</p><h1>Pengiriman internal</h1><p>Pantau antrean, riwayat percobaan, dan item yang memerlukan review. Adapter lokal berlabel simulasi; layanan darurat resmi belum terhubung.</p></section>
   {(draft||storageError)&&<section className="dispatch-pending editorial-state" role="status"><strong>{draft?'Percobaan belum ditutup di browser.':'Draft retry belum dapat dibaca.'}</strong><p>{storageError||`Aksi ${draft?.action} · ${draft?.targetId}. Retry memakai key dan payload yang sama. Tinjau antrean sebelum melepas percobaan ini.`}</p>{draft&&<DispatchPendingPayload draft={draft}/>} {draft&&<button className="button button-primary" disabled={pending||(draft.action!=='create'&&!canReview)} onClick={()=>{if(draft)void execute(draft);}}>{pending?'Mengirim…':'Kirim ulang percobaan yang sama'}</button>}<button className="button button-outline" disabled={pending} onClick={discard}>Saya sudah meninjau antrean, hapus draft</button></section>}
   {notice&&<p className="success-note" role="status">{notice}</p>}{actionError&&<p className="form-error" role="alert">{actionError}</p>}
   <section className="dispatch-create-panel" aria-labelledby="dispatch-create-title"><p className="eyebrow">BUAT PENGIRIMAN</p><h2 id="dispatch-create-title">Buat pengiriman</h2><form className="dispatch-incident-search" onSubmit={e=>{e.preventDefault();if(incidentId.trim())void loadIncident(incidentId.trim());}}><label htmlFor="dispatch-incident-id">ID laporan<input id="dispatch-incident-id" className="editorial-input" maxLength={128} value={incidentId} disabled={pending||!!draft} onChange={e=>{incidentGeneration.current++;setIncidentId(e.target.value);setIncident(null);setIncidentLoading(false);setIncidentError('');}} required/></label><button className="button button-outline" disabled={pending||!!draft||incidentLoading||!incidentId.trim()}>{incidentLoading?'Memuat…':'Periksa laporan'}</button></form>
    {incidentError&&<p className="form-error" role="alert">{incidentError}</p>}{incident&&<p className="staff-policy-note">Laporan {incident.id.slice(0,12).toUpperCase()} · status {incident.status}. {eligible?'Laporan memenuhi syarat pengiriman internal.':'Klaim laporan dan lakukan triase di dashboard; permintaan stop yang belum selesai membatasi pengiriman.'}</p>}
    <DispatchCreateControls scenario={scenario} disabled={!eligible||pending||!!draft||!!storageError||incidentLoading} onScenario={setScenario} onSubmit={()=>{if(incident&&eligible)begin({action:'create',targetId:incident.id,scenario});}}/>
   </section>
   <div className="outbox-toolbar"><label>Status<select className="editorial-select" value={status} disabled={pending} onChange={e=>{setStatus(e.target.value as DispatchStatus|'');setCursors([undefined]);}}><option value="">Semua status</option>{DISPATCH_STATUSES.map(s=><option value={s} key={s}>{labels[s]}</option>)}</select></label><button className="button button-outline" disabled={busy} onClick={()=>{void load();if(selectedId)void loadDetail(selectedId);}}>{loading?'Memuat…':'Segarkan'}</button><span>{page?.items.length??0} item di halaman ini · diperbarui setiap 5 detik saat tab terlihat</span></div>
   {error&&<div className="editorial-state editorial-error" role="alert"><strong>Antrean belum diperbarui.</strong><p>{error}</p>{page&&<small>Data di bawah adalah hasil terakhir yang berhasil dimuat.</small>}</div>}
   {loading&&!page?<div className="empty-list-state" role="status"><CircleNotch className="spin" size={25}/>Memuat antrean pengiriman…</div>:page&&<DispatchQueueCards items={page.items} selectedId={selectedId} pending={pending} onSelect={choose}/>}
   <div className="queue-pagination"><button className="button button-outline" disabled={busy||cursors.length===1} onClick={()=>setCursors(v=>v.slice(0,-1))}>Sebelumnya</button><span>Halaman {cursors.length}</span><button className="button button-outline" disabled={busy||!page?.nextCursor} onClick={()=>{if(page?.nextCursor)setCursors(v=>[...v,page.nextCursor!]);}}>Berikutnya</button></div>
   {detailLoading&&!detail&&<p role="status">Memuat detail pengiriman…</p>}{detailError&&<p className="form-error" role="alert">{detailError}</p>}
   {detail&&<DispatchDetailPanel detail={detail} canReview={canReview&&!draft&&!storageError} pending={pending} onReview={action=>{setReviewAction(action);setReason('');}}/>}
   {reviewAction&&detail&&!draft&&<form className="outbox-review-panel" onSubmit={review}><p className="eyebrow">REVIEW SUPERVISOR</p><h2>{reviewAction==='close'?'Tutup item yang telah ditinjau.':'Buat satu intent replay tertaut.'}</h2><p>{reviewAction==='close'?'Penutupan tidak mengubah hasil sebelumnya menjadi bukti pengiriman.':'Hanya retry gangguan sementara yang habis dapat direplay. Riwayat lama tetap disimpan.'}</p><label htmlFor="dispatch-review-reason">Alasan review<textarea ref={reasonInput} id="dispatch-review-reason" className="editorial-input" rows={3} maxLength={500} required disabled={pending} value={reason} onChange={e=>setReason(e.target.value)}/></label><div><button className="button button-primary" disabled={pending||!reviewEligible||!reason.trim()}>{pending?'Menyimpan…':reviewAction==='close'?'Simpan penutupan review':'Buat replay'}</button><button type="button" className="button button-outline" disabled={pending} onClick={()=>setReviewAction(null)}>Batal</button></div></form>}
  </div></main>;
}
