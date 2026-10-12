import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleNotch, Info } from '@phosphor-icons/react';
import { DemoServiceError, getOperationalSnapshot, type OperationalSnapshot, type StaffIdentity } from '../domain/demoService';
const formatCount = (value: string) => new Intl.NumberFormat('id-ID').format(BigInt(value));
const age = (seconds: number | null) => seconds === null ? '—' : `${Math.floor(seconds / 60)} menit`;
const labels: Record<string, string> = { received: 'Diterima', acknowledged: 'Diakui petugas', triaged: 'Ditriase', assigned: 'Ditugaskan internal', in_progress: 'Dalam penanganan', referred: 'Dirujuk', delivery_failed: 'Pengiriman gagal', escalation_pending: 'Menunggu eskalasi', resolved: 'Selesai' };
const signals: Record<string, string> = { queue_overdue: 'Laporan aktif melewati ambang umur antrean', realtime_dead_letter: 'Event realtime berhenti otomatis dan perlu ditinjau', realtime_due_delayed: 'Event realtime melewati waktu percobaan berikutnya' };
interface Props { principal: StaffIdentity; onSessionEnded(): void }
export function StaffMonitoringPage({ principal, onSessionEnded }: Props) {
  const [snapshot, setSnapshot] = useState<OperationalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current; setLoading(true); setError('');
    try {
      const value = await getOperationalSnapshot();
      if (alive.current && version === generation.current) setSnapshot(value);
    } catch (cause) {
      if (alive.current && version === generation.current) {
        if (cause instanceof DemoServiceError && cause.status === 401) onSessionEnded();
        setError(cause instanceof Error ? cause.message : 'Monitoring belum dapat dimuat.');
      }
    } finally { if (alive.current && version === generation.current) setLoading(false); }
  }, [onSessionEnded]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; generation.current++; }; }, [load]);
  const canReview = principal.role === 'operator_admin' || principal.role === 'auditor';
  return <main className="dashboard-page dashboard-landing-style outbox-page monitoring-page">
    <header className="dashboard-header"><Link className="brand" to="/dashboard"><span className="brand-word">SIGAP</span><span className="brand-dot"/><span className="brand-demo">STAGING</span></Link><div className="dashboard-head-actions"><span className="staff-identity">{principal.displayName} · {principal.role}</span><Link className="dashboard-home-link" to="/dashboard">Laporan</Link>{canReview && <Link className="dashboard-home-link" to="/dashboard/realtime">Realtime</Link>}</div></header>
    <div className="dashboard-body"><Link className="text-link" to="/dashboard"><ArrowLeft size={16}/> Kembali ke dashboard</Link>
      <section className="outbox-intro"><p className="eyebrow">MONITORING OPERASIONAL · {principal.regionIds.join(', ')}</p><h1>Antrean terlihat.<br/>Gangguan terpantau.</h1><p>Ringkasan laporan dan event UI pada wilayah akun Anda. Data berasal dari satu snapshot database; tidak memuat isi laporan atau koordinat.</p></section>
      <div className="monitoring-toolbar"><button className="button button-outline" disabled={loading} onClick={() => { void load(); }}>{loading ? 'Memuat…' : 'Segarkan monitoring'}</button><p>{snapshot ? `Snapshot ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Makassar' }).format(new Date(snapshot.sampledAt))} WITA` : 'Belum ada snapshot'}</p></div>
      {error && <div className="editorial-state editorial-error" role="alert"><strong>Keadaan saat ini belum diketahui.</strong><p>{error}</p>{snapshot && <p>Angka di bawah adalah snapshot terakhir yang berhasil dimuat dan belum diperbarui.</p>}</div>}
      {loading && !snapshot && <div className="empty-list-state" role="status"><CircleNotch className="spin" size={25}/>Memuat ringkasan operasional…</div>}
      {snapshot && <div className={error || loading ? 'monitoring-snapshot monitoring-snapshot-stale' : 'monitoring-snapshot'} aria-busy={loading}>
        <p className="staff-policy-note"><Info size={18}/>Ambang staging: laporan aktif {snapshot.thresholds.queueAgeSeconds / 60} menit, keterlambatan event jatuh tempo {snapshot.thresholds.realtimeDueDelaySeconds / 60} menit. Belum merupakan SLA layanan atau alert on-call.</p>
        <section className="monitoring-signals" aria-label="Indikator yang memerlukan perhatian"><p className="eyebrow">PERLU PERHATIAN · SNAPSHOT</p>{snapshot.signals.length === 0 ? <p>Tidak ada kondisi yang melewati ambang pada snapshot ini. Status ini tidak membuktikan seluruh sistem sehat.</p> : snapshot.signals.map(signal => <div className="monitoring-signal" key={signal.code}><strong>{formatCount(signal.count)}</strong><span>{signals[signal.code]}</span></div>)}</section>
        <section className="monitoring-metrics" aria-label="Antrean laporan"><article><span>Laporan aktif</span><strong>{formatCount(snapshot.incidents.active)}</strong><p>Status selesai dan dirujuk dikecualikan.</p></article><article><span>Belum dimiliki petugas</span><strong>{formatCount(snapshot.incidents.unowned)}</strong><p>Bagian dari laporan aktif.</p></article><article><span>Melewati ambang umur</span><strong>{formatCount(snapshot.incidents.overdue)}</strong><p>Umur sejak laporan dibuat.</p></article><article><span>Laporan aktif tertua</span><strong>{age(snapshot.incidents.oldestActiveSeconds)}</strong><p>Tanda — berarti tidak ada laporan aktif.</p></article></section>
        <div className="monitoring-columns"><section className="monitoring-panel"><p className="eyebrow">DISTRIBUSI LAPORAN</p><h2>Setiap status, satu hitungan.</h2><dl>{Object.entries(snapshot.incidents.byStatus).map(([status, value]) => <div key={status}><dt>{labels[status]}</dt><dd>{formatCount(value)}</dd></div>)}</dl><Link className="text-link" to="/dashboard">Buka antrean laporan <ArrowRight size={16}/></Link></section>
        <section className="monitoring-panel"><p className="eyebrow">OUTBOX REALTIME</p><h2>Menunggu hingga diterbitkan.</h2><dl><div><dt>Menunggu / backoff</dt><dd>{formatCount(snapshot.realtime.pending)}</dd></div><div><dt>Sudah jatuh tempo</dt><dd>{formatCount(snapshot.realtime.due)}</dd></div><div><dt>Berhenti otomatis</dt><dd>{formatCount(snapshot.realtime.deadLetter)}</dd></div><div><dt>Keterlambatan jatuh tempo tertua</dt><dd>{age(snapshot.realtime.oldestDueDelaySeconds)}</dd></div><div><dt>Diterima publisher · 15 menit terakhir</dt><dd>{formatCount(snapshot.realtime.publishedLast15Minutes)}</dd></div><div><dt>Total kegagalan pada event tersimpan</dt><dd>{formatCount(snapshot.realtime.totalFailures)}</dd></div></dl><p>Penerimaan publisher adalah hasil emit server. Ini belum membuktikan browser menerima, petugas membaca, atau responder menerima bantuan.</p>{canReview && <Link className="text-link" to="/dashboard/realtime">Tinjau event realtime <ArrowRight size={16}/></Link>}</section></div>
      </div>}
      <p className="dashboard-bottom-note">Monitoring diperbarui saat halaman dibuka atau disegarkan. Belum ada pemantauan latar belakang maupun notifikasi ke petugas on-call.</p>
    </div>
  </main>;
}
