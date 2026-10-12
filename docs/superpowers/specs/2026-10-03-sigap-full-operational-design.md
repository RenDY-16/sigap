# Desain SIGAP: workflow operasional penuh

**Tanggal:** 3 Oktober 2026  
**Status:** Draft desain untuk review pengguna; belum menjadi persetujuan implementasi  
**Persetujuan desain percakapan:** dispatcher manusia dengan handoff dan acknowledgment tercatat; integrasi resmi tetap dinonaktifkan sampai kontrak kanal tersedia.  
**Cakupan:** melanjutkan source fase 1–3 yang sudah ada menuju staging operasional yang dapat diuji. Dokumen ini tidak menyatakan layanan siap menerima laporan darurat publik.

## 1. Keputusan desain

SIGAP dibangun sebagai sistem intake dan operasi insiden dengan dispatcher manusia sebagai pengambil keputusan. Sistem menerima laporan, mengantrekannya, memberi dispatcher cara untuk mengakui dan menangani laporan, serta mencatat setiap handoff secara tahan restart. Status kepada pelapor mengikuti bukti tindakan yang tercatat.

Untuk fase engineering berikutnya, pengiriman keluar memakai **local mock adapter** yang hanya berjalan pada data sintetis. Adapter nyata dapat ditambahkan melalui kontrak yang sama setelah organisasi operator menyediakan instansi, otorisasi, sandbox, autentikasi, spesifikasi acknowledgment, batas retry, dan prosedur fallback. Tanpa bukti dari kanal itu, UI tidak boleh menyebut responder menerima atau bantuan dikirim.

Landing page mempertahankan desain editorial 3D yang telah dipilih. Seluruh halaman setelah landing menggunakan EDITORIAL-UI. Animasi dekoratif tidak boleh menghalangi alur laporan, pemantauan, atau tindakan petugas.

## 2. Hasil yang dituju

- Laporan warga, status, assignment internal, handoff, dan audit bertahan melewati restart.
- Dispatcher dapat menerima ownership, mengakui laporan, melakukan triage, mengirim handoff melalui dispatcher workflow, lalu mencatat bukti atau kegagalannya.
- Kegagalan, timeout, atau respons ambigu dari adapter tidak membuat duplikasi atau klaim sukses palsu; item masuk ke retry terkontrol atau review manual.
- Supervisor dapat menemukan item tertunda/gagal, mengambil alih, dan memutuskan eskalasi sesuai konfigurasi staging.
- Pengaturan role, wilayah, audit dan redaksi yang telah tersedia tetap berlaku untuk semua endpoint, socket, detail, lokasi, handoff, serta operasi admin.
- Retensi, ekspor, penghapusan/anonimisasi, kontrol abuse, observability, backup dan recovery memiliki fondasi teknis yang dapat dikonfigurasi dan diverifikasi di staging.
- Seluruh jalur staging memakai data sintetis dan label jelas bahwa tidak ada bantuan nyata yang dikirim.

## 3. Di luar cakupan yang dapat diputuskan sekarang

- Mengaktifkan API, SMS, WhatsApp, email, telepon, atau koneksi ke instansi/responder nyata.
- Menetapkan nama pemilik layanan, yurisdiksi, jam layanan, SOP resmi, nomor fallback, roster nyata, target response, retensi legal, atau klaim 24/7.
- Memilih vendor berbayar untuk hosting, database, peta, notifikasi, identitas atau observability.
- Menyebutkan sistem siap untuk pilot atau layanan darurat publik sebelum pemilik, responder, keamanan, privasi/hukum, operasi, dan penerimaan lapangan menyetujui.

## 4. Pengguna dan hak tindakan

Gunakan matriks role/region yang telah ada sebagai baseline sementara. Semua pemeriksaan dilakukan server-side dari principal aktif dan scope penyimpanan; visibilitas elemen UI bukan kontrol akses.

| Role sementara | Hak dalam desain ini |
|---|---|
| Dispatcher | Membaca laporan pada wilayahnya; claim/release; acknowledge; triage; menyiapkan dan mengirim handoff melalui adapter aktif; mencatat hasil yang benar-benar diketahui. |
| Supervisor | Hak dispatcher ditambah melihat item overdue/failure, takeover, retry yang diizinkan, review dead-letter, dan eskalasi sesuai konfigurasi. |
| Operator admin | Mengelola akun, konfigurasi wilayah/jam/SOP/adapter staging dan kebijakan teknis; tidak dapat melakukan workflow insiden kecuali organisasi kelak menyetujui role gabungan. |
| Auditor/petugas privasi | Membaca audit serta permintaan subjek data yang berada dalam scope; tidak mengubah laporan atau menjalankan dispatch. |
| Warga/pelapor | Membuat laporan dan melihat proyeksi privat minimum dengan bearer token; tidak dapat membaca metadata staf, catatan internal, konfigurasi rahasia, atau status adapter internal. |

Semua role, scope, pemisahan tugas, masa sesi, autentikasi/MFA, dan kewenangan ekspor perlu pengesahan pemilik layanan sebelum data nyata.

## 5. Alur operasional target

1. Warga melihat batas layanan, jam operasi, dan fallback resmi yang dikonfigurasi. Ia memilih kategori, memberi uraian, dan menyetujui lokasi jika dipakai.
2. Server menyimpan laporan secara durable dan mengembalikan status “diterima sistem, menunggu dispatcher”. Idempotency mempertahankan satu laporan untuk retry yang sama.
3. Dispatcher melihat laporan dalam antrean sesuai wilayah, memeriksa lokasi serta input, lalu menekan acknowledge. Status “diakui dispatcher” hanya berarti seorang dispatcher melakukan tindakan tersebut; status ini bukan pengiriman responder.
4. Dispatcher melakukan triage manusia sesuai SOP konfigurasi dan menulis alasan yang dibatasi pada kebutuhan operasi. Pemilihan unit internal tetap merupakan assignment, bukan bukti bahwa unit eksternal menerima tugas.
5. Jika perlu handoff, dispatcher membuat dispatch intent durable berisi referensi insiden, recipient/route yang diizinkan, ringkasan minimum, correlation ID, idempotency key, actor dan status awal. Payload dikirim melalui adapter yang diaktifkan admin. Untuk staging hanya local mock yang diizinkan.
6. Adapter memberikan hasil eksplisit: accepted/acknowledged, rejected, transient failure, permanent failure, atau unknown. Masing-masing hasil dicatat. `accepted` hanya boleh dipetakan ke klaim yang sesuai kontrak adapter; local mock selalu berlabel simulasi.
7. Timeout atau respons ambigu tidak mengulang secara buta bila hasil awal mungkin telah diterima. Intent masuk status `unknown` atau manual review sampai rekonsiliasi/retry yang aman dilakukan.
8. Supervisor memantau antrean, usia item, kegagalan, dan item yang menunggu review. Eskalasi menggunakan jam layanan/SOP staging dan tetap ditandai simulasi.
9. Dispatcher menutup/merujuk laporan berdasarkan outcome yang dapat dibuktikan. Warga mendapat status ringkas tanpa alasan internal atau identitas responder yang tidak disetujui.
10. Warga meminta penghentian lokasi kapan saja. Client berhenti mengirim segera; server menolak posisi baru. Permintaan pembatalan ditangani sebagai workflow terpisah dan tidak otomatis menghapus record yang mungkin diperlukan mengikuti kebijakan yang berlaku.

## 6. Model status dan istilah yang terlihat

Pisahkan status penanganan insiden dari lifecycle dispatch. Hindari memakai satu kolom untuk menyiratkan proses yang berbeda.

Status insiden mengikuti workflow phase-3 dan transition matrix yang telah tersedia: `received`, `acknowledged`, `triaged`, `assigned`, `in_progress`, `referred`, `delivery_failed`, `escalation_pending`, dan `resolved`, dengan prasyarat/role yang ditentukan server. `assigned` di staging berarti assignment internal saja.

Lifecycle dispatch intent terpisah: `queued`, `sending`, `accepted`, `rejected`, `retry_wait`, `unknown`, `manual_review`, `dead_letter`, `cancelled`. Acknowledgment remote menyimpan jenis, waktu, correlation ID, adapter, dan referensi bukti minimum. Local mock menampilkan badge “simulasi”.

Copy warga dibatasi pada istilah berikut:

- “Laporan diterima sistem” — commit penyimpanan berhasil.
- “Diakui dispatcher” — tindakan dispatcher tercatat.
- “Handoff dicatat/dicoba” — permintaan keluar dibuat atau dikirim, tidak otomatis berarti penerima mengakui.
- “Penerima mengakui” — hanya jika adapter produksi memberi bukti acknowledgment sesuai kontrak dan fitur nyata telah disetujui.
- “Bantuan sedang menuju lokasi” — tidak tersedia sampai responder/kanal menghasilkan fakta tersebut melalui alur berwenang.
- Semua outcome mock memuat penanda simulasi yang tampak oleh staf dan warga.

## 7. Arsitektur yang diusulkan

Pertahankan monolith modular saat ini (React/TypeScript, Express, Socket.IO, PostgreSQL). Belum ada alasan teknis atau anggaran untuk memecah layanan atau menambah vendor.

Komponen server:

1. **Incident workflow service:** validasi transition/precondition dan menulis status, audit, outbox dalam transaksi database.
2. **Dispatch coordinator:** membuat dispatch intent durable, mengambil pekerjaan dengan lease/locking, menerapkan idempotency, memilih adapter yang diaktifkan, memperbarui hasil dan menjadwalkan retry terbatas.
3. **Adapter contract:** `prepare`, `send`, `check/reconcile` (bila didukung), dengan hasil typed dan error class transient/permanent/ambiguous. Adapter tidak boleh mengubah incident status langsung; hanya coordinator yang memproses hasil.
4. **Local mock adapter:** respons deterministik dengan skenario konfigurasi sintetis (ack, reject, transient fail, timeout/unknown); tidak melakukan network call keluar dan tidak menyamar sebagai pihak nyata.
5. **Privacy lifecycle service:** menyimpan versi policy dan dry-run/preview, membatasi akses ekspor, memproses permintaan data serta purge/anonymize idempotent ketika policy yang disetujui dikonfigurasi. Batas retensi nyata tidak ditebak.
6. **Abuse/security middleware:** rate limit per endpoint dengan kunci minimisasi/hashed; CSRF untuk mutasi berbasis cookie; header keamanan; throttling login; batas payload; redaksi secret dan data sensitif pada log.
7. **Operational telemetry:** metrik lokal untuk umur antrean, intent pending/unknown/dead-letter, outbox lag, error database, readiness/migration dan kapasitas; tanpa token, deskripsi laporan, atau koordinat presisi sebagai label/field telemetry.
8. **Staff UI (EDITORIAL-UI):** tab/queue “Baru”, “Dimiliki saya”, “Menunggu handoff”, “Gagal/perlu review”; detail, aksi, riwayat privat, indikator status stale; halaman admin adapter staging, policy privacy, dan kesehatan operasi sesuai role.
9. **Citizen UI:** status bahasa sederhana, lokasi terakhir beserta waktu/sumber, kontrol stop-sharing yang langsung bereaksi, acknowledgment faktual, fallback, serta peringatan staging.

## 8. Entitas durable tambahan

Detail SQL final ditetapkan pada implementation plan dan migration yang direview. Entitas logis minimal:

- `dispatch_intents`: ID internal, incident ID, wilayah, adapter key/version, target key yang di-allowlist, payload snapshot terseleksi/encrypted sesuai kebijakan, payload digest, idempotency key digest, correlation ID, status, attempts, next attempt, lease, created/updated time.
- `dispatch_attempts`: intent ID, attempt number, start/end time, classified result, provider message reference yang aman, latency, redacted diagnostic code; bukan raw credential atau full sensitive response.
- `dispatch_acknowledgements`: intent ID, normalized ack type, source (mock/provider/manual), recorded actor/time, external reference digest atau value yang disetujui, evidence summary minimum.
- `privacy_policies`: version, data class, retention rule/configuration, enabled flag dan approver audit reference; default lingkungan staging synthetic-only.
- `privacy_requests`: request ID, category (access/export/delete/correction), subject proof workflow reference, status, assigned reviewer, outcome timestamps dan audit. Tidak menyimpan dokumen identitas lebih dari yang disetujui.
- `abuse_buckets`/equivalent: hashed key, endpoint group, window/counter/expiry dan action; tidak menyimpan IP mentah melebihi kebutuhan/retensi yang disetujui.
- metrics/health tidak memerlukan tabel aplikasi kecuali antrean alert lokal dipilih. Operational logs harus memiliki retention tersendiri dan redaksi.

Semua mutasi penting menulis audit di transaksi yang sama. Dispatch event/outbox dan state intent harus aman dari double processing setelah restart. Audit tidak mencatat token warga, password, secret adapter, body penuh, atau koordinat kecuali ada dasar/kebutuhan terkonfigurasi.

## 9. Kontrak HTTP / realtime usulan

Path final harus mengikuti pola route sekarang. Semua endpoint petugas memeriksa session aktif, role/capability, region scope, state precondition, dan audit.

| Operasi | Akses | Efek |
|---|---|---|
| Claim/release/takeover laporan | Dispatcher; takeover sesuai supervisor | Mengunci ownership dengan concurrency/version check dan mencatat audit. |
| Acknowledge/triage/update outcome | Dispatcher/supervisor | Mengubah workflow incident dan membuat status event/outbox atomik. |
| Create dispatch intent | Dispatcher | Menyimpan intent dengan key idempotency per tujuan/versi payload; UI menerima status queued, bukan sent. |
| Retry/reconcile/manual outcome | Supervisor; manual outcome memerlukan alasan + actor | Memproses intent gagal/unknown dengan batas attempt dan bukti audit. |
| Read dispatch queue/detail | Dispatcher sesuai assignment; supervisor scope wilayah | Mengembalikan projection terpisah untuk UI staf; warga tidak pernah menerima detail provider/internal. |
| Configure adapter/policy/retention | Operator admin dengan re-auth bila tersedia | Hanya local mock aktif secara default; perubahan versioned dan diaudit. |
| Read operational health/metrics | Operator/supervisor sesuai policy | Agregat minimisasi; tidak berisi detail warga. |
| Submit/review privacy request | Warga lewat proses verifikasi yang disepakati; reviewer berwenang | Melacak permintaan tanpa otomatis menghapus data sebelum legal hold/policy dicek. |

Realtime tetap invalidation hint. Setelah event, client mengambil ulang resource dari endpoint berotorisasi; payload socket tidak memuat dispatch raw response, lokasi tambahan, atau identitas di luar izin.

## 10. Retry, idempotency, dan kegagalan

- Unique key menjamin satu intent untuk satu aksi, incident, target dan versi payload.
- Coordinator memperoleh lease transaksional sebelum mengirim agar banyak worker/restart tidak mengirim job bersamaan.
- `retry_wait` hanya untuk kegagalan yang dipastikan transient dan aman diulang; backoff eksponensial dengan jitter, batas attempt dan batas umur dikonfigurasi untuk staging.
- Timeout setelah request terkirim dianggap `unknown` kecuali adapter mendukung query/reconcile dengan correlation ID. Jangan membuat intent baru untuk mengatasi timeout.
- Permanent reject masuk `manual_review` atau `dead_letter` dengan diagnostic aman. Supervisor dapat memperbaiki konfigurasi atau memutuskan handoff alternatif sesuai SOP.
- Dead-letter tidak dihapus otomatis; purge mengikuti policy lifecycle dan review audit. Aksi replay mempertahankan referensi intent asal dan mengeluarkan intent/attempt tercatat sesuai aturan idempotency.
- Outbox realtime dan dispatch queue adalah dua fungsi terpisah; retry/lag di salah satunya tidak boleh menghapus intent yang lain.
- Jika database tidak tersedia, jangan tampilkan perubahan berhasil. Jika realtime mati, UI menampilkan data terakhir/stale dan refresh mengambil snapshot HTTP ketika kembali.

## 11. Privasi, keamanan, dan penggunaan aman

- Lokasi presisi hanya tersedia untuk role yang membutuhkannya pada wilayah dan insiden yang benar; akses baca lokasi juga diaudit tanpa menyalin koordinat ke metadata audit.
- Token warga tetap berada di header/session storage dan tidak muncul pada URL, referer, log, telemetry atau exception.
- Pengumpulan lokasi dihentikan client pada stop/terminal/revocation; server menolak update berikutnya. Tidak ada restart tracking diam-diam.
- Form/landing/status menampilkan fallback resmi hanya dari konfigurasi yang diberikan pemilik layanan. Hingga itu tersedia, staging menyatakan tidak terhubung ke layanan darurat dan tidak mengarang nomor telepon.
- Anti-abuse tidak boleh menghalangi seluruh laporan sah akibat satu IP bersama; gunakan throttling bertahap, idempotency/deduplication, review manusia, dan metrik false-positive sintetis.
- MFA/IdP, account recovery, key management, deployment TLS, enkripsi backup, penetapan retensi dan legal hold adalah konfigurasi/kontrol yang harus disetujui operator sebelum data nyata.
- PII, teks, token dan lokasi tidak masuk analytics pihak ketiga. Jangan menambah SDK berbayar.

## 12. UI dan interaksi

Semua halaman non-landing mempertahankan EDITORIAL-UI: hierarki tipografi jelas, warna status terkendali, permukaan netral, navigasi dan tabel berorientasi tugas. Dashboard harus menonjolkan antrean yang belum diakui, ownership, umur laporan, handoff tertunda, dan failure action.

Animasi masuk/scroll yang sudah diminta tetap dipakai untuk landing dan transisi non-kritis secara ringan. Pada dashboard, animasi menghormati `prefers-reduced-motion`, tidak mengubah urutan baca, tidak menyembunyikan tombol, tidak menghambat keyboard/screen reader, dan tidak membuat petugas mengira status sudah tersimpan sebelum server mengonfirmasi. Informasi penting berupa label dan teks, bukan warna atau gerak saja.

## 13. Tahapan implementasi setelah spesifikasi disetujui

1. **Runtime staging baseline:** migrasi yang ada, bootstrap admin, koneksi database, create/report/status/withdrawal, staf/region, audit, realtime invalidation dan restart walkthrough. Ini verifikasi source fase 1–3 sebelum menambah banyak behavior.
2. **Dispatcher workflow completion:** claim/release/takeover, SLA-age queue, explicit acknowledge, truthful status, supervisor escalation workflow.
3. **Dispatch adapter framework:** durable intent/attempt/ack, local mock, timeout ambiguity, retry cap, manual review/dead-letter dan halaman staf.
4. **Privacy lifecycle foundation:** versioned policy schema, request workflow, export controls, purge/anonymize dry-run serta hanya eksekusi pada dataset sintetis sampai aturan final ada.
5. **Security/abuse hardening:** throttling, CSRF, headers, login protection, redacted logs, role/scope review dan threat-model review.
6. **Operational reliability:** queue/error metrics, local alert sink, backup/restore drill database terpisah, runbooks, shutdown/recovery dan deployment staging yang dapat diulang.
7. **Acceptance rehearsal:** simulasi timeout/duplicate/outage/restart, role/region isolation, warga→dispatcher→mock handoff, withdrawal, privacy request dan accessibility.
8. **Real service readiness (future, externally gated):** setelah spesifikasi kontrak dan sign-off diterima, implementasi provider adapter, security review, sandbox acceptance dan controlled pilot plan. Tidak termasuk sampai artefak itu diberikan dan direview.

Urutan rinci, batas setiap patch, serta verifikasi akan dibuat dalam implementation plan terpisah setelah pengguna menyetujui dokumen desain ini.

## 14. Kriteria penerimaan staging

- Migration ulang/upgrade dan startup readiness terdefinisi; data warga/staf/status/audit bertahan restart.
- Region/role denial berlaku sama untuk REST, socket, detail, lokasi, export, config dan dispatch.
- Retry create tidak menggandakan laporan; dispatch idempotency tidak menggandakan intent/aksi pada replay.
- Local mock menunjukkan seluruh hasil accepted/rejected/transient/unknown tanpa network keluar; UI dan semua copy menandai simulasi.
- Timeout ambigu tidak mengulang buta; item terlihat di antrean review dan bisa ditangani supervisor dengan audit.
- Warga hanya menerima proyeksi publik minimum dan status yang tidak melebih-lebihkan bukti.
- Stop sharing langsung menghentikan update dan server menolak update setelahnya.
- Abuse controls membatasi request dalam staging tanpa menyimpan secret/PII berlebih dan memiliki cara review.
- Privacy request, dry-run export/purge, audit, policy version dan retention behavior dapat didemonstrasikan dengan data sintetis.
- Metrik operasional menangkap queue age/lag/error/recovery tanpa raw lokasi, isi laporan, atau token.
- Backup restore staging diuji pada database terpisah dan runbook mendokumentasikan langkah serta bukti hasil.
- Keyboard/reduced-motion, error/loading/empty/stale states, peta gagal, dan layout mobile diverifikasi pada alur utama.

Kriteria di atas perlu dipenuhi dan diverifikasi sebelum menyatakan staging feature-complete. Kelulusan kriteria ini tidak sama dengan kesiapan pilot/produksi.

## 15. Keputusan yang tetap terbuka

| Keputusan | Dampak | Default aman sementara |
|---|---|---|
| Instansi, kanal, sandbox, ack contract | Adapter produksi dan arti “diterima” | Hanya local mock aktif; tidak ada network egress dispatch. |
| Pemilik layanan dan wilayah | Scope akses, fallback, SOP dan deployment | `local-staging` sintetis. |
| Retensi, legal hold, export/deletion policy | Batas pemrosesan data nyata | Tidak menggunakan data nyata; preview/dry-run saja. |
| Jam layanan, staffing, escalation target | Overdue/SLA dan klaim availability | Tidak mengklaim 24/7 atau target response. |
| Auth/MFA/IdP dan recovery | Akses staf di produksi | Auth staging yang ada tetap untuk sintetis; tidak dinyatakan layak produksi. |
| Hosting, backup target, RPO/RTO/on-call | Operasi dan pemulihan | Lokal/staging; tidak menambah biaya atau layanan. |
| Peta, notifikasi dan bahasa wilayah | Ketersediaan, privasi, biaya | Provider/demo sekarang; tidak mengirim notifikasi eksternal. |

## 16. Batas status dokumen

Desain ini merangkum pilihan produk dispatcher-first yang telah disetujui secara percakapan dan usulan teknis untuk direview. Persetujuan atas dokumen ini diperlukan sebelum implementation plan baru dibuat. Source saat ini baru fase 1–3. Sejak draft ini dibuat, migration 0001–0004 diterapkan ke database staging sintetis lokal dan startup/readiness dasar berhasil pada schema v4; jalur workflow/API/socket/UI masih belum diverifikasi end-to-end. Dokumen ini tidak menyatakan fitur lanjutan sudah diimplementasikan atau layanan darurat siap.
