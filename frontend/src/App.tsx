import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  CircleNotch,
  Clock,
  Crosshair,
  Info,
  MapPin,
  MapTrifold,
  NavigationArrow,
  Pulse,
  ShieldCheck,
  SignOut,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assignIncidentUnit,
  requestWithdrawal,
  DemoServiceError,
  clearPendingCreate,
  createIncident,
  DEMO_UNITS,
  getIncidentByToken,
  getPendingCreateDraft,
  listIncidentsForStaff,
  getIncidentForStaff,
  getPublicOperationsConfig,
  getOperationsConfig,
  getOperationsWorkConfig,
  updateOperationsConfig,
  changeIncidentOwnership,
  decideIncidentWithdrawal,
  type StaffIdentity,
  loginStaff,
  logoutStaff,
  preparePendingCreate,
  restoreStaffSession,
  setSimulationLocation,
  setIncidentStatus,
  type DemoUnitId,
  type CreateIncidentInput,
  type GeoPoint,
  type Incident,
  type IncidentStatus,
  type LocationSource,
  type StaffIncident,
  type PendingCreateDraft,
  type StaffQueueFilters,
  type OperationsConfiguration,
  type OperationsWorkConfiguration,
  type OperationsConfigurationInput,
  type PublicOperationsConfiguration,
} from "./domain/demoService";
import type { RequiredIncidentField } from "./shared/operations";
import { connectCitizenSocket, connectStaffSocket, hasSeenOutboxEvent, type RealtimeEvent } from "./realtime/socketClient";
import { StaffAuditPage } from "./components/StaffAuditPage";
import { StaffMonitoringPage } from "./components/StaffMonitoringPage";
import { StaffOutboxPage } from "./components/StaffOutboxPage";
import { StaffDispatchPage } from "./components/StaffDispatchPage";
import { StaffAccountsPage } from "./components/StaffAccountsPage";
import { MapView } from "./components/MapView";
import { CityScene } from "./scene/CityScene";
import { useLandingScrollScene } from "./scene/useLandingScrollScene";

interface DemoContextValue {
  isStaff: boolean;
  principal: StaffIdentity | null;
  authChecking: boolean;
  authError: string;
  login(username: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  markStaffLoggedOut(): void;
  citizenPath: string | null;
  setCitizenPath(path: string): void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

function DemoProvider({ children }: PropsWithChildren) {
  const [authChecking, setAuthChecking] = useState(true);
  const [principal, setPrincipal] = useState<StaffIdentity | null>(null);
  const isStaff = Boolean(principal);
  const [authError, setAuthError] = useState("");
  const [citizenPath, setCitizenPath] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void restoreStaffSession()
      .then((authenticated) => {
        if (!active) return;
        setPrincipal(authenticated);
        setAuthError("");
      })
      .catch((cause) => {
        if (!active) return;
        setPrincipal(null);
        setAuthError(cause instanceof Error ? cause.message : "Sesi petugas belum dapat dipulihkan.");
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const authenticated = await loginStaff(username, password);
    setPrincipal(authenticated);
    setAuthError(authenticated ? "" : "Server tidak mengonfirmasi sesi petugas.");
    return Boolean(authenticated);
  }, []);

  const logout = useCallback(async () => {
    await logoutStaff();
    setPrincipal(null);
    setAuthError("");
  }, []);

  const markStaffLoggedOut = useCallback(() => {
    setPrincipal(null);
    setAuthError("");
  }, []);
  const value = useMemo(
    () => ({ isStaff, principal, authChecking, authError, login, logout, markStaffLoggedOut, citizenPath, setCitizenPath }),
    [isStaff, principal, authChecking, authError, login, logout, markStaffLoggedOut, citizenPath],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("DemoProvider belum terpasang.");
  return context;
}

const STATUS_LABEL: Record<IncidentStatus, string> = {
  received: "Laporan diterima",
  acknowledged: "Diakui petugas",
  triaged: "Ditinjau petugas",
  assigned: "Unit simulasi ditetapkan",
  in_progress: "Simulasi berlangsung",
  referred: "Dirujuk dalam simulasi",
  delivery_failed: "Pengiriman simulasi gagal",
  escalation_pending: "Menunggu eskalasi petugas",
  resolved: "Simulasi selesai",
};

const STATUS_HELP: Record<IncidentStatus, string> = {
  received: "Laporan tersimpan di server lokal dan menunggu peninjauan petugas.",
  acknowledged: "Petugas mencatat bahwa laporan sudah ditinjau.",
  triaged: "Petugas sudah melakukan triase laporan.",
  assigned: "Pilihan unit dicatat secara internal; tidak ada unit nyata yang dikirim.",
  in_progress: "Alur penanganan simulasi sedang berlangsung.",
  referred: "Alur simulasi ditutup dengan status rujukan; tidak ada layanan eksternal yang diberi tahu.",
  delivery_failed: "Pengiriman pada alur simulasi gagal; status ini bukan kegagalan layanan darurat nyata.",
  escalation_pending: "Laporan menunggu tindakan eskalasi petugas.",
  resolved: "Alur penanganan ditandai selesai oleh petugas.",
};

const STATUS_ORDER: IncidentStatus[] = ["received", "acknowledged", "triaged", "assigned", "in_progress", "resolved"];

function DemoNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`demo-notice ${compact ? "demo-notice-compact" : ""}`} role="note">
      <Info size={18} weight="fill" aria-hidden="true" />
      <span>Laporan ini tersimpan di server lokal dan belum terhubung ke layanan darurat resmi.</span>
    </div>
  );
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link to="/" className={`brand ${inverse ? "brand-inverse" : ""}`} aria-label="SIGAP, halaman utama">
      <span className="brand-word">SIGAP</span>
      <span className="brand-dot" aria-hidden="true" />
      <span className="brand-demo">LAPORAN</span>
    </Link>
  );
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

function LocationSourceLabel({ source }: { source: LocationSource }) {
  return (
    <span className={`source-label source-${source}`}>
      {source === "gps" ? <Crosshair size={15} aria-hidden="true" /> : <MapPin size={15} aria-hidden="true" />}
      {source === "gps" ? "GPS perangkat" : "Lokasi simulasi"}
    </span>
  );
}

function LandingPage() {
  const { progress, activeChapter, reducedMotion, footerVisible } = useLandingScrollScene();
  const steps = [
    { id: "kenali", label: "Kenali" },
    { id: "laporkan", label: "Laporkan" },
    { id: "pantau", label: "Pantau" },
    { id: "selesai", label: "Selesai" },
  ];

  return (
    <main className="landing-page">
      <div className="landing-scene-stage" aria-hidden="true">
        <CityScene progress={progress} reducedMotion={reducedMotion} />
      </div>
      <div className="landing-scene-wash" aria-hidden="true" />
      <header className="landing-header">
        <Brand />
        <nav className="landing-nav" aria-label="Navigasi utama">
          <a href="#alur-sos">Cara melapor</a>
          <Link to="/dashboard/login">Masuk petugas</Link>
        </nav>
      </header>

      <section className="landing-hero" id="kenali" data-landing-chapter="kenali" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-kicker" aria-hidden="true"><span /></span>
          <h1 id="hero-title">Lokasi jelas.<br />Laporan terarah.</h1>
          <p>Pelaporan insiden keamanan dengan lokasi yang jelas dan status yang terpantau.</p>
          <Link className="button button-primary hero-cta" to="/report/new">
            Buat laporan <ArrowRight size={21} weight="bold" aria-hidden="true" />
          </Link>
          <p className="hero-assurance">Tersimpan di server lokal <span>·</span> Belum terhubung ke layanan darurat resmi</p>
        </div>
        <a className="scroll-cue" href="#alur-sos">
          <span className="scroll-cue-icon"><ArrowDown size={19} aria-hidden="true" /></span>
          <span>Gulir untuk menjelajahi</span>
        </a>
      </section>

      <div className="journey-progress" hidden={footerVisible} aria-label={`Tahap aktif: ${steps.find((step) => step.id === activeChapter)?.label}`}>
        {steps.map((step, index) => (
          <a
            key={step.id}
            className={`journey-step ${activeChapter === step.id ? "is-active" : ""} ${steps.findIndex((item) => item.id === activeChapter) > index ? "is-complete" : ""}`}
            href={step.id === "kenali" ? "#kenali" : `#${step.id}`}
            aria-current={activeChapter === step.id ? "step" : undefined}
          >
            <span className="journey-step-label">{step.label}</span>
            <span className="journey-step-track"><span /></span>
          </a>
        ))}
      </div>

      <section className="journey-intro" id="alur-sos" aria-labelledby="journey-title">
        <p className="eyebrow">ALUR PELAPORAN</p>
        <h2 id="journey-title">Cara membuat laporan</h2>
        <p>Isi kejadian, bagikan lokasi, lalu simpan tautan untuk melihat pembaruan laporan.</p>
      </section>

      <section className="story-chapter story-chapter-report" id="laporkan" data-landing-chapter="laporkan">
        <div className="story-card">
          <span className="story-index">01 <span>— LAPORKAN</span></span>
          <h2>Isi laporan</h2>
          <p>Isi deskripsi singkat, lalu gunakan GPS perangkat setelah laporan aktif atau pilih titik simulasi sendiri.</p>
          <Link to="/report/new" className="text-link">Lihat form laporan <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
        <div className="story-note"><MapPin size={20} /><span>Sumber lokasi selalu ditandai di setiap tahap.</span></div>
      </section>

      <section className="story-chapter story-chapter-track" id="pantau" data-landing-chapter="pantau">
        <div className="story-card story-card-right">
          <span className="story-index">02 <span>— PANTAU</span></span>
          <h2>Pantau status</h2>
          <p>Simpan tautan laporan untuk melihat lokasi dan pembaruan dari petugas.</p>
          
        </div>
        <div className="story-note story-note-right"><Pulse size={20} /><span>Unit dan progres di layar adalah simulasi.</span></div>
      </section>

      <section className="story-chapter story-chapter-finish" id="selesai" data-landing-chapter="selesai">
        <div className="story-card">
          <span className="story-index">03 <span>— SELESAI</span></span>
          <h2>Kendalikan berbagi lokasi</h2>
          <p>Warga dapat meminta penghentian laporan. Pelacakan GPS juga berhenti saat laporan selesai atau koneksi terputus.</p>
          <Link to="/report/new" className="button button-dark">Buat laporan <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
        <DemoNotice compact />
      </section>

      <footer className="landing-footer"><Brand /><span>Server lokal · belum terhubung ke layanan darurat resmi.</span></footer>
    </main>
  );
}

function AppHeader({ title, backTo = "/" }: { title: string; backTo?: string }) {
  return (
    <header className="app-header">
      <Link to={backTo} className="back-link"><ArrowLeft size={18} aria-hidden="true" /> Kembali</Link>
      <Brand />
      <span className="app-header-title">{title}</span>
    </header>
  );
}

function LocationPicker({ selected, onSelect }: { selected: GeoPoint | null; onSelect(point: GeoPoint): void }) {
  return (
    <div className="location-picker-shell">
      <div className="location-picker-map">
        <MapView selected={selected} onSelect={onSelect} />
      </div>
      <div className="map-hint"><MapPin size={16} /><span>Klik peta untuk memilih titik simulasi di wilayah mana pun.</span></div>
      <div className="coordinate-fields">
        <label>
          Latitude
          <input
            type="number"
            inputMode="decimal"
            min="-90"
            max="90"
            step="any"
            value={selected?.lat ?? ""}
            onChange={(event) => {
              const lat = Number(event.target.value);
              if (event.target.value !== "" && Number.isFinite(lat) && lat >= -90 && lat <= 90) {
                onSelect({ lat, lng: selected?.lng ?? 0 });
              }
            }}
            placeholder="mis. -6.200000"
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            inputMode="decimal"
            min="-180"
            max="180"
            step="any"
            value={selected?.lng ?? ""}
            onChange={(event) => {
              const lng = Number(event.target.value);
              if (event.target.value !== "" && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
                onSelect({ lat: selected?.lat ?? 0, lng });
              }
            }}
            placeholder="mis. 106.816666"
          />
        </label>
      </div>
    </div>
  );
}

function isWithinServiceHours(config: PublicOperationsConfiguration | null, now = new Date()): boolean {
  if (!config || config.serviceHours.length === 0) return false;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.find(part => part.type === 'weekday')?.value ?? '') + 1;
  const isoWeekday = weekday === 1 ? 7 : weekday - 1;
  const minute = Number(parts.find(part => part.type === 'hour')?.value ?? '0') * 60 + Number(parts.find(part => part.type === 'minute')?.value ?? '0');
  return config.serviceHours.some(window => {
    const [openHour, openMinute] = window.opensAt.split(':').map(Number);
    const [closeHour, closeMinute] = window.closesAt.split(':').map(Number);
    return window.weekday === isoWeekday && minute >= openHour * 60 + openMinute && minute < closeHour * 60 + closeMinute;
  });
}

function ReportNewPage() {
  const navigate = useNavigate();
  const { setCitizenPath } = useDemo();
  const [restoredDraft] = useState(() => { try { return getPendingCreateDraft(); } catch { return null; } });
  const [draft, setDraft] = useState<PendingCreateDraft | null>(restoredDraft);
  const [config, setConfig] = useState<PublicOperationsConfiguration | null>(null);
  const [configState, setConfigState] = useState<'loading'|'ready'|'error'>('loading');
  const [configError, setConfigError] = useState('');
  const [description, setDescription] = useState(restoredDraft?.input.description ?? '');
  const [categoryId, setCategoryId] = useState(restoredDraft?.input.categoryId ?? '');
  const [fieldAnswers, setFieldAnswers] = useState<Record<string,string|boolean>>(restoredDraft?.input.fieldAnswers ?? {});
  const [locationMode, setLocationMode] = useState<LocationSource>(restoredDraft?.input.locationMode ?? 'gps');
  const [selected, setSelected] = useState<GeoPoint | null>(restoredDraft?.input.initialLocation ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitLock = useRef(false);
  const locked = Boolean(draft);
  const selectedCategory = config?.categories.find(category => category.id === (locked ? draft?.input.categoryId : categoryId));
  const configuredFields = selectedCategory?.requiredFields.filter(field => field.key !== 'description') ?? [];
  const active = configState === 'ready' && Boolean(config);
  const withinHours = config ? isWithinServiceHours(config) : false;
  const [versionConflict, setVersionConflict] = useState(false);
  const categoryIdRef = useRef(categoryId);
  categoryIdRef.current = categoryId;

  const loadConfig = useCallback(async (): Promise<PublicOperationsConfiguration | null> => {
    setConfigState('loading'); setConfigError('');
    try {
      const result = await getPublicOperationsConfig();
      if (!result || !Array.isArray(result.categories) || !Number.isSafeInteger(result.version)) throw new Error('Konfigurasi publik belum valid.');
      setConfig(result); setConfigState('ready');
      if (!restoredDraft && !result.categories.some(category => category.id === categoryIdRef.current)) {
        setCategoryId(result.categories[0]?.id ?? '');
        setFieldAnswers({});
      }
      return result;
    } catch (cause) {
      setConfig(null); setConfigState('error'); setConfigError(cause instanceof Error ? cause.message : 'Konfigurasi layanan staging belum dapat dimuat.');
      return null;
    }
  }, [restoredDraft]);
  useEffect(() => { void loadConfig(); }, [loadConfig]);

  function onMapSelect(point: GeoPoint) {
    if (locked || submitting) return;
    setSelected({ lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) });
  }
  function setAnswer(key: string, value: string|boolean) {
    if (!locked && !submitting) setFieldAnswers(current => ({ ...current, [key]: value }));
  }
  function answersValid(fields: RequiredIncidentField[]): boolean {
    return fields.every(field => {
      const value = fieldAnswers[field.key];
      if (!field.required) return true;
      if (field.type === 'boolean') return typeof value === 'boolean';
      return typeof value === 'string' && value.trim().length > 0;
    });
  }
  const canSubmit = Boolean(active && selectedCategory && description.trim().length >= 1 && description.length <= 500 && answersValid(configuredFields) &&
    (locationMode === 'gps' || selected !== null) && !submitting);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || (!draft && !canSubmit)) return;
    submitLock.current = true; setSubmitting(true); setError('');
    let attemptedDraft: PendingCreateDraft | null = draft;
    try {
      const normalizedAnswers = Object.fromEntries(Object.entries(fieldAnswers)
        .filter(([,value]) => !(typeof value === 'string' && value.trim() === ''))
        .map(([key,value]) => [key, typeof value === 'string' ? value.trim() : value]));
      const pending = draft ?? preparePendingCreate({ category: 'security', categoryId, configVersion: config!.version,
        fieldAnswers: normalizedAnswers,
        description: description.trim(), locationMode, initialLocation: locationMode === 'gps' ? null : selected });
      attemptedDraft = pending;
      if (!draft) setDraft(pending);
      await createIncident(pending.input, pending.token, pending.idempotencyKey);
      clearPendingCreate(pending.token); setCitizenPath(`/report/${pending.token}`); navigate(`/report/${pending.token}`);
    } catch (cause) {
      if (cause instanceof DemoServiceError && cause.apiCode === 'operations_version_conflict' && attemptedDraft) {
        clearPendingCreate(attemptedDraft.token);
        setDraft(null);
        setVersionConflict(true);
        setError('Versi konfigurasi berubah sebelum laporan tersimpan. Payload lama sudah dilepas; tinjau kategori dan jawaban terbaru sebelum mengirim ulang.');
        const refreshed = await loadConfig();
        if (refreshed) { setCategoryId(refreshed.categories[0]?.id ?? ''); setFieldAnswers({}); }
      } else {
        setError(cause instanceof Error ? cause.message : 'Laporan belum dapat dibuat. Coba lagi dengan isi yang sama.');
      }
    } finally { submitLock.current = false; setSubmitting(false); }
  }

  return (
    <main className="app-page report-page">
      <AppHeader title="Buat laporan" />
      <div className="page-container narrow-container">
        <DemoNotice />
        <div className="page-heading editorial-topic-heading"><div><p className="eyebrow">LAPORAN BARU</p><h1>Buat laporan</h1><p>Isi informasi kejadian. Bagikan GPS setelah laporan tersimpan.</p></div><img className="topic-illustration report-illustration" src="/assets/report-editorial.png" alt="" aria-hidden="true" width="1536" height="1024" /></div>
        {configState === 'loading' && !locked && <p className="editorial-state" role="status"><CircleNotch className="spin" size={18} /> Memuat pilihan laporan…</p>}
        {configState === 'error' && !locked && <div className="editorial-state editorial-error" role="alert"><strong>Form laporan belum tersedia.</strong><span>{configError}</span><button className="button button-outline" type="button" onClick={() => { void loadConfig(); }}>Coba muat ulang</button></div>}
        {configState === 'ready' && !withinHours && !locked && <div className="editorial-state" role="status"><strong>Di luar jam layanan informasi.</strong><span>Form tetap menerima laporan ke server lokal, tetapi laporan tidak diteruskan ke layanan darurat resmi.</span>{config?.publicFallback.contact && <span>Informasi kontak: {config.publicFallback.contact}</span>}<small>Untuk keadaan darurat, hubungi layanan resmi di wilayah Anda.</small></div>}
        {versionConflict && !locked && <p className="editorial-state" role="status">Konfigurasi terbaru sudah dimuat. Periksa kembali kategori serta jawaban sebelum mengirim laporan baru.</p>}
        {locked && <><p className="success-note" role="status">Pengiriman belum terkonfirmasi. Isi laporan disimpan agar Anda dapat mencoba lagi.</p>{draft?.input.fieldAnswers&&Object.keys(draft.input.fieldAnswers).length>0&&<div className="editorial-state"><strong>Isi laporan tersimpan</strong>{Object.entries(draft.input.fieldAnswers).map(([key,value])=><span key={key}>{key}: {String(value)}</span>)}</div>}</>}
        {(active || locked) && <form className="report-form" onSubmit={event => { void handleSubmit(event); }}>
          {!locked && config && <div className="form-section"><label className="field-label" htmlFor="incident-category">Jenis kejadian <span className="optional-label">Wajib</span></label><select id="incident-category" className="editorial-select" value={categoryId} onChange={event => { setCategoryId(event.target.value); setFieldAnswers({}); }} required><option value="" disabled>Pilih kategori</option>{config.categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div>}
          {locked && <p className="form-section"><span className="field-label">Kategori terkunci</span><strong>{config?.categories.find(item => item.id === draft?.input.categoryId)?.label ?? draft?.input.categoryId}</strong><small>Isi tersimpan digunakan saat mencoba kembali.</small></p>}
          {configuredFields.map(field => <div className="form-section" key={field.key}><label className="field-label" htmlFor={`field-${field.key}`}>{field.label}{field.required && <span className="optional-label">Wajib</span>}</label>
            {field.type === 'boolean' ? <div className="boolean-choice" role="radiogroup" aria-label={field.label}>{([['ya',true],['tidak',false]] as const).map(([label,value])=><label className="check-field" key={label}><input id={`field-${field.key}-${label}`} type="radio" name={`field-${field.key}`} checked={(locked ? draft?.input.fieldAnswers?.[field.key] : fieldAnswers[field.key]) === value} disabled={locked||submitting} onChange={()=>setAnswer(field.key,value)} />{label==='ya'?'Ya':'Tidak'}</label>)}</div> : field.type === 'select' ? <select id={`field-${field.key}`} className="editorial-select" required={field.required} disabled={locked||submitting} value={String(locked ? draft?.input.fieldAnswers?.[field.key] ?? '' : fieldAnswers[field.key] ?? '')} onChange={event => setAnswer(field.key,event.target.value)}><option value="">Pilih…</option>{(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select> : <input id={`field-${field.key}`} className="editorial-input" maxLength={500} required={field.required} disabled={locked||submitting} value={String(locked ? draft?.input.fieldAnswers?.[field.key] ?? '' : fieldAnswers[field.key] ?? '')} onChange={event => setAnswer(field.key,event.target.value)} />}
          </div>)}
          <div className="form-section"><div className="form-label-row"><label className="field-label" htmlFor="description">Apa yang terjadi?</label><span className="optional-label">Wajib</span></div><textarea id="description" name="description" value={description} disabled={locked||submitting} maxLength={500} rows={5} placeholder="Contoh: Saya melihat seseorang mencoba membuka pintu kendaraan di area parkir." onChange={event => setDescription(event.target.value)} required /><div className="field-footer"><span>Hindari menulis nama atau informasi kontak pribadi.</span><span>{description.length}/500</span></div></div>
          <fieldset className="form-section mode-fieldset"><legend className="field-label">Pilih sumber lokasi</legend><div className="mode-options"><button type="button" disabled={locked||submitting} className={`mode-option ${locationMode==='gps'?'selected':''}`} aria-pressed={locationMode==='gps'} onClick={()=>setLocationMode('gps')}><Crosshair size={21} aria-hidden="true"/><span><strong>GPS perangkat</strong><small>Diminta setelah laporan aktif.</small></span>{locationMode==='gps'&&<CheckCircle size={20} weight="fill"/>}</button><button type="button" disabled={locked||submitting} className={`mode-option ${locationMode==='simulation'?'selected':''}`} aria-pressed={locationMode==='simulation'} onClick={()=>setLocationMode('simulation')}><MapPin size={21} aria-hidden="true"/><span><strong>Titik simulasi</strong><small>Pilih titik manual pada peta.</small></span>{locationMode==='simulation'&&<CheckCircle size={20} weight="fill"/>}</button></div>{locationMode==='gps'?<p className="inline-explainer"><Info size={16}/> Browser meminta izin lokasi hanya setelah laporan aktif.</p>:<div className="sim-location-block"><LocationPicker selected={selected} onSelect={onMapSelect}/>{!selected&&<p className="field-error">Pilih titik pada peta sebelum melanjutkan.</p>}</div>}</fieldset>
          {error && <p className="form-error" role="alert"><WarningCircle size={18}/>{error}</p>}
          <div className="submit-row"><p>GPS dapat diaktifkan setelah laporan tersimpan.</p><button type="submit" className="button button-primary" disabled={locked ? submitting : !canSubmit}>{submitting?<><CircleNotch className="spin" size={18}/> Mengirim laporan…</>:locked?<>Coba kirim lagi <ArrowRight size={18} weight="bold"/></>:<>Kirim laporan <ArrowRight size={18} weight="bold"/></>}</button></div>
        </form>}
      </div>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function useCurrentTime(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function withdrawalLatchKey(token: string): string {
  return `sigap.withdrawal-pending:${token}`;
}

function readWithdrawalLatch(token: string): boolean {
  try { return window.sessionStorage.getItem(withdrawalLatchKey(token)) === "1"; }
  catch { return false; }
}

function writeWithdrawalLatch(token: string, pending: boolean): void {
  try {
    if (pending) window.sessionStorage.setItem(withdrawalLatchKey(token), "1");
    else window.sessionStorage.removeItem(withdrawalLatchKey(token));
  } catch {
    // In-memory gating still stops tracking if browser storage is unavailable.
  }
}

function locationAge(measuredAt: string | null, now: number): string {
  if (!measuredAt) return "Titik simulasi tanpa waktu fix GPS.";
  const ageMs = Math.max(0, now - Date.parse(measuredAt));
  const age = ageMs < 60_000 ? "kurang dari 1 menit" : `${Math.floor(ageMs / 60_000)} menit`;
  return `Fix GPS diukur ${formatDate(measuredAt)} · usia titik terakhir ${age}.`;
}

function incidentFromRealtimePayload(payload: unknown): Incident | null {
  if (typeof payload !== "object" || payload === null) return null;
  const wrapped = payload as { incident?: unknown };
  const candidate = (wrapped.incident ?? payload) as Partial<Incident>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !["received", "acknowledged", "triaged", "assigned", "in_progress", "referred", "delivery_failed", "escalation_pending", "resolved"].includes(candidate.status ?? "") ||
    !Array.isArray(candidate.statusHistory)
  ) return null;
  return candidate as Incident;
}

function incidentFromOutboxPayload(payload: unknown, eventName: string): Incident | null {
  if (typeof payload !== "object" || payload === null) return null;
  const envelope = payload as { id?: unknown; event?: unknown };
  if (typeof envelope.id !== "string" || envelope.event !== eventName || hasSeenOutboxEvent(envelope.id)) return null;
  return incidentFromRealtimePayload(payload);
}

function incidentEventError(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Pembaruan realtime belum dapat diproses.";
}

function newestIncident(current: Incident | null, candidate: Incident): Incident {
  return current && current.id === candidate.id && current.updatedAt > candidate.updatedAt
    ? current
    : candidate;
}

function StatusProgress({ incident }: { incident: Incident }) {
  const progressStatus: Record<IncidentStatus, IncidentStatus> = {
    received: "received", acknowledged: "acknowledged", triaged: "triaged",
    assigned: "assigned", in_progress: "in_progress", referred: "resolved",
    delivery_failed: "assigned", escalation_pending: "in_progress", resolved: "resolved",
  };
  const currentIndex = STATUS_ORDER.indexOf(progressStatus[incident.status]);
  return (
    <ol className="status-progress">
      {STATUS_ORDER.map((status) => {
        const statusIndex = STATUS_ORDER.indexOf(status);
        const done = statusIndex <= currentIndex;
        const current = status === progressStatus[incident.status];
        return (
          <li key={status} className={`${done ? "done" : ""} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined}>
            <span className="status-progress-dot">{done ? <Check size={13} weight="bold" /> : statusIndex + 1}</span>
            <span>{STATUS_LABEL[status]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ReportStatusPage() {
  const { token = "" } = useParams();
  const ageClock = useCurrentTime();
  const [withdrawalPendingFor, setWithdrawalPendingFor] = useState<string | null>(() => readWithdrawalLatch(token) ? token : null);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [connectionState, setConnectionState] = useState<"connecting" | "reconnecting" | "online" | "offline" | "idle">("connecting");
  const [realtimeError, setRealtimeError] = useState("");
  const [tracking, setTracking] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [showFallback, setShowFallback] = useState(false);
  const [fallbackPoint, setFallbackPoint] = useState<GeoPoint | null>(null);
  const [notice, setNotice] = useState("");
  const [actionPending, setActionPending] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const watchGeneration = useRef(0);
  const actionLock = useRef(false);
  const socketRef = useRef<ReturnType<typeof connectCitizenSocket> | null>(null);
  const withdrawalPending = withdrawalPendingFor === token || Boolean(incident?.withdrawalRequestedAt);

  useEffect(() => {
    setWithdrawalPendingFor(readWithdrawalLatch(token) ? token : null);
  }, [token]);

  const stopTracking = useCallback(() => {
    watchGeneration.current += 1;
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setTracking(false);
  }, []);

  const applyIncident = useCallback((candidate: Incident) => {
    setIncident((current) => current && current.id !== candidate.id ? current : newestIncident(current, candidate));
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const latest = await getIncidentByToken(token);
    applyIncident(latest);
    setLoadError("");
    return latest;
  }, [applyIncident, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getIncidentByToken(token)
      .then((result) => {
        if (!active) return;
        setIncident(result);
        setLoadError("");
      })
      .catch((cause) => {
        if (!active) return;
        setIncident(null);
        setLoadError(cause instanceof Error ? cause.message : "Status laporan belum dapat dimuat.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (incident?.status !== "resolved" && incident?.status !== "referred") return;
    stopTracking();
    socketRef.current?.disconnect();
    socketRef.current = null;
    setConnectionState("idle");
  }, [incident?.status, stopTracking]);

  useEffect(() => {
    if (incident?.locationMode === "simulation") stopTracking();
  }, [incident?.locationMode, stopTracking]);

  useEffect(() => {
    if (incident?.withdrawalRequestedAt) stopTracking();
  }, [incident?.withdrawalRequestedAt, stopTracking]);

  useEffect(() => {
    if (!incident || incident.status === "resolved" || incident.status === "referred") return;

    let active = true;
    const socket = connectCitizenSocket(token);
    socketRef.current = socket;

    const syncAfterConnect = async () => {
      setConnectionState("reconnecting");
      try {
        await refreshSnapshot();
        if (active && socket.connected) {
          setRealtimeError("");
          setConnectionState("online");
        }
      } catch (cause) {
        if (!active) return;
        setRealtimeError(cause instanceof Error ? cause.message : "Status realtime belum tersinkron.");
        setConnectionState("offline");
      }
    };
    const onSnapshot = (payload: unknown) => {
      const candidate = incidentFromRealtimePayload(payload);
      if (candidate) applyIncident(candidate);
    };
    const onSocketError = (payload: unknown) => setGpsError(incidentEventError(payload));

    socket.on("connect", () => { void syncAfterConnect(); });
    socket.on("disconnect", () => {
      stopTracking();
      setConnectionState("offline");
    });
    socket.on("connect_error", () => {
      stopTracking();
      setConnectionState("offline");
      setRealtimeError("Koneksi realtime terputus. Status terakhir tetap ditampilkan.");
    });
    socket.on("incident:snapshot", onSnapshot);
    const incidentEvents: RealtimeEvent[] = [
      "incident:created",
      "incident:location:updated",
      "incident:status:updated",
      "incident:withdrawal:requested",
    ];
    incidentEvents.forEach((eventName) => socket.on(eventName, (payload: unknown) => {
      const candidate = incidentFromOutboxPayload(payload, eventName);
      if (candidate) applyIncident(candidate);
    }));
    socket.on("incident:error", onSocketError);
    if (socket.connected) void syncAfterConnect();

    return () => {
      active = false;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [applyIncident, incident?.id, refreshSnapshot, stopTracking, token]);

  useEffect(() => () => {
    watchGeneration.current += 1;
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  function startTracking() {
    if (!incident || withdrawalPending || incident.status === "resolved" || incident.status === "referred" || incident.locationMode !== "gps" || connectionState !== "online" || !socketRef.current?.connected) return;
    if (!navigator.geolocation) {
      setGpsError("Browser ini tidak menyediakan lokasi perangkat. Anda dapat memilih titik simulasi.");
      setShowFallback(true);
      return;
    }
    setGpsError("");
    setTracking(true);
    const generation = watchGeneration.current + 1;
    watchGeneration.current = generation;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        if (generation !== watchGeneration.current) return;
        const socket = socketRef.current;
        if (!socket?.connected) {
          setGpsError("Koneksi realtime sedang pulih. Lokasi GPS akan dikirim saat tersambung kembali.");
          return;
        }
        setGpsError("");
        let acknowledgementReceived = false;
        const acknowledgementTimeout = window.setTimeout(() => {
          if (acknowledgementReceived || generation !== watchGeneration.current) return;
          setGpsError("Server belum mengonfirmasi pembaruan lokasi. Koneksi akan mencoba lagi.");
        }, 8000);
        socket.emit("incident:location:update", {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          measuredAt: new Date(position.timestamp).toISOString(),
        }, (acknowledgement) => {
          acknowledgementReceived = true;
          window.clearTimeout(acknowledgementTimeout);
          if (generation !== watchGeneration.current) return;
          if (acknowledgement.ok) {
            applyIncident(acknowledgement.incident);
            setGpsError("");
            return;
          }
          setGpsError(acknowledgement.error.message);
        });
      },
      (error) => {
        stopTracking();
        setGpsError(error.code === error.PERMISSION_DENIED
          ? "Izin lokasi tidak diberikan. Anda tetap dapat memilih titik simulasi."
          : "Lokasi GPS belum tersedia. Anda dapat mencoba lagi atau memilih titik simulasi.");
        setShowFallback(true);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  async function handleCancel(retry = false) {
    const alreadyRequested = Boolean(incident?.withdrawalRequestedAt);
    if (actionLock.current || alreadyRequested || (!retry && !incident)) return;
    if (retry) {
      if (!withdrawalPending) return;
    } else if (!window.confirm("Ajukan permintaan penghentian laporan simulasi? Pelacakan lokasi akan langsung dihentikan.")) {
      return;
    }
    actionLock.current = true;
    writeWithdrawalLatch(token, true);
    setWithdrawalPendingFor(token);
    stopTracking();
    setActionPending("withdrawal");
    setNotice("");
    try {
      const updated = await requestWithdrawal(token);
      setIncident(updated);
      try {
        await refreshSnapshot();
      } catch {
        // The withdrawal response is authoritative even if the follow-up snapshot is unavailable.
        setIncident(updated);
      }
      setNotice("Permintaan penghentian diterima. Pelacakan berhenti; menunggu keputusan petugas.");
    } catch (cause) {
      const status = cause instanceof DemoServiceError ? cause.status : undefined;
      const definitiveRejection = status !== undefined && status >= 400 && status < 500;
      if (definitiveRejection) {
        writeWithdrawalLatch(token, false);
        setWithdrawalPendingFor(null);
        setNotice("Server menolak permintaan. Pelacakan tetap berhenti; jika ingin melanjutkan, aktifkan lagi secara manual setelah koneksi tersambung.");
      } else {
        setNotice("Hasil permintaan belum dapat dipastikan. Pelacakan tetap dihentikan; jangan aktifkan lagi sampai status laporan terkonfirmasi.");
      }
    } finally {
      actionLock.current = false;
      setActionPending(null);
    }
  }

  async function saveFallback() {
    if (actionLock.current || !fallbackPoint) return;
    actionLock.current = true;
    stopTracking();
    setActionPending("location");
    try {
      const updated = await setSimulationLocation(token, fallbackPoint);
      setIncident(updated);
      setGpsError("");
      setShowFallback(false);
      setNotice("Lokasi simulasi tersimpan. Pembaruan GPS telah dihentikan.");
    } catch (cause) {
      setGpsError(cause instanceof Error ? cause.message : "Lokasi simulasi belum dapat disimpan.");
    } finally {
      actionLock.current = false;
      setActionPending(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice("Tautan status disalin ke clipboard.");
    } catch {
      setNotice("Clipboard tidak tersedia. Salin tautan dari address bar browser.");
    }
  }

  if (loading) {
    return (
      <main className="app-page">
        <AppHeader title="Status laporan" />
        <div className="page-container narrow-container not-found-panel"><CircleNotch className="spin" size={30} /><h1>Memuat status laporan…</h1></div>
      </main>
    );
  }

  if (!incident) {
    return (
      <main className="app-page">
        <AppHeader title="Status laporan" />
        <div className="page-container narrow-container not-found-panel">
          <WarningCircle size={34} />
          <p className="eyebrow">STATUS LAPORAN TIDAK TERSEDIA</p>
          <h1>{loadError || "Laporan ini tidak tersedia."}</h1>
          <p>Laporan disimpan di database lokal. Halaman ini belum dapat membacanya; periksa tautan dan koneksi server, lalu coba muat ulang.</p>
          {withdrawalPendingFor === token && <button className="button button-outline" onClick={() => { void handleCancel(true); }} disabled={actionPending === "withdrawal"}>{actionPending === "withdrawal" ? "Mengirim ulang permintaan…" : "Coba kirim ulang permintaan penghentian"} <ArrowRight size={18} /></button>}
          {loadError && <button className="button button-outline" onClick={() => {
            setLoading(true);
            void refreshSnapshot().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Status laporan belum dapat dimuat.")).finally(() => setLoading(false));
          }}>Coba muat ulang <ArrowRight size={18} /></button>}
          <Link className="button button-dark" to="/">Kembali ke halaman awal <ArrowRight size={18} /></Link>
        </div>
      </main>
    );
  }

  const isTerminal = incident.status === "resolved" || incident.status === "referred";

  return (
    <main className="app-page status-page">
      <AppHeader title="Status laporan" />
      <div className="page-container status-container">
        <DemoNotice />
        <div className="status-topline"><p className="eyebrow">STATUS LAPORAN</p><span>ID · {incident.id.slice(0, 8).toUpperCase()}</span></div>
        <div className="status-heading">
          <div><h1>{STATUS_LABEL[incident.status]}</h1><p>Dibuat {formatDate(incident.createdAt)}</p></div><img className="topic-illustration tracking-illustration" src="/assets/tracking-editorial.png" alt="" aria-hidden="true" width="1536" height="1024" />
          
        </div>
        <p className="side-disclaimer" role="status">{connectionState === "online" ? "Status terbaru sudah dimuat." : connectionState === "reconnecting" || connectionState === "connecting" ? "Menghubungkan pembaruan status…" : connectionState === "idle" ? "Laporan berada pada status akhir." : "Koneksi terputus. Menampilkan status terakhir."}</p>
        {realtimeError && <p className="form-error" role="status"><WarningCircle size={18} /> {realtimeError}</p>}

        <div className="status-layout">
          <section className="status-main-panel">
            
            <p className="status-help">{STATUS_HELP[incident.status]}</p>
            <StatusProgress incident={incident} />

            <div className="incident-description"><span className="field-label">Deskripsi insiden</span><p>{incident.description}</p></div>
            <div className="location-status-card">
              <div className="location-status-header"><span className="field-label">Lokasi laporan</span>{incident.location && <LocationSourceLabel source={incident.location.source} />}</div>
              {incident.location ? (
                <>
                  <strong className="coordinate-value">{incident.location.lat.toFixed(6)}° , {incident.location.lng.toFixed(6)}°</strong>
                  <p>Diterima server {formatDate(incident.location.updatedAt)} · {locationAge(incident.location.measuredAt, ageClock)}</p>
                  <div className="status-map"><MapView selected={incident.location} centerOnSelected /></div>
                </>
              ) : (
                <div className="gps-pending"><Crosshair size={19} /><div><strong>GPS belum tersedia</strong><span>Aktifkan berbagi lokasi setelah laporan tersimpan.</span></div></div>
              )}
            </div>

            {!isTerminal && !withdrawalPending && incident.locationMode === "gps" && (
              <div className="gps-controls">
                <button className="button button-blue" onClick={startTracking} disabled={tracking || connectionState !== "online"}>
                  {tracking ? <><CircleNotch className="spin" size={18} /> Berbagi lokasi aktif</> : <><Crosshair size={18} /> {incident.location ? "Lanjutkan berbagi lokasi" : "Aktifkan berbagi lokasi"}</>}
                </button>
                <p>Browser meminta izin lokasi setelah Anda menekan tombol. Pelacakan berhenti saat koneksi terputus dan tidak berjalan kembali otomatis setelah tersambung; aktifkan lagi secara manual setelah status tersinkron.</p>
              </div>
            )}

            {!isTerminal && !withdrawalPending && incident.locationMode === "gps" && (
              <div className="fallback-box">
                <div><strong>GPS tidak tersedia?</strong><span>Gunakan titik pilihan Anda dan tandai sebagai simulasi.</span></div>
                <button className="text-link" onClick={() => {
                  setShowFallback((value) => !value);
                  if (!showFallback) stopTracking();
                }}>{showFallback ? "Tutup pilihan" : "Pilih titik simulasi"}</button>
                {showFallback && <div className="fallback-picker"><LocationPicker selected={fallbackPoint} onSelect={setFallbackPoint} /><button className="button button-dark" onClick={() => { void saveFallback(); }} disabled={!fallbackPoint || actionPending !== null}>{actionPending === "location" ? "Menyimpan lokasi…" : <>Gunakan lokasi simulasi <ArrowRight size={17} /></>}</button></div>}
              </div>
            )}

            {gpsError && <p className="form-error" role="status"><WarningCircle size={18} /> {gpsError}</p>}
            {notice && <p className="success-note" role="status"><CheckCircle size={18} /> {notice}</p>}
            {withdrawalPending && <p className="success-note" role="status">{incident.withdrawalRequestedAt ? `Permintaan penghentian diterima ${formatDate(incident.withdrawalRequestedAt)}. Pelacakan sudah berhenti; permintaan menunggu keputusan petugas.` : "Permintaan penghentian sedang dikonfirmasi. Pelacakan tetap dihentikan sampai hasilnya jelas."}</p>}
            {withdrawalPending && !incident.withdrawalRequestedAt && <button className="button button-outline" onClick={() => { void handleCancel(true); }} disabled={actionPending === "withdrawal"}>{actionPending === "withdrawal" ? "Mengirim ulang permintaan…" : "Coba kirim ulang permintaan penghentian"} <ArrowRight size={18} /></button>}
            {!isTerminal && !withdrawalPending && <button className="cancel-button" onClick={() => { void handleCancel(); }} disabled={actionPending !== null}>{actionPending === "withdrawal" ? "Mengirim permintaan…" : "Minta penghentian laporan"}</button>}
          </section>

          <aside className="status-side-panel">
            <div className="side-panel-heading"><Clock size={18} /><span>Riwayat status</span></div>
            <ol className="history-list">
              {incident.statusHistory.map((item, index) => (
                <li key={`${item.status}-${item.changedAt}`}>
                  <span className={`history-dot ${index === incident.statusHistory.length - 1 ? "current" : ""}`} />
                  <div><strong>{STATUS_LABEL[item.status]}</strong><span>{item.actor === "citizen" ? "Pelapor" : item.actor === "system" ? "Sistem lokal" : "Petugas"} · {formatDate(item.changedAt)}</span></div>
                </li>
              ))}
            </ol>
            {incident.assignment && <div className="assigned-unit"><span>STATUS PENETAPAN</span><strong>Unit simulasi telah dipilih</strong><small>Tidak ada unit nyata yang dihubungi.</small></div>}
            <button className="button button-outline full-width" onClick={copyLink}>Salin tautan status</button>
            <p className="side-disclaimer">Status ini berasal dari server lokal. Laporan tidak diterima atau diproses oleh layanan darurat resmi.</p>
            <Link className="side-dashboard-link" to="/dashboard/login">Buka dashboard petugas <ArrowRight size={16} /></Link>
          </aside>
        </div>
      </div>
    </main>
  );
}

function DashboardLoginPage() {
  const navigate = useNavigate();
  const { isStaff, authChecking, authError: sessionRestoreError, login } = useDemo();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const loginLock = useRef(false);

  if (authChecking) return <main className="app-page"><AppHeader title="Akses petugas" /><div className="page-container narrow-container not-found-panel"><CircleNotch className="spin" size={30} /><h1>Memeriksa sesi petugas…</h1></div></main>;
  if (isStaff) return <Navigate to="/dashboard" replace />;

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginLock.current) return;
    if (!username.trim() || !password.trim()) {
      setError("Isi nama pengguna dan kata sandi.");
      return;
    }
    loginLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const authenticated = await login(username, password);
      if (!authenticated) {
        setError("Server belum mengonfirmasi sesi petugas. Periksa nama pengguna dan kata sandi.");
        return;
      }
      navigate("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login belum berhasil.");
    } finally {
      loginLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="app-page login-page">
      <AppHeader title="Akses petugas" />
      <div className="login-layout page-container">
        <div className="login-copy">
          <span className="eyebrow">AREA PETUGAS</span>
          <h1>Masuk sebagai petugas</h1><img className="topic-illustration access-illustration" src="/assets/access-editorial.png" alt="" aria-hidden="true" width="1536" height="1024" />
          <p>Gunakan akun yang diberikan administrator.</p>
          <DemoNotice />
          <div className="login-visual-note"><ShieldCheck size={22} /><span>Akun staff individual hanya untuk staging sintetis. Peran dan wilayah diperiksa oleh server.</span></div>
        </div>
        <form className="login-card" onSubmit={(event) => { void handleLogin(event); }}>
          <p className="eyebrow">MASUK KE DASHBOARD</p>
          <h2>Masuk ke akun.</h2>
          <p className="login-help">Masukkan nama pengguna dan kata sandi Anda.</p>
          <label className="form-label" htmlFor="staff-username">Nama pengguna staff</label>
          <input id="staff-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Nama pengguna" required disabled={submitting} />
          <label className="form-label" htmlFor="staff-password">Kata sandi staff</label>
          <input id="staff-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Kata sandi staff" required disabled={submitting} />
          {sessionRestoreError && <p className="form-error" role="status"><Info size={17} /> {sessionRestoreError}</p>}
          {error && <p className="form-error" role="alert"><WarningCircle size={17} /> {error}</p>}
          <button className="button button-dark full-width" type="submit" disabled={submitting}>{submitting ? <><CircleNotch className="spin" size={18} /> Memeriksa kredensial…</> : <>Masuk ke dashboard <ArrowRight size={18} /></>}</button>
          <p className="mock-auth-label"><Info size={15} /> Sesi disimpan di PostgreSQL, memiliki batas kedaluwarsa absolut, dan dapat dicabut administrator.</p>
        </form>
      </div>
    </main>
  );
}

function DashboardPage() {
  const ageClock = useCurrentTime();
  const { logout, markStaffLoggedOut, principal } = useDemo();
  const navigate = useNavigate();
  const [page, setPage] = useState<StaffIncident[]>([]);
  const [detail, setDetail] = useState<StaffIncident | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string|undefined)[]>([undefined]);
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [withdrawalFilter, setWithdrawalFilter] = useState('');
  const [ageFilter, setAgeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [actionError, setActionError] = useState('');
  const [conflictMessage, setConflictMessage] = useState('');
  const [connectionState, setConnectionState] = useState<'connecting'|'reconnecting'|'online'|'offline'>('connecting');
  const [pendingAction, setPendingAction] = useState<string|null>(null);
  const [reason, setReason] = useState('');
  const [sopChoice, setSopChoice] = useState('');
  const [responderChoice, setResponderChoice] = useState('');
  const [workConfig, setWorkConfig] = useState<OperationsWorkConfiguration|null>(null);
  const [configError, setConfigError] = useState('');
  const [focusVersion, setFocusVersion] = useState(0);
  const actionLock = useRef(false);
  const staffSocketRef = useRef<ReturnType<typeof connectStaffSocket>|null>(null);
  const filters = useMemo<StaffQueueFilters>(() => ({
    ...(statusFilter ? { statuses: [statusFilter] } : {}),
    ...(ownerFilter ? { owner: ownerFilter as 'me'|'unclaimed' } : {}),
    ...(withdrawalFilter ? { withdrawalPending: withdrawalFilter === 'true' } : {}),
    ...(ageFilter === 'new' ? { maxAgeMinutes: 60 } : ageFilter === 'older' ? { minAgeMinutes: 60 } : {}),
    cursor: cursorStack[cursorStack.length - 1], limit: 50,
  }), [statusFilter, ownerFilter, withdrawalFilter, ageFilter, cursorStack]);
  const canWork = principal?.role === 'dispatcher' || principal?.role === 'supervisor';
  const matchingPage = useMemo(() => page.filter(row => !search.trim() || `${row.id} ${row.description} ${row.categoryId}`.toLowerCase().includes(search.trim().toLowerCase())),[page,search]);
  const activeCount = page.filter(row => !['resolved','referred'].includes(row.status)).length;
  const gpsPending = page.filter(row => row.locationMode === 'gps' && !row.location).length;
  const completed = page.filter(row => ['resolved','referred'].includes(row.status)).length;
  const selected = detail?.id === selectedId ? detail : null;
  const availableSops = (workConfig?.pinnedSops ?? workConfig?.sops ?? []).filter(sop => sop.categoryId === selected?.categoryId);
  const responders = workConfig?.responders.filter(unit => unit.enabled && unit.simulated && unit.availability === 'available' && unit.categoryIds.includes(selected?.categoryId ?? '') && unit.coverageRegionIds.some(region => principal?.regionIds.includes(region))) ?? [];

  const refreshQueue = useCallback(async (cursor = cursorStack[cursorStack.length - 1]) => {
    setSnapshotLoading(true); setSnapshotError('');
    try {
      const result = await listIncidentsForStaff({ ...filters, cursor });
      setPage(result.items); setNextCursor(result.nextCursor);
      if (selectedId && !result.items.some(item => item.id === selectedId) && result.items.length === 0) { setSelectedId(null); setDetail(null); }
      return result;
    } catch (cause) {
      setSnapshotError(cause instanceof Error ? cause.message : 'Antrian belum dapat dimuat.');
      if (cause instanceof DemoServiceError && cause.status === 401) { markStaffLoggedOut(); navigate('/dashboard/login',{replace:true}); }
      throw cause;
    } finally { setSnapshotLoading(false); }
  }, [filters,cursorStack,selectedId,markStaffLoggedOut,navigate]);
  useEffect(() => { void refreshQueue().catch(()=>{}); }, [refreshQueue]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true; setDetailLoading(true); setDetailError('');
    void getIncidentForStaff(selectedId).then(value => { if (active) setDetail(value); }).catch(cause => {
      if (!active) return;
      setDetailError(cause instanceof Error ? cause.message : 'Detail laporan belum dapat dimuat.');
      if (cause instanceof DemoServiceError && cause.status === 404) { setSelectedId(null); setDetail(null); }
      if (cause instanceof DemoServiceError && cause.status === 401) { markStaffLoggedOut(); navigate('/dashboard/login',{replace:true}); }
    }).finally(()=>{ if(active)setDetailLoading(false); });
    return ()=>{active=false;};
  },[selectedId,markStaffLoggedOut,navigate]);
  useEffect(() => {
    let active=true; setWorkConfig(null); setConfigError('');
    if ((principal?.role === 'dispatcher' || principal?.role === 'supervisor') && selectedId) {
      void getOperationsWorkConfig(selectedId).then(value=>{if(active)setWorkConfig(value);}).catch(cause=>{if(active)setConfigError(cause instanceof Error?cause.message:'SOP dan roster staging belum dapat dimuat.');});
    }
    return ()=>{active=false;};
  },[principal?.role,selectedId]);
  useEffect(()=>{ if(availableSops.length && !availableSops.some(item=>`${item.id}:${item.version}`===sopChoice))setSopChoice(`${availableSops[0].id}:${availableSops[0].version}`); },[availableSops,sopChoice]);
  useEffect(()=>{ if(responders.length&&!responders.some(item=>item.id===responderChoice))setResponderChoice(responders[0].id); },[responders,responderChoice]);

  const refreshQueueRef = useRef(refreshQueue);
  refreshQueueRef.current = refreshQueue;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    let active = true;
    let socket: ReturnType<typeof connectStaffSocket> | null = null;
    let initialSnapshot = true;
    const invalidate = async (payload: unknown, eventName: RealtimeEvent) => {
      if (eventName !== 'incident:snapshot' && typeof payload === 'object' && payload !== null && 'id' in payload) {
        const eventId = (payload as { id?: unknown }).id;
        if (typeof eventId === 'string' && hasSeenOutboxEvent(eventId)) return;
      }
      setConnectionState('reconnecting');
      try {
        await refreshQueueRef.current();
        const currentId = selectedIdRef.current;
        if (currentId) {
          const fresh = await getIncidentForStaff(currentId);
          if (active) setDetail(fresh);
        }
        if (active) setConnectionState('online');
      } catch {
        if (active) setConnectionState('offline');
      }
    };
    socket = connectStaffSocket();
    staffSocketRef.current = socket;
    socket.on('connect', () => {
      // Catch up after the room join on both first connection and reconnection.
      void invalidate(null, 'incident:snapshot');
    });
    socket.on('disconnect', () => setConnectionState('offline'));
    socket.on('connect_error', () => {
      setConnectionState('offline');
      setSnapshotError('Realtime terputus; gunakan tombol segarkan untuk mengambil data terbaru.');
    });
    (['incident:snapshot','incident:created','incident:location:updated','incident:status:updated','incident:withdrawal:requested'] as RealtimeEvent[]).forEach(name => {
      socket?.on(name, (payload: unknown) => {
        // The connect handler has already fetched a fresh queue/detail before the first snapshot.
        if (name === 'incident:snapshot' && initialSnapshot) { initialSnapshot = false; return; }
        void invalidate(payload, name);
      });
    });
    socket.on('incident:error', (payload: unknown) => setActionError(incidentEventError(payload)));
    return () => {
      active = false;
      socket?.disconnect();
      if (staffSocketRef.current === socket) staffSocketRef.current = null;
    };
  }, []);

  async function perform(action:string, callback:()=>Promise<StaffIncident>) {
    if(actionLock.current||pendingAction)return;
    actionLock.current=true;setPendingAction(action);setActionError('');setConflictMessage('');
    try { const updated=await callback();setDetail(updated);setPage(current=>current.map(row=>row.id===updated.id?updated:row));setReason('');await refreshQueue(); }
    catch(cause){
      if(cause instanceof DemoServiceError&&cause.status===409){setConflictMessage('Data berubah di server. Detail dimuat ulang agar tindakan berikutnya memakai status dan pemilik terbaru.');if(selectedId)void getIncidentForStaff(selectedId).then(setDetail).catch(()=>{});void refreshQueue().catch(()=>{});}
      setActionError(cause instanceof Error?cause.message:'Perubahan belum dapat disimpan.');
      if(cause instanceof DemoServiceError&&cause.status===401){markStaffLoggedOut();navigate('/dashboard/login',{replace:true});}
    } finally {actionLock.current=false;setPendingAction(null);}
  }
  function workflowInput() {
    if (!selected || !sopChoice || workConfig?.pinnedConfigVersion !== selected.configVersion) return null;
    const [sopId,version] = sopChoice.split(':');
    return { expectedStatus:selected.status, sopId, sopVersion:Number(version), reason:reason.trim()||null };
  }
  async function handleLogout(){try{await logout();navigate('/dashboard/login',{replace:true});}catch(cause){setActionError(cause instanceof Error?cause.message:'Logout belum dapat diselesaikan.');}}

  return <main className="dashboard-page dashboard-landing-style">
    <header className="dashboard-header"><Brand/><div className="dashboard-head-center"><span className="live-dot"/> DASHBOARD <span className="demo-chip">STAGING</span></div><div className="dashboard-head-actions"><span className="staff-identity">{principal?.displayName} · {principal?.role}</span>{principal?.role==='operator_admin'&&<><Link className="dashboard-home-link" to="/dashboard/operations">Operasional</Link><Link className="dashboard-home-link" to="/dashboard/accounts">Akses staff</Link></>}{(principal?.role==='auditor'||principal?.role==='operator_admin')&&<><Link className="dashboard-home-link" to="/dashboard/audit">Audit</Link><Link className="dashboard-home-link" to="/dashboard/realtime">Realtime</Link></>}<Link className="dashboard-home-link" to="/dashboard/monitoring">Monitoring</Link><Link to="/" className="dashboard-home-link">Halaman warga</Link><button className="icon-button" onClick={()=>{void handleLogout();}} aria-label="Keluar"> <SignOut size={19}/></button></div></header>
    <div className="dashboard-body">
      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div className="dashboard-hero-copy"><h1 id="dashboard-title">Antrean laporan</h1><p className="dashboard-hero-description">{matchingPage.length} laporan ditampilkan · Wilayah local-staging</p><DemoNotice compact/></div>
        <div className="dashboard-hero-art" aria-hidden="true"><img src="/assets/dashboard-city-editorial.png" alt=""/></div>
      </section>
      {canWork&&<div className="dispatch-dashboard-link"><Link className="button button-outline" to="/dashboard/dispatch">Antrean pengiriman internal <ArrowRight size={17}/></Link></div>}
      <div className="metric-grid"><div className="metric-card"><span>Laporan aktif di halaman</span><strong>{activeCount}</strong><small><Pulse size={14}/> Data sesuai filter</small></div><div className="metric-card"><span>GPS belum tersedia</span><strong>{gpsPending}</strong><small><Crosshair size={14}/> Menunggu lokasi</small></div><div className="metric-card"><span>Status akhir</span><strong>{completed}</strong><small><CheckCircle size={14}/> Dalam halaman ini</small></div><div className="metric-card metric-card-note"><div className="metric-note-mark"><MapTrifold size={20}/></div><span>Wilayah: local-staging</span><small>Tidak ada dispatch eksternal.</small></div></div>
      <section className="queue-filter-panel" aria-label="Filter antrian"><label>Pencarian<input className="editorial-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ID, kategori, atau deskripsi"/></label><label>Status<select className="editorial-select" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setCursorStack([undefined]);}}><option value="">Semua status</option>{Object.entries(STATUS_LABEL).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>Pemilik<select className="editorial-select" value={ownerFilter} onChange={e=>{setOwnerFilter(e.target.value);setCursorStack([undefined]);}}><option value="">Semua pemilik</option><option value="me">Saya</option><option value="unclaimed">Belum diklaim</option></select></label><label>Permintaan stop<select className="editorial-select" value={withdrawalFilter} onChange={e=>{setWithdrawalFilter(e.target.value);setCursorStack([undefined]);}}><option value="">Semua</option><option value="true">Menunggu keputusan</option><option value="false">Tidak menunggu</option></select></label><label>Usia laporan<select className="editorial-select" value={ageFilter} onChange={e=>{setAgeFilter(e.target.value);setCursorStack([undefined]);}}><option value="">Semua usia</option><option value="new">≤ 1 jam</option><option value="older">≥ 1 jam</option></select></label><button className="button button-outline" onClick={()=>{void refreshQueue().catch(()=>{});}}>Segarkan</button></section>
      <div className="dashboard-workspace"><section className="incident-list-panel"><div className="panel-header"><div><p className="eyebrow">ANTRIAN WILAYAH</p><h2>Laporan <span>{matchingPage.length}</span></h2></div><span className={`connection-pill connection-${connectionState}`}><span/>{connectionState==='online'?'Realtime tersambung':connectionState==='offline'?'Perlu disegarkan':'Menyinkronkan'}</span></div>
        {snapshotError&&<p className="form-error" role="alert">{snapshotError}<button className="text-link" onClick={()=>{void refreshQueue().catch(()=>{});}}>Coba lagi</button></p>}
        {snapshotLoading?<div className="empty-list-state" role="status"><CircleNotch className="spin" size={24}/><h3>Memuat antrian…</h3></div>:matchingPage.length===0?<div className="empty-list-state"><span className="empty-icon"><ShieldCheck size={30}/></span><h3>{page.length?'Tidak ada hasil pencarian':'Belum ada laporan pada filter ini'}</h3><p>Ubah filter atau segarkan data staging.</p><button className="text-link" onClick={()=>{setSearch('');setStatusFilter('');setOwnerFilter('');setWithdrawalFilter('');setAgeFilter('');setCursorStack([undefined]);}}>Hapus filter</button></div>:<div className="incident-list">{matchingPage.map(row=><button key={row.id} className={`incident-list-item ${selectedId===row.id?'selected':''}`} onClick={()=>setSelectedId(row.id)} aria-current={selectedId===row.id?'true':undefined}><span className="incident-list-mark"><MapPin size={18}/></span><span className="incident-list-content"><span className="incident-list-top"><strong>{row.id.slice(0,8).toUpperCase()}</strong><small>{formatDate(row.createdAt)} · {row.queueAgeMinutes} menit</small></span><span className="incident-list-desc">{row.description}</span><span className="incident-list-bottom"><StatusBadge status={row.status}/><span className="source-label">{row.ownerStaffId?'Ada pemilik':'Belum diklaim'}</span>{row.withdrawalRequestedAt&&!row.withdrawalDecision&&<span className="status-badge status-withdrawal">Permintaan stop</span>}</span></span><ArrowRight className="list-chevron" size={17}/></button>)}</div>}
        <div className="queue-pagination"><button className="button button-outline" disabled={cursorStack.length<=1||snapshotLoading} onClick={()=>setCursorStack(current=>current.slice(0,-1))}>Sebelumnya</button><span>Halaman {cursorStack.length}</span><button className="button button-outline" disabled={!nextCursor||snapshotLoading} onClick={()=>{if(nextCursor)setCursorStack(current=>[...current,nextCursor]);}}>Berikutnya</button></div>
      </section><section className="map-panel" aria-label="Peta lokasi laporan"><div className="map-panel-heading"><div><p className="eyebrow">PETA LAPORAN</p><h2>{page.filter(row=>row.location).length} titik lokasi</h2></div><span className="map-key"><span className="map-key-dot"/>GPS / simulasi</span></div><div className="dashboard-map">{page.some(row=>row.location!==null)?<MapView markers={page.filter(row=>row.location!==null)} focusLocation={selected?.location??null} focusVersion={focusVersion}/>:<div className="dashboard-map-empty"><div className="map-empty-orbit"><MapPin size={42} weight="duotone"/></div><h3>Belum ada lokasi laporan.</h3><p>Titik lokasi muncul di sini setelah tersedia pada laporan dalam halaman ini.</p><span className="map-empty-label">MENUNGGU TITIK LOKASI</span></div>}</div><div className="map-panel-foot"><span>Lokasi untuk alur staging saja.</span>{selected?.location&&<button className="map-focus-button" onClick={()=>setFocusVersion(v=>v+1)}><NavigationArrow size={16}/>Pusatkan pilihan</button>}</div></section></div>
      <section className="detail-panel" aria-live="polite">
        {detailLoading?<p role="status"><CircleNotch className="spin" size={18}/> Memuat detail privat dari server…</p>:detailError?<div className="editorial-state editorial-error" role="alert">{detailError}<button className="button button-outline" onClick={()=>selectedId&&void getIncidentForStaff(selectedId).then(setDetail).catch(c=>setDetailError(c instanceof Error?c.message:'Detail gagal dimuat.'))}>Coba muat ulang detail</button></div>:selected?<>
          <div className="detail-heading"><div><p className="eyebrow">DETAIL PETUGAS · {selected.categoryId} · USIA {selected.queueAgeMinutes} MENIT</p><h2>{selected.id.slice(0,12).toUpperCase()}</h2></div><StatusBadge status={selected.status}/></div>
          <div className="detail-grid"><div className="detail-description"><span className="field-label">Deskripsi kejadian</span><p>{selected.description}</p>{Object.keys(selected.fieldAnswers??{}).length>0&&<><span className="field-label detail-second-label">Jawaban kategori</span>{Object.entries(selected.fieldAnswers).map(([key,value])=><p key={key}><strong>{key}:</strong> {String(value)}</p>)}</>}</div><div><span className="field-label">Pemilik</span><p>{selected.ownerStaffId??'Belum diklaim'}</p><span className="field-label">Lokasi</span>{selected.location?<p>{selected.location.lat.toFixed(5)}°, {selected.location.lng.toFixed(5)}° · {selected.location.source}</p>:<p>Lokasi belum tersedia</p>}</div><div><span className="field-label">Assignment snapshot</span><p>{selected.assignment?`${selected.assignment.label} · konfigurasi v${selected.assignment.configVersion}`:'Belum ada pemilihan'}</p><small>Simulasi internal; tanpa acknowledgement dispatch eksternal.</small><span className="field-label detail-second-label">Permintaan stop</span><p>{selected.withdrawalRequestedAt?selected.withdrawalDecision?`${selected.withdrawalDecision.outcome==='accepted'?'Diterima':'Ditolak'} · ${formatDate(selected.withdrawalDecision.decidedAt)}`:`Menunggu keputusan sejak ${formatDate(selected.withdrawalRequestedAt)}`:'Tidak ada'}</p></div></div>
          {(selected.withdrawalRequestedAt&&!selected.withdrawalDecision)&&<p className="success-note" role="status">Warga meminta penghentian. Pelacakan sudah berhenti; putuskan permintaan sebelum status akhir.</p>}
          {conflictMessage&&<p className="editorial-state" role="status">{conflictMessage}</p>}{actionError&&<p className="form-error" role="alert">{actionError}</p>}{configError&&<p className="form-error" role="status">{configError}</p>}
          <div className="detail-workflow-grid"><label>Prosedur (SOP) dan versi<select className="editorial-select" value={sopChoice} onChange={e=>setSopChoice(e.target.value)} disabled={!availableSops.length||!canWork}><option value="">SOP tidak tersedia</option>{availableSops.map(sop=><option key={`${sop.id}:${sop.version}`} value={`${sop.id}:${sop.version}`}>{sop.title} · v{sop.version} · simulasi</option>)}</select></label><label>Alasan tindakan (wajib untuk beberapa aksi, maks. 500 karakter)<textarea className="editorial-input" maxLength={500} rows={2} value={reason} onChange={e=>setReason(e.target.value)} disabled={!canWork}/></label></div>
          {availableSops.find(sop=>`${sop.id}:${sop.version}`===sopChoice)&&<ol className="sop-steps">{availableSops.find(sop=>`${sop.id}:${sop.version}`===sopChoice)?.steps.map((step,index)=><li key={index}>{step}</li>)}</ol>}
          <div className="detail-actions">
            {canWork&&<Link className="button button-outline" to={`/dashboard/dispatch?incidentId=${encodeURIComponent(selected.id)}`}>Tinjau pengiriman <ArrowRight size={16}/></Link>}
            {!canWork&&<p className="detail-muted">Peran {principal?.role} hanya dapat membaca antrian.</p>}
            {canWork&&selected.allowedActions.includes('claim')&&<button className="button button-blue" onClick={()=>void perform('claim',()=>changeIncidentOwnership(selected.id,'claim',{expectedStatus:selected.status,expectedOwnerId:selected.ownerStaffId,reason:reason.trim()||null}))}>Klaim laporan</button>}
            {canWork&&selected.allowedActions.includes('release')&&<button className="button button-outline" onClick={()=>void perform('release',()=>changeIncidentOwnership(selected.id,'release',{expectedStatus:selected.status,expectedOwnerId:selected.ownerStaffId,reason:reason.trim()||null}))}>Lepaskan klaim</button>}
            {canWork&&selected.allowedActions.includes('takeover')&&<button className="button button-outline" disabled={!reason.trim()||pendingAction!==null} onClick={()=>{if(window.confirm('Ambil alih laporan ini sebagai supervisor?'))void perform('takeover',()=>changeIncidentOwnership(selected.id,'takeover',{expectedStatus:selected.status,expectedOwnerId:selected.ownerStaffId,reason:reason.trim()}));}}>Ambil alih (supervisor)</button>}
            {canWork&&selected.allowedActions.includes('transition')&&selected.allowedTransitions.map(status=><button key={status} className="button button-dark" disabled={!workflowInput()||pendingAction!==null||(['triaged','referred','delivery_failed','escalation_pending','resolved'].includes(status)&&!reason.trim())} onClick={()=>{const input=workflowInput();if(input&&(!['resolved','referred'].includes(status)||window.confirm('Konfirmasi perubahan status akhir workflow staging?')))void perform(status,()=>setIncidentStatus(selected.id,status,input));}}>{status==='acknowledged'?'Akui laporan':status==='triaged'?'Tandai triase':status==='in_progress'?'Mulai penanganan simulasi':status==='resolved'?'Selesaikan alur staging':status==='referred'?'Tandai dirujuk':status==='delivery_failed'?'Tandai kegagalan simulasi':status==='escalation_pending'?'Minta eskalasi':status}</button>)}
            {canWork&&selected.allowedActions.includes('assignment')&&<><label>Pilih responder simulasi<select className="editorial-select" value={responderChoice} onChange={e=>setResponderChoice(e.target.value)} disabled={!responders.length}><option value="">Roster tidak tersedia</option>{responders.map(unit=><option key={unit.id} value={unit.id}>{unit.label}</option>)}</select></label><button className="button button-dark" disabled={!selected.allowedTransitions.includes('assigned')||!responders.length||!workflowInput()||!reason.trim()||pendingAction!==null} onClick={()=>{const input=workflowInput();if(input&&responderChoice&&window.confirm('Tetapkan responder simulasi sebagai pilihan internal? Tidak ada dispatch eksternal.'))void perform('assignment',()=>assignIncidentUnit(selected.id,responderChoice,input));}}>Tetapkan pilihan internal</button></>}
            {canWork&&selected.allowedActions.includes('withdrawal_accepted')&&<><button className="button button-primary" disabled={!workflowInput()||!reason.trim()} onClick={()=>{const input=workflowInput();if(input&&window.confirm('Terima permintaan stop warga? Pelacakan tetap dihentikan.'))void perform('withdrawal-accepted',()=>decideIncidentWithdrawal(selected.id,'accepted',input));}}>Terima permintaan stop</button>{selected.allowedActions.includes('withdrawal_denied')&&<button className="button button-outline" disabled={!workflowInput()||!reason.trim()} onClick={()=>{const input=workflowInput();if(input&&window.confirm('Tolak permintaan stop warga? Pelacakan tetap dihentikan.'))void perform('withdrawal-denied',()=>decideIncidentWithdrawal(selected.id,'denied',input));}}>Tolak permintaan stop</button>}</>}
          </div>
          <div className="workflow-history"><h3>Riwayat operasi</h3>{selected.workflowHistory.length===0?<p>Belum ada tindakan workflow.</p>:<ol>{selected.workflowHistory.map(event=><li key={event.id}><strong>{event.action}</strong><span>{formatDate(event.occurredAt)} · {event.reason||'Tanpa alasan'}</span>{event.sop&&<small>SOP {event.sop.sopId} v{event.sop.sopVersion} · konfigurasi v{event.sop.configVersion}</small>}{event.assignment&&<small>{event.assignment.label} · pilihan simulasi · tidak ada acknowledgement eksternal</small>}</li>)}</ol>}</div>
        </>:<div className="empty-list-state detail-empty"><span className="empty-icon"><ArrowRight size={26}/></span><div><p className="eyebrow">02 / DETAIL LAPORAN</p><h3>Pilih laporan untuk mulai meninjau.</h3><p>Informasi dan tindakan penanganan tersedia setelah Anda memilih laporan dari antrean.</p></div></div>}
      </section>
      <div className="dashboard-bottom-note"><Info size={16}/><span>Semua tindakan hanya mengubah workflow staging. Penetapan unit adalah pemilihan simulasi internal tanpa dispatch atau acknowledgement nyata.</span></div>
    </div>
  </main>;
}

function OperationsSettingsPage() {
  const { principal, markStaffLoggedOut } = useDemo();
  const navigate = useNavigate();
  const [config, setConfig] = useState<OperationsConfiguration|null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [hours, setHours] = useState('[]');
  const [fallbackCopy, setFallbackCopy] = useState('');
  const [fallbackContact, setFallbackContact] = useState('');
  const [categories, setCategories] = useState('[]');
  const [sops, setSops] = useState('[]');
  const [responders, setResponders] = useState('[]');
  const [revision, setRevision] = useState(0);
  const load = useCallback(async()=>{
    setLoading(true);setError('');setNotice('');setConflict(false);
    try{const value=await getOperationsConfig();setConfig(value);setHours(JSON.stringify(value.serviceHours,null,2));setFallbackCopy(value.publicFallback.copy);setFallbackContact(value.publicFallback.contact??'');setCategories(JSON.stringify(value.categories,null,2));setSops(JSON.stringify(value.sops,null,2));setResponders(JSON.stringify(value.responders,null,2));setRevision(value.version);}
    catch(cause){setError(cause instanceof Error?cause.message:'Konfigurasi belum dapat dimuat.');if(cause instanceof DemoServiceError&&cause.status===401){markStaffLoggedOut();navigate('/dashboard/login',{replace:true});}}
    finally{setLoading(false);}
  },[markStaffLoggedOut,navigate]);
  useEffect(()=>{void load();},[load]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!config||saving)return;setSaving(true);setError('');setNotice('');setConflict(false);
    try{
      const input:OperationsConfigurationInput={timezone:'Asia/Makassar',serviceHours:JSON.parse(hours),publicFallback:{copy:fallbackCopy.trim(),contact:fallbackContact.trim()||null},categories:JSON.parse(categories),sops:JSON.parse(sops),responders:JSON.parse(responders)};
      const updated=await updateOperationsConfig(config.version,input);setConfig(updated);setRevision(updated.version);setHours(JSON.stringify(updated.serviceHours,null,2));setCategories(JSON.stringify(updated.categories,null,2));setSops(JSON.stringify(updated.sops,null,2));setResponders(JSON.stringify(updated.responders,null,2));setNotice(`Snapshot konfigurasi v${updated.version} tersimpan. Kategori dan roster hanya simulasi.`);
    }catch(cause){if(cause instanceof DemoServiceError&&cause.status===409){setConflict(true);setError('Konfigurasi berubah sejak dibuka. Muat snapshot terbaru sebelum mengedit lagi.');}else setError(cause instanceof Error?cause.message:'Konfigurasi belum dapat disimpan. Periksa format JSON dan batas server.');if(cause instanceof DemoServiceError&&cause.status===401){markStaffLoggedOut();navigate('/dashboard/login',{replace:true});}}
    finally{setSaving(false);}
  }
  if(!principal)return <Navigate to="/dashboard/login" replace/>;
  if(principal.role!=='operator_admin')return <Navigate to="/dashboard" replace/>;
  return <main className="dashboard-page"><header className="dashboard-header"><Brand/><div className="dashboard-head-center">KONFIGURASI OPERASIONAL <span className="demo-chip">STAGING</span></div><div className="dashboard-head-actions"><Link className="dashboard-home-link" to="/dashboard">Antrian</Link><Link className="dashboard-home-link" to="/dashboard/accounts">Akses staff</Link><Link className="dashboard-home-link" to="/dashboard/audit">Audit</Link></div></header><div className="dashboard-body settings-page">
    <div className="dashboard-title-row"><div><p className="eyebrow">OPERATOR ADMIN · LOCAL-STAGING</p><h1>Konfigurasi operasional</h1><p>Versi {config?.version??'—'} · {config?.timezone??'Asia/Makassar'} · seluruh responder disimulasikan</p></div><DemoNotice compact/></div>
    <div className="editorial-state"><strong>Konfigurasi versi tersimpan sebagai snapshot.</strong><span>Menyimpan akan membuat versi baru. Assignment tetap pilihan internal dan tidak mengirim dispatch atau acknowledgement ke pihak luar.</span></div>
    {loading?<div className="empty-list-state" role="status"><CircleNotch className="spin" size={24}/>Memuat konfigurasi…</div>:error&&(!conflict||!config)?<div className="editorial-state editorial-error" role="alert"><span>{error}</span><button className="button button-outline" onClick={()=>void load()}>Coba muat ulang</button></div>:<form className="operations-settings-form" onSubmit={event=>{void save(event);}}>
      {conflict&&<div className="editorial-state editorial-error" role="alert">{error}<button type="button" className="button button-outline" onClick={()=>void load()}>Muat versi terbaru</button></div>}{notice&&<p className="success-note" role="status">{notice}</p>}
      <section className="settings-section"><h2>Jam layanan</h2><p>Gunakan JSON array dengan weekday ISO (Senin=1, Minggu=7) dan rentang jam lokal. Maksimal 28 rentang.</p><label>Service hours JSON<textarea className="editorial-input code-input" value={hours} onChange={e=>setHours(e.target.value)} maxLength={5000}/></label></section>
      <section className="settings-section"><h2>Fallback publik</h2><label>Salinan informasi<textarea className="editorial-input" rows={3} maxLength={2000} value={fallbackCopy} onChange={e=>setFallbackCopy(e.target.value)}/></label><label>Kontak staging (opsional)<input className="editorial-input" maxLength={200} value={fallbackContact} onChange={e=>setFallbackContact(e.target.value)}/></label></section>
      <section className="settings-section"><h2>Kategori dan required fields</h2><p>Daftar field JSON; field description sudah tersedia dalam form laporan. Setiap kategori aktif harus memiliki SOP pada snapshot ini.</p><label>Categories JSON<textarea className="editorial-input code-input" value={categories} onChange={e=>setCategories(e.target.value)} maxLength={8000}/></label></section>
      <section className="settings-section"><h2>SOP staging</h2><p>Gunakan ID kategori yang tersedia, nomor versi, judul, dan langkah yang membantu petugas mengikuti alur simulasi.</p><label>SOP JSON<textarea className="editorial-input code-input" value={sops} onChange={e=>setSops(e.target.value)} maxLength={8000}/></label></section>
      <section className="settings-section"><h2>Roster responder simulasi</h2><p>Availability, kategori, dan coverage hanya untuk pemilihan internal di staging. Maksimal total request 8 KB.</p><label>Responders JSON<textarea className="editorial-input code-input" value={responders} onChange={e=>setResponders(e.target.value)} maxLength={8000}/></label></section>
      {error&&!conflict&&<p className="form-error" role="alert">{error}</p>}<div className="settings-save-row"><span>Versi saat dibuka: {revision}</span><button type="submit" className="button button-primary" disabled={saving||conflict||!config}>{saving?'Menyimpan snapshot…':'Simpan sebagai versi baru'}</button></div>
    </form>}
  </div></main>;
}

function StaffAccessManagementPage() {
  const { principal, logout, markStaffLoggedOut } = useDemo();
  const navigate = useNavigate();
  const onSessionEnded = useCallback(() => { markStaffLoggedOut(); navigate('/dashboard/login', { replace: true }); }, [markStaffLoggedOut, navigate]);
  if (!principal) return <Navigate to="/dashboard/login" replace />;
  if (principal.role !== 'operator_admin') return <Navigate to="/dashboard" replace />;
  return <StaffAccountsPage principal={principal} logout={logout} onSessionEnded={onSessionEnded} />;
}

function StaffAuditViewPage() {
  const { principal, logout, markStaffLoggedOut } = useDemo();
  const navigate = useNavigate();
  const onSessionEnded = useCallback(() => { markStaffLoggedOut(); navigate('/dashboard/login', { replace: true }); }, [markStaffLoggedOut, navigate]);
  if (!principal) return <Navigate to="/dashboard/login" replace />;
  if (principal.role !== 'auditor' && principal.role !== 'operator_admin') return <Navigate to="/dashboard" replace />;
  return <StaffAuditPage principal={principal} logout={logout} onSessionEnded={onSessionEnded} />;
}

function StaffOutboxViewPage() {
  const { principal, markStaffLoggedOut } = useDemo();
  const navigate = useNavigate();
  const onSessionEnded = useCallback(() => { markStaffLoggedOut(); navigate('/dashboard/login', { replace: true }); }, [markStaffLoggedOut, navigate]);
  if (!principal) return <Navigate to="/dashboard/login" replace />;
  if (principal.role !== 'auditor' && principal.role !== 'operator_admin') return <Navigate to="/dashboard" replace />;
  return <StaffOutboxPage principal={principal} onSessionEnded={onSessionEnded} />;
}

function StaffMonitoringViewPage() {
  const { principal, markStaffLoggedOut } = useDemo();
  const navigate = useNavigate();
  const onSessionEnded = useCallback(() => { markStaffLoggedOut(); navigate('/dashboard/login', { replace: true }); }, [markStaffLoggedOut, navigate]);
  if (!principal) return <Navigate to="/dashboard/login" replace />;
  return <StaffMonitoringPage principal={principal} onSessionEnded={onSessionEnded} />;
}

function StaffDispatchViewPage() {
  const {principal,markStaffLoggedOut}=useDemo();
  const navigate=useNavigate();
  const onSessionEnded=useCallback(()=>{markStaffLoggedOut();navigate('/dashboard/login',{replace:true});},[markStaffLoggedOut,navigate]);
  if(!principal)return <Navigate to="/dashboard/login" replace/>;
  if(principal.role!=='dispatcher'&&principal.role!=='supervisor')return <Navigate to="/dashboard" replace/>;
  return <StaffDispatchPage principal={principal} onSessionEnded={onSessionEnded}/>;
}

function StaffGuard({ children }: PropsWithChildren) {
  const { isStaff, authChecking } = useDemo();
  if (authChecking) return <main className="app-page"><AppHeader title="Dashboard petugas" /><div className="page-container narrow-container not-found-panel"><CircleNotch className="spin" size={30} /><h1>Memeriksa sesi petugas…</h1></div></main>;
  return isStaff ? children : <Navigate to="/dashboard/login" replace />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [pathname]);
  return null;
}

export function App() {
  return (
    <DemoProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/report/new" element={<ReportNewPage />} />
          <Route path="/report/:token" element={<ReportStatusPage />} />
          <Route path="/dashboard/login" element={<DashboardLoginPage />} />
          <Route path="/dashboard/monitoring" element={<StaffGuard><StaffMonitoringViewPage /></StaffGuard>} />
          <Route path="/dashboard/dispatch" element={<StaffGuard><StaffDispatchViewPage /></StaffGuard>} />
          <Route path="/dashboard/realtime" element={<StaffGuard><StaffOutboxViewPage /></StaffGuard>} />
          <Route path="/dashboard/audit" element={<StaffGuard><StaffAuditViewPage /></StaffGuard>} />
          <Route path="/dashboard/accounts" element={<StaffGuard><StaffAccessManagementPage /></StaffGuard>} />
          <Route path="/dashboard/operations" element={<StaffGuard><OperationsSettingsPage /></StaffGuard>} />
          <Route path="/dashboard" element={<StaffGuard><DashboardPage /></StaffGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </DemoProvider>
  );
}
