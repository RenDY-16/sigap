# Roadmap Implementasi SIGAP Operasional

**Tanggal:** 3 Oktober 2026  
**Status:** Fase 1–3 source terintegrasi. Pada 3 Oktober 2026, migration 0001–0004 berhasil diterapkan ke database PostgreSQL staging sintetis lokal; `db:status` melaporkan schema v4 dan `pending: []`. Server startup, `GET /`, `/api/healthz`, dan `/api/readyz` memberi HTTP 200. Typecheck/build sebelumnya lulus dengan warning bundle JavaScript utama sekitar 1.62 MB. Workflow transaksi, auth/role, Socket.IO delivery, UI/browser, restart/restore dan walkthrough belum diverifikasi. Review fase 3 source telah diperbaiki/review ulang.  
**Arah yang dikonfirmasi:** platform operasional berbasis dispatcher manusia; integrasi dispatch resmi dilakukan setelah instansi, kanal, dan kontraknya tersedia.

**Runtime staging yang diverifikasi 3 Oktober 2026:** `GET /` 200; `/api/healthz` 200; `/api/readyz` 200 dengan schema version 4; `/api/operations/public-config` 200 dan hanya memberi config publik simulasi yang di-allowlist; `/api/staff/incidents` dan `/api/staff/operations/config` tanpa sesi memberi 401 `staff_session_required`. Ini tidak memverifikasi sesi terautentikasi, RBAC/region, mutasi workflow, transaksi, Socket.IO, atau UI/browser.

Dokumen ini menjaga cakupan tujuan penuh. Plan database/persistence yang terpisah adalah fase pertama, bukan definisi selesai. Aplikasi tetap berada di staging dengan data sintetis sampai pemilik layanan, SOP, privasi, fallback, keamanan, dan dukungan operasi disetujui.

## Target produk

SIGAP perlu menjadi platform operasional yang menangani alur warga dan petugas secara persisten, berotorisasi, dapat diaudit, serta jujur tentang status respons. Scope produk mencakup:

- Warga membuat laporan, berbagi lokasi secara sadar, melihat status faktual, menghentikan tracking, dan meminta pembatalan.
- Dispatcher menangani antrean, acknowledge, triage, assignment/rujukan, eskalasi, dan penyelesaian dengan alasan serta histori.
- Supervisor mengambil alih antrean terlambat dan mengeskalasi sesuai kebijakan layanan.
- Administrator mengatur wilayah, jam layanan, kategori, SOP, responder/kanal, roster, dan kebijakan operasional.
- Auditor/petugas privasi meninjau akses dan perubahan sesuai haknya; retensi, anonimisasi, penghapusan, dan permintaan subjek data mengikuti kebijakan yang disetujui.
- Identitas staf individual, RBAC dan cakupan wilayah berlaku pada REST, Socket.IO, dan akses peta/lokasi.
- Monitoring, alerting, anti-abuse, backup/restore, recovery, dan lingkungan development/staging/production menjadi bagian dari sistem.
- Adapter responder mendukung acknowledgement, idempotency, retry, dead-letter/manual review, tetapi tidak diaktifkan ke instansi nyata sebelum otorisasi dan kontrak tersedia.

Landing page tetap mengikuti desain 3D editorial yang telah dipilih. Halaman warga dan seluruh halaman selain landing mengikuti keputusan **EDITORIAL-UI**, dengan hierarki yang tenang dan interaksi operasional yang jelas.

## Bukti kondisi awal — historis sebelum fase 1/2

Daftar berikut merekam baseline lama dan tidak menyatakan kondisi source saat ini. Status terbaru dicatat pada tiap fase; session demo/global staff room pada baseline telah diganti pada implementasi fase 2.

- Incident disimpan di `Map` dalam proses dan hilang saat restart: [`incident-store.ts`](../../frontend/src/server/store/incident-store.ts).
- Sesi staf memakai `MemoryStore` serta flag akun demo tunggal: [`staff-session.ts`](../../frontend/src/server/auth/staff-session.ts).
- Route staf hanya memeriksa sesi, daftar insiden tidak dibatasi per role/wilayah, dan Socket.IO memakai satu room staf global: [`staff-incidents.ts`](../../frontend/src/server/routes/staff-incidents.ts), [`socket-server.ts`](../../frontend/src/server/realtime/socket-server.ts).
- Unit masih `DEMO_UNITS`; API status terbatas pada verifikasi/selesai dan assignment demo: [`domain.ts`](../../frontend/src/shared/domain.ts), [`incident-service.ts`](../../frontend/src/server/services/incident-service.ts).
- Health check hanya menunjukkan proses aktif; belum memeriksa database/readiness. Belum ada rate limiting, structured operational logging, atau production deployment config: [`app.ts`](../../frontend/src/server/app.ts), [`config.ts`](../../frontend/src/server/config.ts).

## Urutan kerja dan kriteria selesai

### Fase 1 — Durable incident core

**Status:** source selesai dan terintegrasi. Database PostgreSQL staging lokal berhasil dibuat dan readiness server mengonfirmasi schema v4; transaksi incident, concurrency, auth, restart/restore dan browser belum diverifikasi.

**Plan rinci:** [SIGAP Durable Incident Core](../superpowers/plans/2026-10-03-sigap-durable-incident-core.md).

PostgreSQL menyimpan incident, latest consented location, status history, audit, token/idempotency digests, dan outbox. Migrasi, readiness, create retry yang idempotent, transaksi status/GPS/withdrawal, snapshot realtime, dan pemulihan setelah restart diterapkan pada staging. Withdrawal menghentikan tracking; request tampil pending hingga workflow operator diproses. Tidak ada database in-memory fallback.

**Selesai jika:** data dan state konsisten setelah restart; konflik retry menghasilkan perilaku yang terdefinisi; race lokasi/withdrawal terserialisasi; kegagalan DB tidak memberi konfirmasi sukses; reconnect mengambil snapshot yang sah; payload realtime membawa event ID tanpa membocorkan secret; label staging tetap jelas.

### Fase 2 — Identitas, akses, dan sesi staf

**Status:** source selesai, direview, dan terintegrasi. `npx tsc --noEmit` dan `npm run build` lulus pada workspace utama; build memberi warning bundle utama >500 kB. Review realtime independen tidak menemukan temuan P1/P2/P3. Tidak ada tests, database, migrasi, server, atau browser yang dijalankan. [Plan fase 2](../superpowers/plans/2026-10-03-sigap-staff-identity.md).

Implementasi source: CLI `npm run staff:bootstrap` membuat operator_admin pertama tanpa shared/default password; sesi PostgreSQL dengan SID hash, expiry absolut delapan jam, tombstone, serta version revocation; REST role/region scope; account lifecycle di `/dashboard/accounts`; scoped incident/staff administration audit di `/dashboard/audit`; Editorial-UI selain landing; socket principal revalidation, room wilayah dan disconnect pada logout/revoke/disable. Callback outbox memakai PoolClient aktif untuk semua recipient/session/region/audit SQL dan savepoint per event, tanpa mengambil koneksi pool tambahan.

Role sementara adalah dispatcher (read/work), supervisor (read/work/escalation), operator_admin (read/audit/account admin tanpa workflow), auditor (read/audit saja). Semua incident/audit access memerlukan scope eksplisit; provisioning masih satu wilayah sintetis `local-staging`. Mutasi akses/credentials/session dan audit atomik; minimal satu operator_admin aktif dipertahankan. Audit `incident:realtime_delivery_attempt` berarti server attempt saja, tidak membuktikan browser receipt/human read. Actor individual berada pada audit/status server; DTO warga memakai `staff` dan menjaga `staff-demo` sebagai legacy.

Lanjutan sebelum non-sintetis: pisahkan metode autentikasi staging dari produksi dengan adapter/IdP yang disetujui; dukung OIDC/MFA sesuai kebijakan operator. Sesi persisten/revocable, bootstrap, provisioning/deprovisioning dan revoke seluruh sesi akun sudah tersedia pada source staging. Pemulihan akun produksi serta ownership provisioning tetap perlu desain operator.

Role/region scope sudah diterapkan pada source REST, Socket.IO, detail insiden, koordinat dan audit staging. Operator perlu mengesahkan matriks sementara dan menentukan scope organisasi/task nyata. Semua perubahan akses mencatat actor individual; perluasan wilayah/audit provenance dilakukan setelah kebijakan disetujui.

**Selesai jika:** endpoint dan event menolak akses lintas role/wilayah; menonaktifkan akun atau mencabut sesi menutup akses REST dan socket; tidak ada self-registration publik yang memberi privilege; aksi admin dapat ditelusuri; hak final disetujui pemilik layanan sebelum pilot.

**Keputusan eksternal:** identity provider, kebijakan MFA/pemulihan, siapa yang memprovisikan akun, role final, akses lokasi dan audit, serta organisasi/wilayah.

### Fase 3 — Operator configuration dan workflow lengkap

**Status:** Task 1–4 terintegrasi dan direview pada source. Migration `0004_operator_workflow.sql` berhasil diterapkan di database staging sintetis lokal. Startup, `/`, `/api/healthz`, dan `/api/readyz` berhasil; status migrasi schema v4, tanpa pending. HTTP workflow, transaksi, Socket.IO, autentikasi dan perilaku UI/browser belum diverifikasi saat runtime. Typecheck/build sebelumnya lulus; bundle utama sekitar 1.62 MB dengan warning Vite.

**Plan rinci:** [plan operator configuration dan workflow](../superpowers/plans/2026-10-03-sigap-operator-workflow.md).

Source menyediakan konfigurasi versi-baru per snapshot wilayah sintetis: service hours/timezone, fallback copy/contact, kategori dan required fields, SOP berversi, roster responder simulasi, availability dan category/region coverage. Public config memakai allowlist dan tidak mengeluarkan roster/SOP; route staf untuk konfigurasi dilindungi role dan scope. Setiap kategori aktif harus memiliki SOP. Penggantian config memakai expected version, append-only snapshot dan audit; config conflict memberi HTTP 409 dan klien perlu reload/review sebelum menyimpan ulang.

Warga dapat mengambil kategori/field yang aktif dari public config. Create menyematkan config version, kategori, jawaban ternormalisasi dan payload percobaan. Retry yang belum pasti mempertahankan token, idempotency key dan payload persis sama. Jika server mengembalikan `operations_version_conflict` (reject sebelum commit), klien memuat config terbaru dan meminta warga meninjau ulang; konflik lain tetap mempertahankan draft untuk retry. Jam layanan dan fallback bersifat informasi di UI; staging tetap menerima form di luar jam layanan. Service hours tidak dibuktikan sebagai server-side intake gate.

Queue/detail staf memakai pagination cursor dan filter server untuk status, owner, withdrawal pending, serta umur antrean. Claim/release/takeover dan mutasi workflow membawa expected status/owner, alasan bounded, dan SOP ID/version yang dipatok pada konfigurasi insiden. Aksi tersedia menurut capability/precondition server. Transition sementara: `received → acknowledged → triaged → assigned → in_progress → resolved`; cabang termasuk `triaged/assigned/in_progress → referred`, `assigned → delivery_failed → escalation_pending → assigned|referred`. `resolved`/`referred` terminal dan terminalisasi ditolak ketika withdrawal masih pending. Assignment memilih entri roster simulasi yang enabled, available, dan sesuai coverage; ini hanya catatan assignment internal dan tidak memberi bukti pengiriman/ack responder.

Permintaan withdrawal adalah keputusan workflow tersendiri dengan outcome pending/accepted/denied dan audit; tidak mengganti status operasi yang sudah tercatat. Permintaan langsung menghentikan tracking lokasi dan server menolak update lokasi berikutnya; tidak ada restart tracking otomatis. Public citizen projection/history/outbox menghapus identitas staf, owner, alasan internal, workflow privat, ID/label responder dan hanya memakai actor generik `staff`; petugas berwenang membaca detail workflow terpisah. Coordinate retention/deletion tetap menunggu policy.

UI konfigurasi berada di `/dashboard/operations`, queue/detail di `/dashboard`, akun di `/dashboard/accounts`, audit di `/dashboard/audit`, login di `/dashboard/login`, create laporan di `/report/new`, dan status warga di `/report/:token`. API source mencakup `GET /api/operations/public-config`, `GET/PUT /api/staff/operations/config`, `GET /api/staff/operations/work-config`, serta create/read dan workflow incident routes yang memakai DTO warga/staf terpisah. Role sementara: dispatcher membaca dan mengerjakan workflow biasa; supervisor memiliki kemampuan dispatcher dan eskalasi/takeover; operator_admin membaca insiden/audit dan mengelola akun/config tanpa workflow; auditor hanya membaca insiden/audit. Semua selain landing mempertahankan EDITORIAL-UI.

**Sisa kriteria fase 3:** verifikasi migration/schema dan transaksi di PostgreSQL, route HTTP/auth, socket invalidation, conflict/retry, cross-region/role enforcement dan walkthrough browser; review akhir setelah integrasi utama. Nilai wilayah/jam layanan/SOP/required fields/roster nyata/fallback resmi/SLA serta pemilik keputusan masih harus ditentukan organisasi. Tidak ada kesiapan operasional yang dibuktikan.

### Fase 4 — Responder/channel adapter

Buat antarmuka adapter outbound dan durable dispatch-intent queue yang terpisah dari status internal. Implementasikan mock/sandbox adapter lokal untuk menguji lifecycle, serta operasi operator manual jika integrasi belum dikonfigurasi. Adapter nyata hanya diaktifkan dengan endpoint/kanal resmi dan secret yang disediakan pihak berwenang.

**Selesai jika:** intent idempotent; retry/backoff dan dead-letter/manual review bekerja; correlation ID serta acknowledgement tersimpan/audited; duplicate/replay tidak membuat pengiriman ganda; UI menyampaikan status berdasar acknowledgement; kegagalan beralih ke prosedur fallback yang disetujui.

**Keputusan eksternal wajib:** instansi dan pemilik teknis, yurisdiksi, kanal/API, sandbox, kontrak acknowledgement, kredensial, batas rate, legal/security review, fallback resmi, dan uji penerimaan bersama responder. Sampai lengkap, integrasi nyata dinonaktifkan dan SIGAP tidak boleh mengklaim bantuan sudah dikirim.

### Fase 5 — Privacy lifecycle, security, dan anti-abuse

Lakukan threat model untuk spam/laporan palsu, token enumeration, replay, stalking, internal misuse, privilege escalation, CSRF/session, XSS, dan denial of service. Tambahkan rate/abuse controls, validasi/rules, keamanan cookie/header, secret management, redaksi log, dependency patching, audit akses administratif, dan prosedur security incident. Pengendalian abuse harus tetap menyediakan jalur yang dapat digunakan warga sah.

Implementasikan privacy lifecycle berdasarkan policy: data minimization, purpose, consent, akses lokasi presisi, retensi per jenis data, deletion/anonymization, ekspor/permintaan subjek data, penanganan legal hold bila memang diwajibkan, serta backup expiry. Purge terjadwal harus idempotent dan tercatat tanpa mengekalkan data sensitif yang seharusnya dihapus.

**Selesai jika:** petugas privasi menyetujui kebijakan; data yang kedaluwarsa dipurge/anonymize sesuai policy termasuk backup sesuai siklus yang didefinisikan; tidak ada token, password, uraian sensitif, atau presisi lokasi dalam telemetry default; security assessment dan abuse exercises ditutup tanpa temuan blocker.

**Keputusan eksternal:** yurisdiksi, pemilik data, dasar dan tujuan pengolahan, masa simpan, hak akses/penghapusan/ekspor, legal hold, serta pemilik security/privacy incident.

### Fase 6 — Reliability, observability, deployment, dan kesiapan pilot

Implementasikan health/liveness/readiness nyata, metrik usia antrean/delivery/DB/realtime, structured logs yang disanitasi, alert routing ke on-call, runbooks, capacity/load/failure checks, backups terenkripsi, restore drills, migrations/rollback, disaster recovery, TLS/network/access controls, serta dev/staging/production separation. Tetapkan service SLO, SLA acknowledgement, peak-load assumptions, RPO/RTO, support hours, maintenance/incident process dan fallback saat layanan/tiles/channel down.

**Selesai jika:** uji restore dan failure memenuhi target yang disepakati; alert tiba ke penerima yang ditetapkan; staging terisolasi memakai data sintetis; pilot runbook/tabletop selesai; pemilik layanan, operator, responder, security/privacy, dan technical support menandatangani checklist readiness.

**Keputusan eksternal:** hosting/data residency, biaya, DNS/TLS, backup provider, on-call owner, target SLO/RPO/RTO, peak volume, support, dan persetujuan pilot. Tidak ada layanan berbayar yang dipilih tanpa persetujuan biaya.

## Ketergantungan fase

Fase 1 adalah dasar persistence untuk fase 2–6. Fase 2 mendahului akses data operasional dan pembatasan wilayah fase 3. Fase 3 menyediakan internal dispatch lifecycle untuk adapter fase 4. Kebijakan privacy/security perlu disepakati sejak awal fase 1 dan ditegakkan sebelum data non-sintetis (fase 5). Fase 6 dapat berjalan paralel pada environment staging, tetapi pilot menunggu semua fase, pihak eksternal, latihan, dan sign-off selesai.

## Batas verifikasi saat ini

Fase 1–3 source terintegrasi. Typecheck/build sebelumnya lulus dengan warning bundle utama sekitar 1.62 MB; empat protected Sites files sebelumnya cocok dengan hash baseline. Database staging sintetis lokal menjalankan migration 0001–0004; `db:status` menunjukkan schema v4 tanpa pending. Server startup, halaman root, health/readiness, public config allowlisted dan penolakan route staff tanpa sesi telah diverifikasi sesuai status di atas. Tidak ada tests ditambahkan atau dijalankan. Business workflow/transactions, authenticated role isolation, Socket.IO delivery, browser rendering, restart/restore dan walkthrough operator/warga belum diverifikasi. Fase 4 adapter/provider contract, fase 5 privacy lifecycle/security/anti-abuse, dan fase 6 reliability/observability/deployment tetap pekerjaan berikutnya. Tidak ada responder, dispatch channel, acknowledgment responder, layanan berbayar, atau kesiapan darurat yang dipilih atau dibuktikan.

## Kondisi yang belum boleh diklaim selesai

Build yang berhasil, login yang bekerja, peta yang tampil, atau database yang persisten saja tidak menjadikan SIGAP layanan darurat. Goal ini tetap aktif sampai kemampuan aplikasi di atas benar-benar diterapkan dan diverifikasi. Pilot/operasi publik tetap merupakan gate terpisah hingga ada operator, wilayah, SOP, fallback, persetujuan responder, kebijakan data, target keandalan, dukungan, dan deployment yang disetujui.

## Dokumen rujukan

- [PRD operasional](./PRD-sigap-operasional-draft.md)
- [Arsitektur operasional](./operational-architecture-draft.md)
- [Analisis gap](./full-feature-gap-analysis.md)
- [Plan fase pertama](../superpowers/plans/2026-10-03-sigap-durable-incident-core.md)

## Kemajuan keamanan — 12 Oktober 2026

Guard request staf kini mencakup login/logout, akun, konfigurasi dan mutasi workflow: header `X-SIGAP-Request: staff` wajib; Origin yang ada harus sama dengan host/protokol koneksi; Fetch Metadata lintas situs maupun same-site sibling ditolak. Handshake Engine.IO juga menolak origin browser berbeda sebelum session middleware. Tidak ada izin CORS baru atau trust terhadap forwarded headers. API staf memakai Cache-Control no-store dan response memakai nosniff.

Typecheck lulus. Probe HTTP/Engine.IO terisolasi dengan database yang sengaja tidak tersedia memeriksa 13 skenario, semuanya sesuai hasil yang diharapkan. Semua request yang ditolak guard menghasilkan nol akses DB pada probe. Probe tidak membuktikan login dengan akun, transaksi PostgreSQL, browser, HTTPS atau reverse proxy. Detail di [catatan keamanan request](./staff-request-security.md). Ini menyelesaikan sebagian kontrol fase 5; fase 4–6 serta verifikasi end-to-end tetap belum selesai.

## Kemajuan throttle login — 12 Oktober 2026

Migration 0005 menyediakan bucket persisten, counter saturasi, expiry dan cleanup bounded. Reservasi tiga bucket atomik dilakukan sebelum verifikasi password; 429/Retry-After generik, 503 fail-closed. Sebelas pemeriksaan PostgreSQL/HTTP pada database sintetis terpisah berhasil, termasuk 20 request serentak, pembuatan ulang app, expiry, batas lintas sumber dan login admin yang menghasilkan sesi usable. Migration diterapkan ke staging lokal: schema v5, ready true, pending kosong. Lihat [login-throttle.md](./login-throttle.md). Fase 4–6 dan verifikasi workflow menyeluruh tetap terbuka.

## Kemajuan walkthrough — 12 Oktober 2026

Test HTTP/PostgreSQL sintetis mencakup 23 kelompok pemeriksaan: akun/role, region boundary, create retry/concurrency, ownership race/release/takeover, config version/pinned SOP/required fields, lifecycle/escalation/referral, roster availability, withdrawal accept/deny dan tracking stop, public/outbox redaction, cursor/filter, audit, app/pool recreation dan account disable. Seluruhnya berhasil. Ini memperkuat bukti runtime fase 1–3 pada cakupan test; browser, GPS perangkat, delivery/replay/revocation socket, restore drill serta gate fase 4–6 masih belum selesai. Detail: [workflow-verification.md](./workflow-verification.md).

## Kemajuan realtime — 12 Oktober 2026

Native Socket.IO WebSocket/polling dan PostgreSQL diverifikasi dengan 20 kelompok pemeriksaan. Pool berukuran satu tidak deadlock pada flow yang diuji. Fault audit mencegah partial emit dan event berhasil dicoba ulang setelah fault dilepas. GPS protocol, citizen/region isolation, replay ID/helper dedup, account/session revocation, expiry saat delivery/reconnect dan shutdown gates diperiksa. Receipt klien native bukan bukti browser/human read atau responder acknowledgement. Retry count cap/dead-letter/manual review, provider dispatch queue, browser/device dan gate fase 4–6 masih terbuka. Detail: [realtime-verification.md](./realtime-verification.md).

## Kemajuan reliability realtime — 12 Oktober 2026

Migration 0006, cap 8 kegagalan per siklus, dead-letter, lifetime failures, review metadata scoped dan admin retry/audit atomik telah diintegrasikan. UI berada di /dashboard/realtime. Sepuluh kelompok pemeriksaan outbox-review dan regresi workflow 23, login 11, realtime 20 berhasil; build/typecheck lulus. DB lokal schema v6 ready tanpa pending; server loopback readiness berhasil. UI browser belum diverifikasi. Lihat [outbox-review.md](./outbox-review.md). Provider dispatch subsystem, privacy lifecycle, intake controls, observability/alerts, disaster recovery, deployment dan gate pilot tetap terbuka.

## Intake create protection — 12 Oktober 2026

Migration 0007 menambahkan request budget persisten PostgreSQL untuk POST laporan warga: sumber koneksi 120/60 detik, token normalisasi 10/60 detik. HTTP 429 menyertakan Retry-After; storage limiter tidak tersedia menghasilkan 503. Ambang staging dan direct ingress saja; proxy dan trafik layanan nyata masih perlu assessment. Gunakan `npm run db:migrate`, `npm run db:status`, serta `npm run test:intake-throttle` untuk verifikasi sintetis. Rincian ada di `docs/fathul/intake-throttle.md` pada root workspace.
