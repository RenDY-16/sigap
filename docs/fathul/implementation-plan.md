# Sistem SOS Keamanan Publik Implementation Plan

> **Status dokumen:** Ini rencana historis prototipe lokal tanggal 2 Oktober 2026. Checklist dan model in-memory pada bagian bawah merekam rencana awal, bukan status source terkini. Fase 1–3 source terintegrasi; migration 0001–0004 kini diterapkan di database staging sintetis lokal dan readiness dasar berhasil pada schema v4. Workflow bisnis/runtime masih belum diverifikasi. Gunakan [PRD operasional](./PRD-sigap-operasional-draft.md), [roadmap operasional penuh](./roadmap-sigap-operasional.md), dan [panduan demo staging](../../frontend/docs/fathul/run-demo.md) untuk status yang benar. Tidak ada klaim kesiapan darurat.

> **For agentic workers:** Implement this plan task by task. Do not begin until this plan and its source documents have been reviewed.

**Goal:** Membangun prototipe SOS keamanan publik yang dapat didemokan dari ponsel warga dan dashboard petugas di jaringan lokal yang sama.

**Architecture (snapshot historis 2 Oktober):** Satu aplikasi web React melayani halaman warga dan dashboard. Server Node.js/Express menyajikan API dan Socket.IO, dengan penyimpanan insiden in-memory pada versi prototipe saat dokumen ini ditulis. Implementasi phase-1 saat ini menggunakan PostgreSQL lokal/staging untuk insiden, riwayat, audit, dan outbox; phase-2 mengganti sesi demo dengan akun individual dan sesi PostgreSQL revocable. Landing menggunakan scene 3D Three.js terpisah dari peta operasional Leaflet.

**Tech Stack:** Node.js 24 LTS, npm, React 19, TypeScript, Vite, Express, `express-session` dengan PostgreSQL session store, PostgreSQL 18 untuk database lokal/staging, `pg`, Socket.IO, React Three Fiber 9, Three.js, GLB/glTF, GSAP ScrollTrigger, dan Leaflet. Versi dependency dikunci di `package-lock.json`. Konfigurasi PostgreSQL dan backup/restore lokal ada di [panduan demo staging](../../frontend/docs/fathul/run-demo.md).

**Spec:** [PRD](./PRD-sistem-SOS-keamanan-publik.md) dan [design.md](./design.md)

**Status rencana historis:** Front-end demo lokal awal  
**Status implementasi saat ini:** Fase 1–3 source terintegrasi di workspace utama. Fase 3 Task 1–4 telah direview setelah perbaikan; TypeScript check dan production build lulus pada pemeriksaan sebelumnya, dengan bundle utama sekitar 1.62 MB dan warning ukuran Vite. Migration 0001–0004 berhasil diterapkan pada database sintetis lokal; server startup, `/`, `/api/healthz`, dan `/api/readyz` berhasil pada schema v4. Tidak ada tests ditambahkan/dijalankan. Workflow bisnis, auth/region enforcement, HTTP mutasi, Socket.IO delivery, browser, restore atau walkthrough belum diverifikasi. Source/readiness dasar bukan bukti production/emergency readiness.  
**Tanggal pembaruan:** 3 Oktober 2026

| Area | Status |
|---|---|
| Fase 1 — durable incident core | Terintegrasi ke workspace utama; source/typecheck/build sebelumnya telah selesai, tetapi runtime PostgreSQL, transaksi, restart/restore dan browser belum diverifikasi. |
| Fase 2 — staff identity dan access | Terintegrasi ke workspace utama; source review/typecheck/build sebelumnya selesai. Login, revocation, role/region enforcement, audit dan realtime belum divalidasi saat runtime. |
| Fase 3 — configuration, API, workflow dan Editorial-UI | Task 1–4 terintegrasi; migration 0004 diterapkan pada database sintetis lokal dan readiness schema v4 berhasil. Business workflow dan UI runtime belum diverifikasi. |
| Fase 4–6 | Belum dikerjakan: provider/dispatch adapter; privacy lifecycle, security, anti-abuse; reliability, observability, deployment dan readiness gates. |

**Workspace baseline:** Source aplikasi lokal berada di `frontend/`, terpisah dari dokumen produk di `docs/fathul/`. Workspace ini tidak memiliki repository Git; rencana ini tidak menginisialisasi remote atau workflow Git.

## Status implementasi lokal

Source di `frontend/` memakai React 19, TypeScript, dan Vite untuk client serta Express, Socket.IO, dan PostgreSQL untuk API/realtime. Rute yang tersedia: `/`, `/report/new`, `/report/:token`, `/dashboard/login`, `/dashboard`, `/dashboard/accounts` untuk operator_admin, dan `/dashboard/audit` untuk auditor/operator_admin. Insiden, status, riwayat, audit, dan durable outbox disimpan dalam database staging lokal. Akun staf dan sesi memakai PostgreSQL; expiry absolut delapan jam, tombstone revocation dan versi akun menjaga invalidasi sesi. Restart proses saja tidak menghapus sesi aktif.

Untuk development, Vite meneruskan `/api` dan `/socket.io` ke Express. Server menjalankan migrasi saat startup dan menyediakan `/api/readyz`; detail langkah start/status/shutdown database ada pada panduan demo. Typecheck dan production build lulus pada pengecekan phase-1 sebelumnya. Database runtime, restart/recovery, dan restore belum dibuktikan dalam task dokumentasi ini. Data laporan akan tetap ada setelah server aplikasi restart selama database dan named volume dipertahankan; `npm run db:down` hanya menghapus container. Semua data tetap harus sintetis. Sistem tidak mengirim laporan ke layanan darurat, dan status/unit staging tidak menandakan responder nyata.

Hero memakai aset PNG transparan di `frontend/public/assets/city-safety-hero.png`, ditampilkan di scene React Three Fiber dan digerakkan oleh GSAP ScrollTrigger. Aset Blender/GLB yang editable belum tersedia; fallback statis dan reduced-motion tersedia.

## Phase-2 — staff identity dan batas akses staging

Acuan rinci: [plan staff identity](../superpowers/plans/2026-10-03-sigap-staff-identity.md). Password memakai scrypt async dengan salt acak; sesi PostgreSQL menyimpan SID hash, expiry immutable dan tombstone. Login meregenerasi SID. Account disable/reset/perubahan role-scope/revoke menaikkan versi serta mencabut sesi dan menulis audit dalam satu transaksi; minimal satu operator_admin aktif dengan wilayah dipertahankan.

Role sementara: dispatcher membaca/mengerjakan insiden; supervisor juga mengelola eskalasi; operator_admin membaca insiden/audit dan mengelola akun tanpa workflow; auditor membaca insiden/audit saja. Semua incident/audit reads memakai region scope server; provisioning saat ini hanya `local-staging`. `/dashboard/accounts` dan `/dashboard/audit` memakai Editorial-UI dengan loading, empty, error dan guard role. Scope/matriks final, organisasi, IdP/MFA, throttle login persisten, recovery/provisioning, retensi dan ownership audit multiwilayah masih menunggu keputusan operator.

Realtime memakai durable session principal, room per wilayah dan revalidasi DB untuk setiap recipient pada setiap broadcast. Callback outbox memakai PoolClient publisher yang sama untuk principal/sesi, region storage dan audit, sehingga tidak memerlukan koneksi pool kedua. Urutan delivery: outbox rows → shared admin advisory mutex → account/session recipient checks → lookup incident region read-only → audit seluruh recipient → emit. Admin mengambil exclusive mutex; tidak ada explicit incident row lock pada delivery. Savepoint per event mengembalikan transaksi sebelum retry bila authorization/audit SQL gagal. Ini belum membuktikan perilaku concurrency runtime.

Audit `incident:realtime_delivery_attempt` mengidentifikasi staf penerima dengan metadata tanpa koordinat; ini hanya server attempt, bukan bukti browser receipt/human read. DTO warga/outbox memakai actor generik `staff`, mempertahankan `staff-demo` sebagai legacy; actor individu tetap pada audit/status server. Hook logout dan account revocation terhubung ke disconnect socket lokal, dengan recheck DB pada koneksi dan setiap broadcast.

### Verifikasi dan pekerjaan berikutnya

Untuk fase 3, independent/scoped source review, `npx tsc --noEmit`, `npm run build` pada workspace utama, dan protected-file comparison adalah batas verifikasi pembaruan ini. Tidak ada tests ditambahkan/dijalankan, lifecycle database/migrasi tidak dijalankan, dan browser tidak dibuka. Login akun individual, scope/role, audit, revocation/expiry, satu koneksi pool, concurrency, restart/restore dan visual UI tetap belum diverifikasi di runtime. Keberhasilan build tidak menyatakan siap untuk operasi publik atau bantuan darurat nyata.

## Status phase 3 — sumber aktif

Untuk status yang paling baru, gunakan [roadmap operasional](./roadmap-sigap-operasional.md). Source fase 3 mencakup endpoint `GET /api/operations/public-config`, `GET/PUT /api/staff/operations/config`, `GET /api/staff/operations/work-config`, antrean staff terfilter/paginasi, dan flow citizen create/status. Frontend routes mencakup `/report/new`, `/report/:token`, `/dashboard`, `/dashboard/operations`, `/dashboard/accounts`, dan `/dashboard/audit`. Role mengikuti capability dan region scope dari principal yang dibaca ulang server.

Kategori dan field intake berasal dari konfigurasi publik yang allowlisted. SOP/roster tidak dikirim ke publik. Staff queue/detail hanya berisi data privat untuk role/scope berwenang. Version conflict (`409`) harus diikuti reload/review; retry create yang masih ambigu memakai token/key/payload sama, sementara hanya server `operations_version_conflict` yang dapat me-reset draft dan memuat versi terbaru. Withdrawal menghentikan update lokasi, menyimpan outcome terpisah dari status operasi, dan tidak memulai tracking otomatis. Public citizen projection/outbox menghapus owner, actor identity, responder roster ID/label, reason dan private workflow history.

Semua ini adalah perilaku source fase 3 yang terintegrasi. Migration 0004 kini diterapkan pada database sintetis lokal dan readiness schema v4 terbukti; endpoint business/API, socket, dan browser flow belum diverifikasi.

## Global Constraints

- Produk hanya prototipe demo dan tidak mengirim laporan ke layanan darurat atau petugas sungguhan.
- Kategori MVP hanya insiden keamanan.
- Warga tidak membuat akun dan tidak memasukkan nama atau kontak.
- Browser hanya meminta dan membaca lokasi GPS setelah server mengonfirmasi SOS aktif; hentikan watch saat laporan dibatalkan, selesai, atau mode berganti ke simulasi.
- Laporan GPS boleh aktif dengan koordinat `null` sementara browser mencari fix; warga dan dashboard harus melihat status “GPS belum tersedia”.
- Lokasi GPS dan lokasi simulasi harus ditandai eksplisit pada warga dan dashboard; titik simulasi tetap dapat dipilih setelah laporan aktif.
- Warga dapat membuka laporan dan mengajukan penghentian berbagi lokasi melalui token insiden yang sulit ditebak; permintaan ini tidak otomatis mengubah status penanganan laporan.
- CTA landing hanya membuka form; SOS baru berstatus aktif setelah server berhasil membuat laporan.
- Dashboard memakai akun staf individual; CLI `npm run staff:bootstrap` membuat operator_admin pertama setelah migrasi. Tidak ada shared/default password atau public self-registration. Operator_admin mengelola lifecycle akun melalui `/dashboard/accounts`.
- Validasi semua payload server: kategori tetap `security`, deskripsi dibatasi panjangnya, koordinat harus berada pada rentang latitude/longitude yang valid, dan `unitId` harus berasal dari daftar unit demo.
- Status phase-1: `received`, `acknowledged`, `triaged`, `assigned`, `in_progress`, `referred`, `delivery_failed`, `escalation_pending`, atau `resolved`; status terminal tidak menerima pembaruan lokasi. Daftar lama di checklist bawah adalah kontrak prototipe saat dokumen ditulis.
- Insiden, riwayat status, audit, outbox, akun dan sesi staf disimpan di PostgreSQL lokal/staging. Staging hanya boleh memakai data sintetis.
- Akses perangkat LAN menggunakan HTTPS dengan sertifikat yang dipercaya perangkat presentasi.
- Pasang `Referrer-Policy: no-referrer`; jangan menulis token insiden pada query string, log request, analytics, atau telemetry.
- Peta operasional menggunakan Leaflet dan basemap daring dengan atribusi penyedia yang terlihat. Untuk tile standar OpenStreetMap, jangan melakukan prefetch/bulk download dan jangan menganggap layanan memiliki SLA.
- Koordinat pusat demo, URL tile, dan atribusi adalah konfigurasi publik `VITE_*` yang dibaca saat build; jangan menaruh kredensial server pada variabel `VITE_*`.
- Scene 3D hanya untuk landing; data koordinat dan marker laporan yang sebenarnya berada pada peta operasional.
- Landing harus menghormati `prefers-reduced-motion` dan menampilkan aset statis jika WebGL tidak tersedia.
- Animasi tidak boleh menghalangi SOS, pembatalan, form, status, koordinat, atau kontrol peta.
- Kontrol utama dapat digunakan dengan keyboard, fokus terlihat jelas, input memiliki label, dan status penting tidak disampaikan melalui warna saja.
- Tidak menambahkan biaya langganan, database cloud, atau hosting publik ke scope MVP.

## Review Focus

- Izin lokasi ditolak/tidak tersedia: tawarkan lokasi simulasi dan jangan pernah menampilkannya sebagai GPS.
- Laporan dibatalkan atau selesai: hentikan watch browser dan tolak pembaruan lokasi berikutnya di server.
- Klien tersambung ulang setelah kehilangan koneksi: ambil snapshot terbaru dari HTTP sebelum menyatakan status realtime pulih; outbox realtime adalah pembaruan, bukan sumber tunggal.
- Server aplikasi restart: insiden tetap tersedia selama database staging dan named volume dipertahankan; sesi aktif tetap ada di PostgreSQL hingga expiry/revocation; login ulang diperlukan jika cookie/secret tidak lagi sesuai.
- Database tidak siap/outage: `/api/readyz` memberi 503; client tidak menyebut create tersimpan sebelum API mengonfirmasi sukses dan retry memakai idempotency key yang sama.
- Tile peta tidak termuat: pertahankan koordinat, sumber lokasi, status, serta deskripsi laporan.
- Token warga salah/kedaluwarsa atau petugas belum login: jangan mengembalikan detail insiden atau menerima tindakan perubahan status.

---

## Arsitektur dan kontrak — snapshot historis prototipe

> **Penting:** seluruh source tree, tipe domain, endpoint API, event socket, dan state transition di bagian ini adalah snapshot rencana prototipe tanggal 2 Oktober 2026. Kontrak status, API, persistence, dan realtime tersebut sudah digantikan oleh phase-1 durable core dan phase-2 staff identity. Jangan gunakan detail historis berikut untuk mengembangkan atau mengoperasikan source saat ini; gunakan [plan phase-1](../superpowers/plans/2026-10-03-sigap-durable-incident-core.md), [plan staff identity](../superpowers/plans/2026-10-03-sigap-staff-identity.md), dokumen [PRD operasional](./PRD-sigap-operasional-draft.md), dan source `frontend/src/`.

### Susunan source saat ini

```text
frontend/
  package.json
  index.html
  tsconfig.json
  src/
    App.tsx
    components/MapView.tsx
    domain/demoService.ts     # REST API client dan pending-create sessionStorage
    main.tsx
    realtime/socketClient.ts
    scene/CityScene.tsx
    scene/useLandingScrollScene.ts
    server/                  # Express, routes, PostgreSQL, migrations, outbox, Socket.IO
    shared/                  # DTO domain dan event Socket.IO
    styles.css
  public/assets/city-safety-hero.png
  qa/
docs/fathul/
```

Source client dan server hidup berdampingan di `frontend/src/`. Vite development memakai proxy `/api` dan `/socket.io`; Express dapat menyajikan hasil build client dari satu origin. Konfigurasi HTTPS LAN lokal disediakan untuk demo, tetapi ini bukan instruksi deployment produksi.

Server development berjalan pada port lokal terpisah dari Vite dengan proxy `/api` dan `/socket.io`. Pada demo LAN, Express menyajikan build Vite, REST API, dan Socket.IO dari satu HTTPS origin. Tidak perlu mengoperasikan dua server publik.

### Model domain

```ts
type IncidentStatus =
  | "new"
  | "verified"
  | "unit_assigned"
  | "completed"
  | "cancelled";

type LocationSource = "gps" | "simulation";

interface GeoPoint {
  lat: number;
  lng: number;
}

interface IncidentLocation extends GeoPoint {
  source: LocationSource;
  updatedAt: string;
}

interface IncidentRecord {
  id: string;
  accessTokenDigest: string;
  createPayloadDigest: string;
  category: "security";
  description: string;
  status: IncidentStatus;
  locationMode: LocationSource;
  location: IncidentLocation | null;
  unitId: string | null;
  statusHistory: StatusHistoryItem[];
  createdAt: string;
  updatedAt: string;
}

interface StatusHistoryItem {
  status: IncidentStatus;
  actor: "citizen" | "staff-demo";
  changedAt: string;
}

interface CreateIncidentInput {
  category: "security";
  description: string;
  locationMode: LocationSource;
  initialLocation: GeoPoint | null;
}

interface LocationPickerMapProps {
  initialPoint: GeoPoint;
  onSelect(point: GeoPoint): void;
}

interface CitySceneProps {
  progress: number;
  reducedMotion: boolean;
  fallback: boolean;
}

type LocationState = "idle" | "gps_pending" | "requesting" | "gps_ready" | "simulation_ready" | "tracking" | "error";
type LandingChapter = "kenali" | "laporkan" | "pantau" | "selesai";

type PublicIncident = Omit<IncidentRecord, "accessTokenDigest" | "createPayloadDigest">;

interface IncidentServices {
  createIncident(input: CreateIncidentInput, accessToken: string): PublicIncident;
  getIncidentForCitizen(token: string): PublicIncident;
  updateIncidentLocation(token: string, point: GeoPoint, source: LocationSource): PublicIncident;
  cancelIncidentForCitizen(token: string): PublicIncident;
  listIncidentsForStaff(): PublicIncident[];
  setIncidentStatus(id: string, next: "verified" | "completed"): PublicIncident;
  assignIncidentUnit(id: string, unitId: string): PublicIncident;
}
```

`IncidentRecord` hanya ada di server. API dan socket tidak pernah mengirimkan `accessTokenDigest` atau `createPayloadDigest`. Client membuat token 32-byte dari `crypto.getRandomValues()` setelah form siap dikirim; nilai token yang sama menjadi `Idempotency-Key` dan credential bearer. Server menyimpan digest token dan hash payload, bukan nilai token aslinya. Route warga `/report/:token` memakai token agar warga dapat membuka status lagi; cegah kebocoran melalui query string, log, analytics, atau referrer lintas origin.

### HTTP API

| Method dan path | Akses | Tujuan |
|---|---|---|
| `POST /api/citizen/incidents` | Publik + `Idempotency-Key` acak 256-bit | Body membawa `locationMode` dan `initialLocation`: mode simulasi wajib membawa titik; mode GPS membuat insiden aktif dengan lokasi `null`. Key sama dengan payload sama mengembalikan insiden lama; payload berbeda mendapat `409`. Token tidak dikembalikan ulang oleh server. |
| `GET /api/citizen/incidents` | Bearer token insiden | Mengambil snapshot status warga; token dikirim melalui `Authorization`, bukan query string. |
| `POST /api/citizen/incidents/cancel` | Bearer token insiden | Membatalkan insiden dan mengakhiri pembaruan lokasi. |
| `PUT /api/citizen/incidents/location` | Bearer token insiden | Menetapkan titik simulasi pilihan warga pada laporan aktif bila GPS tidak tersedia; server memaksa source `simulation`. |
| `POST /api/staff/session` | Publik, kredensial demo | Membuat sesi petugas. |
| `DELETE /api/staff/session` | Petugas login | Menghapus sesi petugas. |
| `GET /api/staff/incidents` | Petugas login | Mengambil daftar insiden untuk dashboard. |
| `PATCH /api/staff/incidents/:id/status` | Petugas login | Transisi `new` → `verified` atau `unit_assigned` → `completed`; status lain ditolak. |
| `PATCH /api/staff/incidents/:id/assignment` | Petugas login | Memilih unit dari allowlist; menetapkan `unitId` dan mengubah `verified` menjadi `unit_assigned`. |
| `GET /api/healthz` | Lokal | Menunjukkan server aktif tanpa membuka data insiden. |

Browser membuat token akses acak 256-bit sebelum submit dan menyimpannya di `sessionStorage` bersama draft sampai server mengonfirmasi create. Nilai itu dikirim sebagai `Idempotency-Key` pada create dan dipakai sebagai bearer token untuk status/cancel/location; server hanya menyimpan digest token. Jangan log header tersebut. Jika respons create hilang, client mengulang request dengan token dan payload yang sama sehingga server mengembalikan insiden yang sama selama proses server yang sama masih hidup, bukan membuat duplikat.

### Socket.IO rooms dan events

- `incident:<id>`: warga masuk setelah token divalidasi; hanya menerima snapshot dan perubahan insidennya.
- `staff:incidents`: hanya sesi petugas terautentikasi; menerima insiden baru, posisi, pembatalan, penugasan, dan status.
- Warga mengirim token melalui `socket.handshake.auth.accessToken`; server memvalidasi saat handshake lalu langsung bergabung ke room insidennya. Jangan menerima token dari query string atau event `incident:watch`.
- Socket petugas memakai session cookie melalui middleware Express session yang sama dengan HTTP; jangan mengirim kredensial akun pada payload socket.
- Client → server: `incident:location:update` untuk posisi GPS selama laporan aktif; titik simulasi manual dikirim melalui endpoint REST yang membatasi source menjadi `simulation`.
- Server → client: `incident:snapshot`, `incident:created`, `incident:location:updated`, `incident:status:updated`, `incident:cancelled`, `incident:error`.
- Saat reconnect, klien mengambil ulang snapshot HTTP. Server tidak menganggap event yang terlewat otomatis akan diputar ulang.
- Middleware Express session yang sama dipasang ke Socket.IO. Saat logout, hancurkan sesi dan putuskan socket yang terkait dengan session ID itu; periksa masa berlaku sesi sebelum broadcast sensitif agar socket bersesi kedaluwarsa tidak tetap menerima data.

### State transitions

```text
new -> verified -> unit_assigned -> completed
  \         \             \
   +---------+---------------> cancelled
```

Pembatalan dapat dilakukan warga dari status aktif mana pun melalui token miliknya. Petugas hanya dapat memverifikasi, menetapkan unit, lalu menyelesaikan laporan. Riwayat status yang tampil di halaman warga bersifat sementara di memori server, bukan audit log permanen. Status `completed` dan `cancelled` terminal. Setelah terminal, API dan socket menolak update lokasi.

### Catatan peta dan scene

- Scene landing memuat `mini-city.glb` melalui React Three Fiber/Three.js. GSAP ScrollTrigger menghubungkan scroll progress ke posisi kamera dan reveal konten tanpa mengganti scroll browser dengan scroll buatan.
- Siapkan aset fallback `mini-city-fallback.webp`; defer/lazy-load scene, dan jangan membuat WebGL menghambat interaksi form.
- Buat scene kota 3D orisinal berdasarkan mockup terpilih memakai Blender saat implementasi; simpan source `.blend` di `assets-source/mini-city.blend` dan ekspor `public/assets/mini-city.glb`. Blender tidak terpasang sekarang dan bukan dependency aplikasi; gunakan instalasi portable/user-level tanpa menambah biaya berlangganan.
- Batas aset landing: GLB maksimal 4 MB, maksimal 100.000 triangles, tekstur maksimal 1024×1024; fallback WebP maksimal 350 KB. Scene tetap lazy-loaded, dan kegagalan atau lambatnya WebGL tidak boleh menghambat form.
- Peta operasional Leaflet menampilkan koordinat insiden, status lokasi pending/GPS/simulasi, dan atribusi basemap. Pusat peta berasal dari konfigurasi build `VITE_DEMO_MAP_CENTER_LAT` dan `VITE_DEMO_MAP_CENTER_LNG`; jangan menetapkan wilayah sungguhan sebelum pengguna memilihnya. Tile URL dan atribusi memakai `VITE_MAP_TILE_URL` dan `VITE_MAP_ATTRIBUTION`.
- Default tile `https://tile.openstreetmap.org/{z}/{x}/{y}.png` hanya untuk demo lokal bervolume rendah, dengan atribusi terlihat persis `© OpenStreetMap contributors`, `Referrer-Policy: no-referrer` sehingga request tile tidak menerima referrer, cache browser standar, dan hanya tile viewport yang diminta. Jangan prefetch/bulk download atau menawarkan offline tiles; layanan publik tidak menjanjikan SLA. Sediakan konfigurasi provider pengganti.
- Bila tile gagal, peta menampilkan koordinat dan lokasi pada panel teks/list; jangan menyembunyikan data insiden.

## Rencana implementasi historis

Checklist berikut mendokumentasikan rencana prototipe awal; phase persisten dan langkah menjalankan database yang aktif dirinci pada [plan phase-1](../superpowers/plans/2026-10-03-sigap-durable-incident-core.md) dan [panduan demo lokal](../../frontend/docs/fathul/run-demo.md). Status checkbox lama tidak menggantikan verifikasi runtime atau persetujuan produksi.

### Task 1: Fondasi aplikasi dan kontrak bersama

**Files:**
- Create: `package.json`, `package-lock.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `.gitignore`
- Create: `src/shared/domain.ts`, `src/shared/socket-events.ts`
- Create: `src/server/app.ts`, `src/server/index.ts`, `src/server/config.ts`
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Produces: `IncidentStatus`, `LocationSource`, `GeoPoint`, `IncidentLocation`, `IncidentRecord`, `PublicIncident` dan typed event map Socket.IO sesuai kontrak di atas.
- Produces: satu Express app yang memasang API dan Socket.IO pada HTTP server yang sama; Vite proxy hanya untuk development.

- [x] Buat Vite React + TypeScript app, gunakan npm yang tersedia, tambahkan Express, `express-session`, `dotenv`, Socket.IO, dan `tsx` untuk dev server TypeScript; siapkan script `dev:web`, `dev:server`, `build`, dan `start`.
- [x] Gunakan `App.tsx` untuk memetakan path `/`, `/report/new`, `/report/:token`, `/dashboard/login`, dan `/dashboard`; sediakan fallback server agar path aplikasi tetap membuka `index.html`.
- [x] Tulis tipe domain dan event bersama sekali di `src/shared`; gunakan tipe tersebut dari browser dan server.
- [x] Siapkan `GET /api/healthz` dan shell halaman yang sudah menampilkan label demo, menggunakan CSS tokens terang-editorial.
- [x] (Diperbarui pada phase-1) Kirim header `Referrer-Policy: no-referrer`; jangan pasang request logger atau analytics yang merekam route `/report/:token` atau header bearer.
- [x] Konfigurasikan server untuk dapat bind ke `0.0.0.0` dengan host/port dari environment; nilai bawaan tetap aman untuk development lokal.

### Task 2: Penyimpanan memori, aturan insiden, dan akun demo

**Files:**
- Create: `src/server/store/incident-store.ts`
- Create: `src/server/services/incident-service.ts`
- Create: `src/server/auth/staff-session.ts`
- Create: `src/server/routes/citizen-incidents.ts`, `src/server/routes/staff-incidents.ts`
- Modify: `src/server/app.ts`, `src/server/config.ts`

**Interfaces:**
- `createIncident(input: CreateIncidentInput, accessToken: string): PublicIncident`
- `getIncidentForCitizen(token: string): PublicIncident`
- `cancelIncidentForCitizen(token: string): PublicIncident`
- `updateIncidentLocation(token: string, point: GeoPoint, source: LocationSource): PublicIncident`
- `listIncidentsForStaff(): PublicIncident[]`
- `setIncidentStatus(id: string, next: "verified" | "completed"): PublicIncident`
- `assignIncidentUnit(id: string, unitId: string): PublicIncident`
- `IncidentServices` exposes the public and staff operations needed by Socket.IO and typed routes; token lookup errors resolve to `404`, invalid transitions to `409`.

- [x] Implementasikan `Map<string, IncidentRecord>` di `incident-store.ts`; jangan menambah database, file persistence, atau audit log permanen.
- [x] Implementasikan aturan transisi status di service; kembalikan error domain yang terpetakan ke HTTP `400`, `401`, `404`, atau `409` sesuai keadaan.
- [x] Catat `statusHistory` singkat (status, aktor `citizen`/`staff-demo`, waktu) di record memori agar timeline warga sesuai `design.md`; hapus bersama proses server.
- [x] Untuk mode GPS, izinkan insiden dibuat dengan lokasi `null` sampai fix pertama; update GPS berikutnya menetapkan `locationMode: "gps"`. Penetapan titik manual memperbarui `locationMode` dan source menjadi `simulation`; serialkan mutasi lokasi atau cek ulang mode tepat sebelum menyimpan supaya update GPS yang sudah antre tidak menimpa titik simulasi.
- [x] Saat request create memakai `Idempotency-Key` baru, simpan hanya digest token dan hash payload bersama insiden. Jika digest sudah ada dan hash payload cocok, kembalikan insiden yang ada; bila payload berbeda, kembalikan `409`. Jangan log key.
- [x] Validasi deskripsi 1–500 karakter, kategori `security`, kombinasi `locationMode`/`initialLocation` (GPS boleh `null`; simulasi wajib punya titik), latitude `-90..90`, longitude `-180..180`, status, dan unit di server. Batasi JSON request 8 KB dan jangan mempercayai validasi dari browser saja.
- [x] Pasang konfigurasi akun melalui `DEMO_STAFF_USERNAME`, `DEMO_STAFF_PASSWORD`, dan `SESSION_SECRET` dari `.env`; jangan simpan nilai rahasia di source atau `.env.example`.
- [x] Gunakan sesi cookie `HttpOnly`, `SameSite=Lax`, dan `Secure` pada akses HTTPS demo. Akun ini hanya untuk prototipe satu proses, bukan autentikasi produksi.
- [x] Terapkan endpoint pada tabel API. Status dan assignment hanya boleh diubah lewat sesi petugas.
- [x] Gunakan daftar demo unit generik `Unit 01`, `Unit 02`, `Unit 03`; semua UI selalu menamainya sebagai unit simulasi.

### Task 3: Alur warga dan pengelolaan lokasi browser

**Files:**
- Modify: `src/App.tsx`, `src/domain/demoService.ts`, `src/components/MapView.tsx`, `src/styles.css`

**Interfaces:**
- `useIncidentLocation(): { state: LocationState; startWatch(): void; stop(): void }`; call `startWatch()` only after server confirms GPS-mode create or the user explicitly resumes tracking on an active GPS-mode report.
- `LocationPickerMap({ initialPoint, onSelect }: LocationPickerMapProps): React.JSX.Element`
- Produces: route warga `/report/new` dan `/report/:token`; endpoint create/status/cancel/location dari Task 2.

- [x] Bangun form kategori keamanan, deskripsi, pilihan mode GPS/simulasi, serta peringatan demo yang terlihat sebelum aksi kirim.
- [x] Tambahkan Leaflet pada client dan `LocationPickerMap`; klik pada peta memilih titik simulasi, sementara input koordinat menyediakan alternatif bila tile gagal.
- [x] Jadikan CTA landing “Mulai simulasi SOS” sebagai tautan pembuka form saja. Untuk mode simulasi, wajib pilih titik sebelum submit dan jangan meminta Geolocation.
- [x] Untuk mode GPS, buat laporan aktif terlebih dahulu dengan lokasi `null`; hanya setelah server mengonfirmasi create, mulai `watchPosition` dan minta izin browser. Tampilkan “GPS belum tersedia” sampai fix pertama diterima.
- [x] Bila izin ditolak, prompt ditutup, atau browser tidak memberi fix, biarkan laporan tetap aktif dengan pesan jelas dan tawarkan titik simulasi yang bisa dipilih dari halaman status.
- [x] Saat warga memilih fallback simulasi, panggil `clearWatch` segera sebelum mengirim titik melalui `PUT /api/citizen/incidents/location`; tampilkan label `Lokasi simulasi` dan jangan mengubah titik itu menjadi GPS.
- [x] Panggil `clearWatch` saat status terminal, halaman/sesi aktif ditutup, mode berganti ke simulasi, atau hook dibersihkan; saat warga membuka kembali laporan aktif dengan mode GPS, sediakan aksi eksplisit “Lanjutkan berbagi lokasi” sebelum memulai watch lagi. Jangan mulai GPS watch untuk laporan mode simulasi.
- [x] Pusatkan peta awal memakai `VITE_DEMO_MAP_CENTER_LAT/LNG`. Tampilkan lokasi null sebagai keadaan menunggu, bukan koordinat pusat peta demo.
- [x] Buat laporan melalui `POST /api/citizen/incidents` memakai `locationMode` dan `initialLocation`, serta token 32-byte yang sama sebagai `Idempotency-Key` dan credential; simpan token serta draft di `sessionStorage` selama request pending, disable submit ganda, dan retry dengan key/payload yang sama jika respons jaringan hilang.
- [x] Setelah create dikonfirmasi, hapus draft pending dan navigasi ke `/report/:token`; bila mode GPS, mulai watch dari halaman status setelah aktivasi. Untuk status/cancel/location kirim token melalui `Authorization: Bearer`, bukan di URL API.
- [x] Tampilkan status, koordinat atau keadaan lokasi pending, sumber lokasi, error koneksi, dan aksi batal yang menjelaskan bahwa pembatalan menghentikan update lokasi. Ambil status melalui `GET /api/citizen/incidents` dan batalkan melalui `POST /api/citizen/incidents/cancel`.
- [x] Tampilkan state laporan tidak ditemukan atau error storage jika server tidak dapat membaca data; database staging persisten melewati restart aplikasi selama volumenya tetap tersedia.

### Task 4: Sinkronisasi Socket.IO

**Files:**
- Create: `src/server/realtime/socket-server.ts`
- Modify: `src/server/app.ts`, `src/server/auth/staff-session.ts`, `src/shared/socket-events.ts`
- Create: `src/realtime/socketClient.ts`
- Modify: `src/App.tsx`, `src/domain/demoService.ts`

**Interfaces:**
- `attachSocketServer(server: HttpServer, services: IncidentServices, sessionMiddleware: RequestHandler): ManagedSocketServer`
- `disconnectStaffSession(sessionId: string): void`
- `ManagedSocketServer` exposes the Socket.IO `io` instance and `disconnectStaffSession(sessionId)` for logout revocation.
- Socket warga menerima `socket.handshake.auth.accessToken`; event posisi GPS hanya berisi koordinat dan waktu pengukuran.

- [x] Validasi `socket.handshake.auth.accessToken` saat koneksi warga; masukkan koneksi ke room insiden yang sesuai saja dan kirim snapshot awal. Tolak token melalui query string.
- [x] Jalankan middleware Express session yang sama pada Socket.IO dan validasi sesi petugas sebelum memasukkan socket ke `staff:incidents`.
- [x] Simpan `sessionID` pada data socket petugas; setiap broadcast ke petugas mengecek sesi masih aktif. Logout menghancurkan sesi lalu memutus seluruh socket dengan `sessionID` tersebut.
- [x] Terima `incident:location:update` hanya dari koneksi bertoken valid dan insiden nonterminal yang masih `locationMode: "gps"`; tolak update GPS setelah mode berpindah ke simulasi, termasuk update yang sudah antre, lalu kirim DTO tersaring hanya jika mutasi diterima.
- [x] Broadcast `incident:created`, `incident:location:updated`, `incident:status:updated`, dan `incident:cancelled` hanya ke room yang berhak menerima; update lokasi manual melalui REST dan GPS melalui socket sama-sama memperbarui petugas.
- [x] Saat reconnect, warga dan dashboard mengambil ulang snapshot via HTTP sebelum indikator realtime kembali normal.
- [x] Tampilkan offline/reconnecting dan waktu pembaruan terakhir; jangan menampilkan pesan terkirim jika server tidak mengonfirmasi event.

### Task 5: Dashboard petugas dan peta operasional

**Files:**
- Modify: `src/App.tsx`, `src/components/MapView.tsx`, `src/styles.css`
- Modify: `src/server/realtime/socket-server.ts`

**Interfaces:**
- Produces: route `/dashboard/login` dan `/dashboard`; dashboard menggunakan `PublicIncident[]` dari API dan event `staff:incidents`.

- [x] Buat login demo; dashboard tanpa sesi diarahkan ke layar login.
- [x] Susun daftar laporan dan Leaflet map berdampingan di desktop; pada ponsel susun kedua panel secara vertikal.
- [x] Tampilkan marker GPS dan simulasi dengan label sumber yang terbaca; jangan mengandalkan warna saja.
- [x] Tampilkan laporan GPS yang belum memiliki fix sebagai `GPS belum tersedia`; jangan tempatkan marker palsu pada pusat map demo.
- [x] Gunakan default demo `https://tile.openstreetmap.org/{z}/{x}/{y}.png` dengan atribusi persis `© OpenStreetMap contributors`; URL/attribution dapat diganti via `VITE_MAP_TILE_URL`/`VITE_MAP_ATTRIBUTION`. Tile hanya untuk viewport aktif dan memakai cache browser; `Referrer-Policy: no-referrer` mencegah route token dikirim sebagai referer. Jangan prefetch atau menawarkan offline download.
- [x] Gunakan konfigurasi tile serta atribusi yang sama untuk pemilih lokasi dan peta dashboard melalui komponen `MapView`.
- [x] Batasi `unitId` ke daftar unit simulasi yang disediakan; ketika assignment berhasil, tampilkan status `unit_assigned` di daftar, detail, dan halaman warga.
- [x] Sediakan panel detail, status, koordinat, sumber lokasi, kontrol verifikasi/penugasan/selesai, dan tombol eksplisit “Pusatkan ke laporan”.
- [x] Jika tile gagal, biarkan daftar, koordinat, dan status tetap berfungsi.
- [x] Kirim perubahan petugas melalui API Task 2 dan perbarui warga/dashboard melalui Socket.IO Task 4.

### Task 6: Landing 3D dan scroll journey

**Files:**
- Modify: `src/App.tsx`, `src/styles.css`
- Present: `src/scene/CityScene.tsx`, `src/scene/useLandingScrollScene.ts`
- Pending: `public/assets/mini-city.glb`, `public/assets/mini-city-fallback.webp`, `assets-source/mini-city.blend`

**Interfaces:**
- `CityScene({ progress, reducedMotion, fallback }: CitySceneProps): React.JSX.Element`
- `useLandingScrollScene(): { progress: number; activeChapter: LandingChapter }`

- [ ] Buat model mini-kota orisinal di Blender berdasarkan mockup yang dipilih, mencakup beacon kaca serta jalur cahaya; simpan source `.blend` dan ekspor GLB. Blender belum terpasang pada workspace ini; siapkan tool authoring secara portable/user-level saat implementasi, tanpa menambah dependency runtime atau biaya berlangganan.
- [ ] Pertahankan anggaran aset: GLB maksimal 4 MB, maksimal 100.000 triangles, tekstur maksimal 1024×1024; fallback WebP maksimal 350 KB. Catat sumber/lisensi aset pada README bila ada tekstur atau objek pihak ketiga.
- [x] Tambahkan `three`, `@react-three/fiber` major 9, dan `gsap`; pertahankan React 19 agar versi major React Three Fiber kompatibel.
- [ ] Muat scene secara lazy dengan React Three Fiber/Three.js; gunakan kamera ortografik/perspektif yang konsisten dengan mockup terpilih. Scene sudah memakai kamera ortografik, tetapi masih diimpor langsung; bundle klien utama melewati ambang advisori Vite.
- [x] Bangun timeline GSAP ScrollTrigger untuk empat bab Kenali, Laporkan, Pantau, dan Selesai; scroll hanya mengendalikan progres scene dan tidak mengunci aksi atau mengganti mekanisme scroll browser.
- [x] Sinkronkan headline/reveal DOM dengan bab scene; CTA “Mulai simulasi SOS” selalu terjangkau dan membuka form warga.
- [x] Pada ponsel, tampilkan headline, demo notice, dan CTA sebelum visual 3D; scene boleh memakai gerak yang lebih ringan tanpa mengubah alur scroll.
- [x] Hormati `prefers-reduced-motion`: nonaktifkan camera travel/reveal, render konten langsung dan gunakan aset PNG statis sebagai fallback.
- [x] Sediakan fallback saat WebGL/asset gagal agar landing tidak menahan navigasi ke form. Batas GLB, tekstur, dan geometri belum dapat diverifikasi sebelum model dibuat.

### Task 7 historis: HTTPS LAN dan panduan demo

**Files:**
- Modify: `src/server/index.ts`, `src/server/config.ts`, `package.json`, `.env.example`, `.gitignore`
- Create: `frontend/docs/fathul/run-demo.md` (panduan aktif sekarang mencakup PostgreSQL lokal dan recovery staging)

**Interfaces:**
- Server demo lokal/staging menerima `TLS_CERT_PATH`, `TLS_KEY_PATH`, `HOST`, `PORT`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `DEMO_STAFF_USERNAME`, `DEMO_STAFF_PASSWORD`, dan `SESSION_SECRET`; build web menerima `VITE_DEMO_MAP_CENTER_LAT`, `VITE_DEMO_MAP_CENTER_LNG`, `VITE_MAP_TILE_URL`, dan `VITE_MAP_ATTRIBUTION`.
- `npm run start` melayani web build, REST API, dan Socket.IO dari satu origin HTTPS.

- [ ] Tambahkan HTTPS server yang membaca path sertifikat dari environment; gagal dengan pesan yang jelas jika sertifikat dibutuhkan tetapi tidak tersedia.
- [ ] Tambahkan instruksi membuat/memasang sertifikat lokal yang mencakup alamat LAN yang dipakai dan cara mempercayai CA pada perangkat demo.
- [ ] Bind server ke `0.0.0.0` hanya untuk mode demo LAN; dokumentasikan port, firewall lokal, dan alamat HTTPS yang dibuka di ponsel.
- [x] Dokumentasikan HTTPS/izin Geolocation/tile internet, persistence PostgreSQL lokal sampai volume dihapus, readiness, graceful shutdown, backup/restore staging, serta larangan memakai sistem sebagai layanan darurat nyata di [panduan demo](../../frontend/docs/fathul/run-demo.md).
- [ ] Minta presenter mengatur `VITE_DEMO_MAP_CENTER_LAT/LNG`, `VITE_MAP_TILE_URL`, dan `VITE_MAP_ATTRIBUTION` sebelum `npm run build`; variabel tersebut dibaca saat build, bukan runtime server. Jangan menetapkan wilayah geografis sebelum dipilih pengguna. Sertakan default tile URL/attribution OSM serta cara mengganti provider.
- [ ] Dokumentasikan batas layanan tile OSM standar: demo ber-volume rendah, internet dibutuhkan, atribusi harus tampak, gunakan referrer/cache default, jangan prefetch/bulk download atau mengandalkan SLA.
- [ ] Pastikan `.env`, private key, certificate development, dan data lokal tidak masuk ke file source bersama.

## Kondisi demo staging lokal

Kriteria di bawah membantu menjalankan demo teknis lokal; terpenuhinya kriteria ini tidak menjadikan SIGAP layanan darurat atau deployment produksi.

- Warga dapat membuat laporan tanpa akun, melihat peringatan demo, dan mendapat tautan/token unik.
- Lokasi GPS hanya mengalir ketika laporan aktif; mode simulasi selalu dibedakan.
- Dashboard petugas terkunci di balik akun demo dan dapat melihat laporan baru tanpa reload.
- Status, assignment, posisi, pembatalan, dan penyelesaian disinkronkan ke klien yang berhak.
- Pembatalan/penyelesaian menghentikan browser location watch dan update server.
- Setelah server restart, laporan tetap dapat dibaca selama PostgreSQL dan named volume dipertahankan; sesi staff demo meminta login kembali.
- `/api/readyz` membedakan proses hidup dari database/schema siap. Saat database tidak tersedia, create tidak dilaporkan sukses dan UI menampilkan kegagalan.
- Backup/restore hanya memakai data sintetis dan restore latihan diarahkan ke database pemeriksaan terpisah.
- Halaman pengantar memiliki scroll journey 3D dan fallback reduced motion; layar SOS tetap cepat dan stabil.
- Kegagalan koneksi atau tile tidak menyembunyikan informasi status, koordinat, dan sumber lokasi.

## Referensi teknis

- [React Learn](https://react.dev/learn)
- [Vite Guide](https://vite.dev/guide/)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Express getting started](https://expressjs.com/en/starter/hello-world/)
- [Socket.IO: how it works](https://socket.io/docs/v4/how-it-works/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [React Three Fiber](https://r3f.docs.pmnd.rs/)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)
- [Leaflet API reference](https://leafletjs.com/reference.html)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)


## Status terbaru — fase 3 source terintegrasi (3 Oktober 2026)

Bagian atas dan checklist historis dokumen ini tidak lagi menjadi kontrak source aktif. Fase 3 mencakup migration `0004_operator_workflow.sql` (sudah diterapkan pada database sintetis lokal), konfigurasi berversi dan allowlist publik, citizen category/required-fields intake, role-scoped route config/queue/work-config, lifecycle status/ownership/assignment/withdrawal, dan UI Editorial-UI. Readiness schema v4 sudah berhasil; business workflow belum diverifikasi runtime. Rincian route, role, transition, retry/conflict, projection privasi dan verifikasi ada di [roadmap operasional](./roadmap-sigap-operasional.md) dan [PRD](./PRD-sigap-operasional-draft.md).

Task 1–4 telah direview secara independen/scoped dengan perbaikan sebelum integrasi. `npx tsc --noEmit` dan `npm run build` lulus pada pemeriksaan sebelumnya dengan warning bundle utama sekitar 1.62 MB. Source fase 3 terintegrasi. Protected Sites files dan migration 0001–0003 sebelumnya tetap cocok dengan baseline. Migration 0001–0004 kini diterapkan di database sintetis lokal; startup/health/readiness HTTP berhasil. Tidak ada tests yang ditambahkan/dijalankan. Workflow HTTP/socket, browser/UI, restore dan walkthrough belum diverifikasi.

Fase 4 — provider contract/adapter dan durable dispatch intent — fase 5 — privacy lifecycle, security dan anti-abuse — serta fase 6 — operational reliability, observability, deployment dan readiness gates — masih belum dikerjakan. Tidak ada responder/channel resmi, real dispatch acknowledgement, policy retention, deployment/hosting atau pilot sign-off. Pertahankan data sintetis staging; dokumen ini tidak menyatakan layanan siap untuk darurat.
