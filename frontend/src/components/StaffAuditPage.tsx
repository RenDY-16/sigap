import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CircleNotch, Info, SignOut } from '@phosphor-icons/react';
import { DemoServiceError, listIncidentAudit, listStaffAdminAudit, type IncidentAuditEntry, type StaffAdminAuditEntry, type StaffIdentity } from '../domain/demoService';

interface Props { principal: StaffIdentity; onSessionEnded(): void; logout(): Promise<void> }
interface Feed<T> { rows: T[]; loading: boolean; error: string }
const time = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Makassar' }).format(new Date(value));
const actor = (id: string | null) => id ? `Staff ${id.slice(0, 8)}` : 'Sistem / bootstrap CLI';
const labels: Record<string, string> = {
  'bootstrap_first_admin': 'Administrator pertama dibuat', 'staff:create': 'Akun staff dibuat',
  'staff:update_access': 'Peran / wilayah staff diubah', 'staff:disable': 'Akun dinonaktifkan',
  'staff:enable': 'Akun diaktifkan kembali', 'staff:reset_password': 'Password direset',
  'staff:revoke_sessions': 'Semua sesi akun dicabut', 'staff:list': 'Daftar akun diakses',
  'staff:audit_access_attempt': 'Audit akses staff diminta',
  'incident:list_access_attempt': 'Daftar laporan diminta', 'incident:detail_access_attempt': 'Detail laporan diminta',
  'incident:audit_access_attempt': 'Audit laporan diminta', 'incident:status:updated': 'Status laporan diubah',
  'incident:location:updated': 'Lokasi laporan diubah', 'incident:withdrawal:requested': 'Penghentian tracking diminta',
  'incident:realtime_delivery_attempt': 'Pengiriman realtime dicoba',
};

export function StaffAuditPage({ principal, onSessionEnded, logout }: Props) {
  const [incidentFeed, setIncidentFeed] = useState<Feed<IncidentAuditEntry>>({ rows: [], loading: true, error: '' });
  const [staffFeed, setStaffFeed] = useState<Feed<StaffAdminAuditEntry>>({ rows: [], loading: true, error: '' });
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const generation = useRef(0);
  const logoutLock = useRef(false);
  const permitted = principal.role === 'auditor' || principal.role === 'operator_admin';
  const load = useCallback(async () => {
    const current = ++generation.current;
    setIncidentFeed({ rows: [], loading: true, error: '' }); setStaffFeed({ rows: [], loading: true, error: '' });
    const [incidents, staff] = await Promise.allSettled([listIncidentAudit(), listStaffAdminAudit()]);
    if (current !== generation.current) return;
    for (const result of [incidents, staff]) {
      if (result.status === 'rejected' && result.reason instanceof DemoServiceError && result.reason.status === 401) { onSessionEnded(); return; }
    }
    setIncidentFeed(incidents.status === 'fulfilled' ? { rows: incidents.value, loading: false, error: '' } : { rows: [], loading: false, error: incidents.reason instanceof Error ? incidents.reason.message : 'Aktivitas laporan belum dapat dimuat.' });
    setStaffFeed(staff.status === 'fulfilled' ? { rows: staff.value, loading: false, error: '' } : { rows: [], loading: false, error: staff.reason instanceof Error ? staff.reason.message : 'Audit administrasi staff belum dapat dimuat.' });
  }, [onSessionEnded]);
  useEffect(() => { if (permitted) void load(); return () => { generation.current += 1; }; }, [load, permitted]);
  async function handleLogout() {
    if (logoutLock.current) return;
    logoutLock.current = true; setLoggingOut(true); setLogoutError('');
    try { await logout(); onSessionEnded(); }
    catch (cause) { setLogoutError(cause instanceof Error ? cause.message : 'Logout belum dapat diselesaikan.'); }
    finally { logoutLock.current = false; setLoggingOut(false); }
  }
  if (!permitted) return <main className="app-page"><div className="page-container not-found-panel"><h1>Akses audit terbatas.</h1><Link to="/dashboard">Kembali ke dashboard</Link></div></main>;
  const busy = incidentFeed.loading || staffFeed.loading;
  return <main className="dashboard-page staff-audit-page">
    <header className="dashboard-header">
      <Link className="brand" to="/dashboard">SIGAP<span>STAGING</span></Link>
      <div className="dashboard-head-center">AUDIT WILAYAH <span className="demo-chip">BACA SAJA</span></div>
      <div className="dashboard-head-actions"><span className="staff-identity">{principal.displayName} · {principal.role}</span>{principal.role === 'operator_admin' && <Link className="dashboard-home-link" to="/dashboard/accounts">Akses staff</Link>}<button className="icon-button" aria-label="Keluar dari akun staff" disabled={loggingOut} onClick={() => { void handleLogout(); }}><SignOut size={19} /></button></div>
    </header>
    <div className="dashboard-body">
      <Link className="text-link" to="/dashboard"><ArrowLeft size={17} /> Kembali ke laporan</Link>
      <div className="dashboard-title-row"><div><p className="eyebrow">REKAM JEJAK · {principal.regionIds.join(', ')}</p><h1>Audit aktivitas.</h1></div><button className="button button-outline" disabled={busy || loggingOut} onClick={() => { void load(); }}>{busy ? 'Memuat audit…' : 'Muat ulang audit'}</button></div>
      <p className="staff-policy-note"><Info size={18} /> Hanya data dari wilayah akun Anda yang ditampilkan. Catatan akses dan pengiriman adalah upaya server, bukan bukti seseorang telah membaca laporan. Halaman ini hanya membaca audit; semua waktu menggunakan WITA.</p>
      <p className="staff-policy-note">Staging sintetis. Data produksi, kebijakan retensi, organisasi, wilayah nyata dan otorisasi audit masih memerlukan keputusan operator. Password, verifier dan isi sesi tidak ditampilkan.</p>
      {logoutError && <p className="form-error" role="alert">{logoutError}</p>}
      <div className="audit-sections">
        <section className="staff-account-list audit-section" aria-labelledby="incident-audit-title">
          <div className="panel-header"><div><p className="eyebrow">AKTIVITAS LAPORAN</p><h2 id="incident-audit-title">Kejadian dan akses laporan</h2></div><span className="demo-chip">{incidentFeed.rows.length} CATATAN</span></div>
          {incidentFeed.loading ? <div className="empty-list-state" role="status"><CircleNotch className="spin" size={26} /><h3>Memuat aktivitas laporan…</h3></div> : incidentFeed.error ? <div className="empty-list-state"><h3>Aktivitas belum tersedia.</h3><p role="alert">{incidentFeed.error}</p><button className="text-link" onClick={() => { void load(); }}>Coba lagi</button></div> : !incidentFeed.rows.length ? <div className="empty-list-state"><h3>Belum ada aktivitas laporan.</h3><p>Catatan muncul saat laporan dalam wilayah ini diakses atau diperbarui.</p></div> : <ol className="audit-event-list">{incidentFeed.rows.map(entry => <li className="audit-event-row" key={entry.id}>
            <div className="audit-event-heading"><h3 title={entry.event}>{labels[entry.event] ?? entry.event}</h3><time dateTime={entry.occurred_at}>{time(entry.occurred_at)} WITA</time></div>
            <p>Laporan <strong>{entry.incident_id.slice(0, 12).toUpperCase()}</strong> · <span title={entry.staff_id ?? undefined}>{entry.actor_kind === 'staff' ? actor(entry.staff_id) : entry.actor_kind === 'citizen' ? 'Pelapor' : 'Sistem'}</span></p>
            {Object.keys(entry.details).length > 0 && <details><summary>Rincian catatan</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details>}
          </li>)}</ol>}
        </section>
        <section className="staff-account-list audit-section" aria-labelledby="staff-audit-title">
          <div className="panel-header"><div><p className="eyebrow">ADMINISTRASI AKSES STAFF</p><h2 id="staff-audit-title">Akun, peran, wilayah dan pencabutan</h2></div><span className="demo-chip">{staffFeed.rows.length} CATATAN</span></div>
          {staffFeed.loading ? <div className="empty-list-state" role="status"><CircleNotch className="spin" size={26} /><h3>Memuat audit akses staff…</h3></div> : staffFeed.error ? <div className="empty-list-state"><h3>Audit akses belum tersedia.</h3><p role="alert">{staffFeed.error}</p><button className="text-link" onClick={() => { void load(); }}>Coba lagi</button></div> : !staffFeed.rows.length ? <div className="empty-list-state"><h3>Belum ada administrasi akses staff.</h3><p>Perubahan akun dalam wilayah ini dicatat di sini.</p></div> : <ol className="audit-event-list">{staffFeed.rows.map(entry => <li className="audit-event-row" key={entry.id}>
            <div className="audit-event-heading"><h3 title={entry.action}>{labels[entry.action] ?? entry.action}</h3><time dateTime={entry.occurredAt}>{time(entry.occurredAt)} WITA</time></div>
            <p><span title={entry.actorStaffId ?? undefined}>{actor(entry.actorStaffId)}</span>{entry.targetStaffId && <> → <span title={entry.targetStaffId}>Akun {entry.targetStaffId.slice(0, 8)}</span></>} · {entry.regionId}</p>
            {Object.keys(entry.details).length > 0 && <details><summary>Rincian peran / wilayah</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details>}
          </li>)}</ol>}
        </section>
      </div>
      <p className="dashboard-bottom-note">Setiap bagian menampilkan maksimal 100 catatan terbaru dalam wilayah Anda. Akses audit juga dicatat oleh server.</p>
    </div>
  </main>;
}
