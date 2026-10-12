import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CircleNotch, Info, SignOut, WarningCircle } from '@phosphor-icons/react';
import { changeStaffAccount, createStaffAccount, DemoServiceError, listStaffAccounts, type StaffAccount, type StaffIdentity } from '../domain/demoService';
import { STAFF_ROLES, type StaffRole } from '../shared/staff';

interface Props { principal: StaffIdentity; onSessionEnded(): void; logout(): Promise<void> }
const roleDescriptions: Record<StaffRole, string> = {
  dispatcher: 'Baca dan kerjakan laporan dalam wilayah.',
  supervisor: 'Baca, workflow dan pengelolaan eskalasi dalam wilayah.',
  operator_admin: 'Kelola akun, tangani laporan dan eskalasi, serta baca audit dalam wilayah.',
  auditor: 'Baca laporan dan audit dalam wilayah; tanpa perubahan workflow.',
};

export function StaffAccountsPage({ principal, onSessionEnded, logout }: Props) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<StaffRole>('dispatcher');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const handleFailure = useCallback((cause: unknown) => {
    if (cause instanceof DemoServiceError && cause.status === 401) onSessionEnded();
    return cause instanceof Error ? cause.message : 'Perubahan belum dapat disimpan.';
  }, [onSessionEnded]);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setAccounts(await listStaffAccounts()); }
    catch (cause) { setLoadError(handleFailure(cause)); }
    finally { setLoading(false); }
  }, [handleFailure]);
  useEffect(() => { if (principal.role === 'operator_admin') void load(); }, [load, principal.role]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setActionError(''); setNotice('');
    try { await work(); }
    catch (cause) { setActionError(handleFailure(cause)); }
    finally { lock.current = false; setPending(false); }
  }
  async function change(id: string, action: Parameters<typeof changeStaffAccount>[1], value: unknown) {
    const result = await changeStaffAccount(id, action, value);
    if (result.requiresReauthentication) { onSessionEnded(); return; }
    setAccounts(current => current.map(account => account.id === id ? result.account : account));
    setEditing(null); setResetPassword('');
    setNotice('Perubahan tersimpan dan sesi akun tersebut dicabut. Staff perlu masuk kembali.');
  }
  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { username, displayName, role, password, regionIds: ['local-staging'] };
    // Password is manual-only and cleared from the form before the request; responses
    // contain no verifier or credential, and no generated secret mode is offered.
    setPassword('');
    void run(async () => {
      const created = await createStaffAccount(input);
      setAccounts(current => [...current, created]); setUsername(''); setDisplayName(''); setRole('dispatcher');
      setNotice('Akun individual dibuat. Serahkan kredensial melalui kanal yang disepakati operator.');
    });
  }
  if (principal.role !== 'operator_admin') return <main className="app-page"><div className="page-container not-found-panel"><h1>Akses terbatas.</h1><p>Pengelolaan akun hanya tersedia untuk operator administrator.</p><Link to="/dashboard">Kembali ke dashboard</Link></div></main>;
  return <main className="dashboard-page staff-access-page">
    <header className="dashboard-header">
      <Link className="brand" to="/dashboard">SIGAP<span>STAGING</span></Link>
      <div className="dashboard-head-center">AKSES STAFF <span className="demo-chip">SINTETIS</span></div>
      <div className="dashboard-head-actions"><span className="staff-identity">{principal.displayName} · {principal.role}</span><Link className="dashboard-home-link" to="/dashboard/audit">Audit</Link><button className="icon-button" aria-label="Keluar dari akun staff" disabled={pending} onClick={() => { void run(async () => { await logout(); onSessionEnded(); }); }}><SignOut size={19} /></button></div>
    </header>
    <div className="dashboard-body">
      <Link className="text-link" to="/dashboard"><ArrowLeft size={17} /> Kembali ke laporan</Link>
      <div className="dashboard-title-row"><div><p className="eyebrow">IDENTITAS INDIVIDUAL · LOCAL-STAGING</p><h1>Kelola akses staff.</h1></div><span className="demo-chip">STAGING ONLY</span></div>
      <p className="staff-policy-note"><Info size={18} /> Akun ini hanya untuk simulasi lokal. Wilayah, organisasi, matriks peran, MFA/IdP, recovery dan pemilik provisioning produksi masih memerlukan keputusan operator. Setiap perubahan akses dicatat; minimal satu administrator aktif harus tetap tersedia.</p>
      {actionError && <p className="form-error" role="alert"><WarningCircle size={18} /> {actionError}</p>}
      {notice && <p className="success-note" role="status">{notice}</p>}
      <div className="staff-access-layout">
        <section className="staff-account-list" aria-labelledby="staff-list-title">
          <div className="panel-header"><div><p className="eyebrow">DAFTAR AKUN</p><h2 id="staff-list-title">Staff individual <span>{accounts.length}</span></h2></div><button className="text-link" disabled={loading || pending} onClick={() => { void load(); }}>Muat ulang</button></div>
          {loading ? <div className="empty-list-state" role="status"><CircleNotch size={26} className="spin" /><h3>Memuat akun staff…</h3></div>
            : loadError ? <div className="empty-list-state"><h3>Daftar belum tersedia.</h3><p role="alert">{loadError}</p><button className="button button-outline" onClick={() => { void load(); }}>Coba lagi</button></div>
            : accounts.length === 0 ? <div className="empty-list-state"><h3>Belum ada akun.</h3><p>Akun pertama disiapkan melalui CLI bootstrap administrator.</p></div>
            : accounts.map(account => <article className="staff-account-row" key={account.id}>
              <div><h3>{account.displayName} {account.id === principal.id && <span className="demo-chip">ANDA</span>}</h3><p>@{account.username} · <strong>{account.role}</strong> · {account.active ? 'Aktif' : 'Dinonaktifkan'}</p><small>{account.regionIds.join(', ') || 'Tanpa wilayah'} — {roleDescriptions[account.role]}</small></div>
              <div className="staff-account-actions"><button className="button button-outline" disabled={pending} onClick={() => { setEditing(account); setResetPassword(''); }}>Ubah akses / password</button><button className="button button-outline" disabled={pending} onClick={() => { void run(() => change(account.id, 'active', { active: !account.active })); }}>{account.active ? 'Nonaktifkan' : 'Aktifkan kembali'}</button><button className="text-link" disabled={pending} onClick={() => { void run(() => change(account.id, 'revoke-sessions', undefined)); }}>Cabut semua sesi</button></div>
            </article>)}
        </section>
        <form className="login-card staff-provision-card" onSubmit={submitCreate}>
          <p className="eyebrow">PROVISIONING ADMINISTRATOR</p><h2>Buat akun.</h2><p className="login-help">Password diisi manual. Nilainya tidak ditampilkan kembali setelah pengiriman.</p>
          <label className="form-label" htmlFor="new-staff-username">Username</label><input id="new-staff-username" autoComplete="off" pattern="[a-z0-9][a-z0-9._-]{2,63}" maxLength={64} value={username} onChange={event => setUsername(event.target.value)} required disabled={pending} />
          <label className="form-label" htmlFor="new-staff-name">Nama tampilan</label><input id="new-staff-name" maxLength={100} value={displayName} onChange={event => setDisplayName(event.target.value)} required disabled={pending} />
          <label className="form-label" htmlFor="new-staff-role">Peran staging</label><select id="new-staff-role" value={role} onChange={event => setRole(event.target.value as StaffRole)} disabled={pending}>{STAFF_ROLES.map(item => <option key={item} value={item}>{item}</option>)}</select><small>{roleDescriptions[role]}</small>
          <label className="form-label" htmlFor="new-staff-region">Wilayah</label><select id="new-staff-region" disabled><option>local-staging · sintetis</option></select>
          <label className="form-label" htmlFor="new-staff-password">Password baru · minimal 12 karakter</label><input id="new-staff-password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} required disabled={pending} />
          <button className="button button-dark full-width" disabled={pending || loading} type="submit">{pending ? 'Menyimpan…' : 'Buat akun staff'}</button>
        </form>
      </div>
      {editing && <section className="detail-panel staff-edit-panel" aria-labelledby="edit-staff-title">
        <div className="detail-heading"><div><p className="eyebrow">UBAH AKUN</p><h2 id="edit-staff-title">@{editing.username}</h2></div><button className="text-link" disabled={pending} onClick={() => { setEditing(null); setResetPassword(''); }}>Tutup</button></div>
        <p className="detail-muted">Menyimpan akses atau reset password akan mencabut semua sesi akun ini. Perubahan akun Anda meminta login kembali.</p>
        <form className="staff-edit-form" onSubmit={event => { event.preventDefault(); void run(() => change(editing.id, 'access', { displayName: editing.displayName, role: editing.role, regionIds: editing.regionIds })); }}>
          <label className="form-label">Nama tampilan<input maxLength={100} required value={editing.displayName} disabled={pending} onChange={event => setEditing({ ...editing, displayName: event.target.value })} /></label>
          <label className="form-label">Peran<select value={editing.role} disabled={pending} onChange={event => setEditing({ ...editing, role: event.target.value as StaffRole })}>{STAFF_ROLES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="form-label">Wilayah<select value="local-staging" disabled><option>local-staging</option></select></label>
          <button className="button button-dark" disabled={pending} type="submit">Simpan akses</button>
        </form>
        <form className="staff-reset-form" onSubmit={event => { event.preventDefault(); const nextPassword = resetPassword; setResetPassword(''); void run(() => change(editing.id, 'reset-password', { password: nextPassword })); }}>
          <label className="form-label">Password pengganti<input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={resetPassword} disabled={pending} onChange={event => setResetPassword(event.target.value)} /></label>
          <button className="button button-outline" disabled={pending} type="submit">Reset password dan cabut sesi</button>
        </form>
      </section>}
      <p className="dashboard-bottom-note">Tidak ada registrasi publik atau bantuan darurat nyata. Daftar menampilkan maksimal 500 akun staging.</p>
    </div>
  </main>;
}
