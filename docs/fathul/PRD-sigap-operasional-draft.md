# PRD Draf — SIGAP Operasional

**Status:** Draf untuk review pengguna dan pemilik layanan  
**Tanggal:** 3 Oktober 2026  
**Basis:** [gap analysis](./full-feature-gap-analysis.md) · [draft arsitektur operasional](./operational-architecture-draft.md) · [roadmap implementasi operasional](./roadmap-sigap-operasional.md)
**Arah produk disetujui pengguna:** laporan ditangani dispatcher manusia; integrasi dispatch resmi menyusul setelah instansi dan kanal disetujui. Operator organisasi, roster/shift, wilayah, dan SOP nyata belum ditentukan.

> **Status penggunaan:** dokumen ini tidak menyatakan aplikasi saat ini siap digunakan dalam keadaan darurat. Wilayah, operator, SOP, fallback resmi, jam layanan, retensi, dan deployment masih harus ditentukan. Semua lingkungan tetap staging dan memakai data sintetis hingga pemilik layanan menyetujui kesiapan operasi.

## Status implementasi dan verifikasi (3 Oktober 2026)

Fase 1 (durable incident core), fase 2 (staff identity), dan fase 3 Task 1–4 — konfigurasi operasional, lifecycle insiden, API antrean/config, citizen intake dinamis, dan layar Editorial-UI — sudah terintegrasi ke source workspace utama. Fase 3 telah direview secara independen/scoped dan diperbaiki sesuai temuan sebelum integrasi. `npx tsc --noEmit` dan `npm run build` lulus di workspace utama; bundle JavaScript utama sekitar 1.62 MB menghasilkan warning Vite.

Migration 0001–0004 kini berhasil diterapkan pada database PostgreSQL staging sintetis lokal; `db:status` melaporkan schema v4 tanpa migration pending. Server startup, `GET /`, `/api/healthz`, `/api/readyz`, serta `GET /api/operations/public-config` berhasil (HTTP 200). Dua route staff yang diperiksa tanpa sesi (`/api/staff/incidents`, `/api/staff/operations/config`) menolak request dengan HTTP 401. Ini smoke check terbatas, bukan bukti seluruh akses/workflow. Tidak ada tests ditambahkan/dijalankan. Workflow SQL/transaksi, Socket.IO delivery, authenticated role/region isolation, UI/browser, backup/restore dan walkthrough warga–dispatcher belum diverifikasi. Klaim fase 3 di bawah tetap mendeskripsikan source, bukan semua perilaku runtime.

Semua penggunaan masih terbatas pada staging dan data sintetis. `local-staging` adalah wilayah simulasi. Roster berisi responder simulasi; assignment adalah pemilihan internal dan bukan dispatch. Tidak ada external dispatch adapter, layanan darurat yang terhubung, atau acknowledgment responder nyata. Build/typecheck bukan bukti kesiapan operasional atau keadaan darurat. Tahap berikutnya adalah fase 4 provider contract/adapter, fase 5 privacy lifecycle/security/anti-abuse, dan fase 6 reliability/observability/deployment.

### Perilaku konfigurasi dan workflow pada source fase 3

`/dashboard/operations` mengelola snapshot konfigurasi berversi: timezone/jam layanan, fallback, kategori dan required fields, SOP, serta roster/availability/coverage simulasi. Route publik hanya mengeluarkan kategori dan field intake yang diizinkan; SOP dan roster tetap privat. Update membawa expected version, dan konflik mengembalikan 409 sehingga admin harus memuat ulang serta meninjau perubahan sebelum menyimpan.

Alur source mendukung acknowledge, triage dengan SOP/version/alasan, ownership, assignment simulasi, start-work, refer, delivery-failed, escalation, takeover supervisor, resolve, dan keputusan withdrawal. Role sementara: dispatcher membaca/mengerjakan workflow biasa; supervisor juga menangani eskalasi/takeover; operator_admin mengelola config/akun serta membaca insiden/audit tanpa workflow; auditor membaca insiden/audit saja. Akses tetap dibatasi session aktif dan scope wilayah server. Kontrak transisi staging sementara dijelaskan di roadmap; status `assigned` tetap catatan internal tanpa konfirmasi pengiriman.

Form warga `/report/new` membaca kategori/required fields yang disetujui pada snapshot publik dan menyematkan versi config ke create. Ambiguous retry menggunakan token, idempotency key dan payload awal yang sama. Penolakan `operations_version_conflict` yang menjamin tidak ada commit memuat konfigurasi baru dan meminta review ulang; konflik/error lain mempertahankan percobaan yang sama. Jam layanan ditampilkan informatif bersama fallback tetapi tidak memblokir submit staging.

Permintaan withdrawal menghentikan pelacakan baru seketika. Server menolak lokasi berikutnya, menyimpan permintaan/outcome terpisah dari status operasional dan tidak memulai tracking ulang. Citizen response/history/outbox menggunakan proyeksi privat-minimal: actor staf generik, tanpa owner/identitas responder/alasan internal/workflow history. Petugas yang berwenang mengambil detail khusus staf. Retensi/penghapusan koordinat belum diimplementasikan sebagai policy produksi.

### Batas verifikasi pembaruan ini

TypeScript check dan production build workspace utama lulus pada pemeriksaan sebelumnya; empat protected Sites hashes dan migration 0001–0003 terjaga byte-identik pada pemeriksaan sebelumnya. Migration 0001–0004 kini diterapkan ke database lokal sintetis, dan readiness dasar berhasil pada schema v4. Tidak ada tests ditambahkan/dijalankan. Source review/build dan pemeriksaan readiness tidak memverifikasi workflow transaction/SQL, authentication/region isolation, event delivery, conflict/retry, tracking stop, backup/restore atau UI. Lihat [roadmap operasional](./roadmap-sigap-operasional.md), [plan phase-2](../superpowers/plans/2026-10-03-sigap-staff-identity.md), dan [plan phase-3](../superpowers/plans/2026-10-03-sigap-operator-workflow.md). Data non-sintetis, pilot, atau penggunaan darurat tidak boleh mengandalkan status source ini.

### Batas identitas, role/scope dan audit yang tersedia pada source

Operator_admin pertama diprovision melalui CLI `npm run staff:bootstrap` setelah migrasi, dengan input password tersembunyi dan tanpa shared/default credential. Account lifecycle melalui `/dashboard/accounts` terbatas operator_admin: create, nama/role/scope, disable/re-enable, reset password manual dan revoke seluruh sesi. Password tidak dikembalikan setelah provisioning. Scrypt async menyimpan verifier/salt; SID disimpan sebagai hash dan tombstone mencegah stale write menghidupkan sesi revoked. Mutasi akses/credential/revoke diaudit atomik dan mempertahankan minimal satu operator_admin aktif dengan scope.

Matriks sementara: dispatcher membaca/mengerjakan insiden pada wilayahnya; supervisor juga menangani eskalasi; operator_admin membaca insiden/audit dan mengelola akun tanpa hak workflow; auditor membaca insiden/audit tanpa mutasi. Provisioning hanya mengizinkan `local-staging`. Seluruh REST dan recipient realtime memeriksa principal aktif, versi/expiry/revocation sesi, role/read capability serta assignment wilayah terkini. Region insiden berasal dari storage, termasuk untuk old outbox payload tanpa region; tidak ada antrean/room staf global sebagai fallback. Unknown role, scope kosong atau error DB ditolak. Logout/revoke/disable memutus socket lokal.

`/dashboard/audit` menyediakan feed aktivitas insiden dan administrasi akun/akses untuk auditor/operator_admin, dengan scope server serta loading/empty/error states dalam Editorial-UI. Audit detail/list dan realtime menyimpan actor staf sebenarnya; `incident:realtime_delivery_attempt` mencatat upaya pengiriman server tanpa koordinat. Catatan itu tidak membuktikan browser menerima event atau manusia membaca laporan. Citizen history/event hanya memakai actor generik `staff`; historical `staff-demo` tetap legacy. Ownership audit administratif saat ini menggunakan satu region sintetis; aturan provenance sebelum multiwilayah nyata masih perlu disahkan.

## 1. Ringkasan produk

SIGAP adalah layanan web mobile-first untuk menerima laporan insiden keamanan dari warga, memberi lokasi yang dibagikan dengan izin, mengantrekan laporan kepada dispatcher, dan menampilkan perkembangan berdasarkan tindakan yang benar-benar tercatat. Dispatcher mengelola triase dan penugasan ke responder yang disetujui oleh organisasi operator.

Pengiriman laporan ke server bukan bukti bahwa operator telah melihatnya. Status “diterima operator”, “diteruskan”, dan “bantuan dikirim” hanya boleh tampil setelah ada tindakan/acknowledgement sesuai kanal dan SOP. Bila operator atau jalur respons tidak tersedia, layanan harus mengatakannya dan menampilkan fallback resmi untuk wilayah tersebut.

## 2. Tujuan

- Warga dapat menyampaikan laporan singkat melalui ponsel dengan akses lokasi yang transparan.
- Dispatcher dapat melihat laporan dalam antrian persisten, mengakui penerimaan, melakukan triase manual, dan mendokumentasikan tindakan.
- Supervisor dapat mengawasi laporan yang belum diakui/tertunda dan mengambil alih eskalasi.
- Status warga mencerminkan keadaan penanganan yang faktual dan terkini.
- Sistem menjaga data lokasi dan laporan dari akses tanpa kewenangan serta mengikuti masa simpan yang ditetapkan pemilik layanan.
- Operator dapat mengetahui ketika penyimpanan, notifikasi, realtime, atau kanal respons bermasalah.

## 3. Bukan tujuan rilis pertama

- Menggantikan nomor atau kanal resmi darurat.
- Mengirim ke instansi atau responder tanpa perjanjian, otorisasi, spesifikasi, dan uji penerimaan.
- Menjanjikan 24/7 sebelum roster, on-call, anggaran, dan target layanan ditetapkan.
- Mengotomatisasi penilaian kredibilitas/keparahan dengan AI.
- Menggunakan unit simulasi atau data demo sebagai roster operasi nyata.
- Meluncurkan aplikasi publik sebelum wilayah, SOP, privasi, fallback, keamanan, dan dukungan disetujui.

## 4. Pengguna dan kebutuhan

| Pengguna | Kebutuhan utama |
|---|---|
| Warga/pelapor | Mengirim lokasi dan uraian singkat, tahu apakah laporan hanya terkirim atau sudah diakui manusia, dan menerima perkembangan tanpa membuat klaim palsu. |
| Dispatcher | Melihat antrian yang tidak hilang saat reload/restart, mengakui laporan, menilai sesuai SOP, menetapkan responder terdaftar, dan mencatat keputusan. |
| Supervisor | Menemukan laporan yang lama belum diakui, melihat beban kerja, mengambil alih, dan mengeskalasi. |
| Administrator operator | Mengelola akun/peran, wilayah, roster, jam operasi, konfigurasi kanal, dan kebijakan retensi. |
| Auditor/petugas privasi | Melihat jejak akses/perubahan sesuai kewenangan, menangani permintaan akses/penghapusan, dan memverifikasi kepatuhan proses. |

## 5. Alur warga

1. Warga melihat nama operator/wilayah yang dilayani, jam layanan, batasan aplikasi, dan kanal resmi fallback yang berlaku.
2. Warga memilih kategori yang disetujui operator dan mengisi deskripsi dengan batas yang jelas. Pengiriman dapat tanpa akun.
3. Aplikasi menjelaskan dan meminta izin lokasi saat diperlukan. Warga dapat menolak; sistem tidak boleh menyamarkan koordinat lama/simulasi sebagai GPS saat ini.
4. Sebelum submit, aplikasi membuat dua nilai acak berentropi tinggi yang terpisah: token akses status privat dan idempotency key. Keduanya disimpan untuk retry di sesi browser; server menyimpan digest saja. Server menyimpan laporan secara persisten dan mengembalikan nomor insiden. Submit ulang akibat koneksi putus dengan idempotency key dan payload sama tidak membuat laporan ganda; idempotency key berbeda dari kredensial akses.
5. Status awal secara eksplisit bermakna “laporan diterima oleh sistem; menunggu pengakuan operator”. Aplikasi tidak boleh menyebutnya telah dibaca.
6. Ketika operator mengakui/menugaskan/memperbarui laporan, status warga diperbarui dan sumber perubahan dicatat.
7. Saat warga meminta pembatalan, browser langsung menghentikan pengiriman lokasi baru. Sistem menyimpan permintaan pembatalan, memberi tahu operator, dan mempertahankan lokasi terakhir hanya sesuai kebijakan retensi yang disetujui. Jika laporan sudah ditangani/diteruskan, operator melihat bahwa tracking telah berhenti dan memproses perubahan status sesuai SOP. Tracking tidak dimulai lagi tanpa persetujuan eksplisit warga.
8. Warga dapat meminta penghapusan/penutupan melalui proses dan retensi yang ditetapkan operator; aturan khusus penyimpanan keselamatan harus dijelaskan. UI membedakan permintaan pembatalan yang diterima dari yang telah diproses petugas.

## 6. Alur operasi

1. Dispatcher masuk menggunakan akun individu dan faktor autentikasi yang diwajibkan organisasi.
2. Dashboard memuat snapshot laporan persisten; status realtime adalah tambahan, bukan satu-satunya sumber data.
3. Dispatcher mengakui laporan. Sistem mencatat actor dan server timestamp, lalu mengubah status warga secara transparan.
4. Dispatcher melakukan triase manusia berdasarkan SOP yang disetujui dan mencatat keputusan serta alasan yang diwajibkan.
5. Dispatcher menetapkan responder dari roster yang benar-benar tersedia atau meneruskan melalui kanal resmi. Status “terkirim/ditugaskan” membutuhkan bukti pengakuan kanal/responder.
6. Kegagalan responder, integrasi, atau pengiriman masuk ke antrean retry/review dan memicu jalur eskalasi operator.
7. Supervisor memantau waktu tunggu terhadap target yang ditetapkan organisasi, mengambil alih, dan menutup atau merujuk insiden sesuai SOP.
8. Semua transisi, assignment, perubahan akses, dan tindakan eskalasi menghasilkan jejak audit yang tidak dapat diubah oleh role operasi biasa.

## 7. Persyaratan fungsional

| ID | Persyaratan | Prioritas |
|---|---|---|
| FR-01 | Warga dapat membuat laporan kategori yang dikonfigurasi, dengan atau tanpa lokasi jika lokasi ditolak/tidak tersedia. | Wajib |
| FR-02 | Sistem menyimpan laporan, status, assignment, dan event audit secara persisten melewati restart. | Wajib |
| FR-03 | Aplikasi membuat token akses laporan berentropi tinggi sebelum submit dan sistem menghasilkan nomor insiden; token tidak boleh muncul di query URL, referer, log, analytics, atau error trace. Token akses dipisahkan dari idempotency key. | Wajib |
| FR-04 | Request create idempotent sehingga retry jaringan tidak menggandakan laporan. | Wajib |
| FR-05 | Sumber lokasi (GPS aktual, koordinat manual, tidak tersedia) dan waktu fix/update terlihat terpisah; lokasi tidak diambil sebelum izin/kondisi yang disepakati. | Wajib |
| FR-06 | Posisi diperbarui hanya selama laporan aktif dan sesuai izin; browser berhenti mengirim segera setelah permintaan pembatalan, dan server menolak update setelah permintaan itu, status terminal, atau akses dicabut. Tracking tidak dilanjutkan tanpa persetujuan eksplisit baru. | Wajib |
| FR-07 | Warga melihat status sistem, pengakuan operator, assignment/rujukan, dan timestamp tanpa menyamakan status-status tersebut. | Wajib |
| FR-08 | Warga dapat meminta pembatalan, yang langsung menghentikan live tracking; warga melihat apakah permintaan menunggu atau sudah diproses. Koordinat yang sudah diterima mengikuti kebijakan retensi, tidak otomatis dihapus. | Wajib |
| FR-09 | Petugas memiliki akun individu, role, status aktif/nonaktif, sesi terlindungi, dan autentikasi sesuai kebijakan organisasi. | Wajib |
| FR-10 | Akses laporan dibatasi berdasarkan role, tugas, dan wilayah yang ditetapkan. | Wajib |
| FR-11 | Dashboard menyediakan antrian persisten, filter/sortir, detail, peta dan tampilan koordinat alternatif ketika tile gagal. | Wajib |
| FR-12 | Dispatcher dapat acknowledge, triase, assign/rujuk, memperbarui status, serta mencatat alasan sesuai SOP. | Wajib |
| FR-13 | Supervisor melihat laporan tertunda dan dapat mengambil alih atau mengeskalasi. | Wajib |
| FR-14 | Roster responder, wilayah, jam operasi, kategori, kanal, dan label status dikonfigurasi oleh administrator berwenang, bukan konstanta demo. | Wajib |
| FR-15 | Semua aksi penting dan akses administratif dicatat dengan actor, waktu, aksi, entitas, dan metadata minimum yang diperlukan. | Wajib |
| FR-16 | Kegagalan DB, realtime, kanal/notifikasi, dan responder ditampilkan pada status operasi dan tidak menghasilkan konfirmasi palsu ke warga. | Wajib |
| FR-17 | Integrasi responder memakai adapter dengan idempotency, acknowledgement, retry, error/dead-letter queue, dan kontrol replay/manual review. | Wajib sebelum dispatch eksternal |
| FR-18 | Administrator dapat menerapkan masa retensi, penghapusan/anonimisasi, serta proses permintaan subjek data sesuai kebijakan disetujui. | Wajib sebelum data nyata |
| FR-19 | Notifikasi warga di luar aplikasi ditambahkan hanya setelah kanal, biaya, consent, dan dukungan operasional disetujui. | Perlu keputusan |
| FR-20 | Sistem memisahkan data/configuration development, staging, dan production; staging hanya menggunakan data sintetis. | Wajib |

## 8. Status insiden usulan

```text
received -> acknowledged -> triaged -> assigned -> in_progress -> resolved
                               |           |
                               +-> referred +-> delivery_failed -> escalation_pending -> assigned
```

Permintaan pembatalan adalah event terpisah (`withdrawal_requested`), bukan pengganti status operasi. Event ini langsung menghentikan update lokasi. Dispatcher memprosesnya sesuai SOP; status operasional tetap tercatat, dan penutupan menggunakan `resolved` dengan outcome yang ditetapkan kebijakan. UI harus membedakan “permintaan diterima/menunggu” dari “diproses petugas”. Lokasi terakhir hanya boleh dipakai operator sesuai kewenangan dan retensi.

Transition matrix di atas adalah model usulan produk dan harus disahkan pemilik layanan sebelum pilot. Untuk staging teknis saja, urutan sementara adalah `received -> acknowledged -> triaged -> assigned -> in_progress -> resolved`, dengan jalur `triaged -> referred`, `assigned -> referred`, `assigned -> delivery_failed`, `in_progress -> referred`, `delivery_failed -> escalation_pending`, dan `escalation_pending -> assigned | referred`. `referred` dan `resolved` terminal pada implementasi awal. Di staging, `acknowledged` hanya membuktikan dispatcher demo menekan aksi acknowledge; `assigned` hanya berarti unit simulasi dipilih. Keduanya tidak membuktikan responder eksternal menerima atau bergerak. Status responden dalam operasi nyata hanya diperbarui dari bukti/konfirmasi responder yang terdefinisi. Setiap transisi memakai role yang diizinkan, precondition, actor, timestamp server, dan event audit.

## 9. Persyaratan nonfungsional

- **Reliability:** target uptime, peak load, RPO/RTO, waktu acknowledgement, serta cakupan on-call ditetapkan operator sebelum pilot. UI menunjukkan degradation/fallback saat target tidak dapat dipenuhi.
- **Security:** threat model, least privilege, MFA petugas, proteksi CSRF/session, rate limits/abuse control, secret management, dependency patching, backup terenkripsi, dan security assessment sebelum pilot.
- **Privasi:** minimisasi data, purpose limitation, transparansi ke warga, pembatasan akses lokasi presisi, masa retensi, deletion/export, dan audit akses. Durasi dan dasar pengolahan belum ditetapkan.
- **Observability:** health/readiness, metrik keterlambatan/queue, error integration, DB capacity, dan alerting on-call; telemetry tidak berisi token, password, teks sensitif, atau koordinat presisi secara default.
- **Accessibility:** keyboard, screen reader, kontras, status bukan hanya warna, teks sederhana, kompatibel dengan jaringan/perangkat lambat, serta dukungan bahasa wilayah.
- **Resilience:** reconnect memuat snapshot server, offline/retry tidak membuat duplikat, outage DB/kanal memberi status jelas, backup diuji restore, dan tiles bukan dependency bagi tindakan operator.
- **Compliance:** pemilik organisasi melakukan review hukum/regulasi, SOP, perjanjian responder, dan kebijakan data sesuai yurisdiksi. Belum ditentukan dalam dokumen ini.
- **Cost:** database, identity provider, hosting, notifikasi, peta/geocoding, dan dukungan on-call tidak dipilih sebelum opsi dan biaya disetujui.

## 10. Keberhasilan dan penerimaan

Sebelum pilot, seluruh indikator berikut harus memiliki target dan pemilik: persentase laporan yang ter-acknowledge dalam target waktu, usia maksimum laporan belum tertangani, delivery success/failed per kanal, availability, restore recovery, insiden akses tanpa izin, dan penutupan permintaan privasi.

Uji penerimaan mencakup end-to-end warga–dispatcher–responder (menggunakan sandbox responder resmi), hak akses role, persistence/restart/restore, retry idempotent, laporan berulang/abuse, GPS ditolak/basi, offline/reconnect, tile failure, escalation timeout, integration outage, pembatalan setelah assignment, serta audit trace. Uji operasional dilakukan dengan tabletop/latihan operator sebelum menerima laporan publik.

Sukses teknis tidak membuktikan kesiapan layanan. Pilot perlu sign-off pemilik layanan, operator, responder, keamanan, privasi/hukum, dan dukungan.

## 11. Risiko dan mitigasi

| Risiko | Mitigasi produk/operasi |
|---|---|
| Warga menyangka laporan langsung memanggil bantuan | Pisahkan “diterima server” dari “diakui operator”; tampilkan fallback wilayah; hindari copy ambigu. |
| Operator melewatkan laporan | Antrian durable, indikator tertunda, supervisor escalation, alerting di kanal operator, latihan dan coverage roster. |
| GPS usang/tidak akurat atau dibagikan tanpa sadar | Minta izin, tunjukkan timestamp/sumber/akurasi bila tersedia, hentikan tracking pada kondisi akhir, batasi retensi. |
| Penyalahgunaan atau laporan palsu | Rate limiting, deduplikasi, workflow penanganan, proteksi terhadap automated abuse, triase manusia, audit. |
| Kebocoran lokasi/identitas pelapor | Token rahasia, akses minimum, MFA staf, audit akses, redaksi log, encryption dan retensi terbatas. |
| Dispatch gagal/terduplikasi | Outbox, idempotency, explicit ack, retry/review queue, eskalasi fallback, uji sandbox. |
| Peta/hosting/identity provider gagal | Peta alternatif teks, health monitoring, backup/restore dan manual procedure; pilih provider sesuai target wilayah dan SLA. |

## 12. Keputusan terbuka wajib

- Negara, kota/wilayah, organisasi pemilik, operator, dan responder resmi.
- Pemilik organisasi/operator, roster/shift, wilayah layanan, dan SOP dispatcher yang akan mengoperasikan platform.
- Jam layanan, kebutuhan 24/7, SLA acknowledgement/eskalasi, RPO/RTO, beban puncak.
- SOP kategori/triase, laporan palsu, duplikasi, pembatalan, rujukan, responder tidak tersedia, dan outage.
- Identitas warga: tanpa akun dengan token saja, atau kanal pemulihan berbasis kontak; dampak biaya/privasi.
- Masa retensi koordinat, uraian laporan, audit; role yang boleh melihat/menghapus/ekspor.
- Integrasi resmi: nama instansi/kanal, owner teknis, sandbox, kredensial, acknowledgement contract, proses persetujuan.
- Hosting, DB, identity provider, peta, notifikasi, anggaran dan pemilik operasi teknis.
- Kebijakan legal/privasi dan pesan fallback/nomor bantuan resmi untuk wilayah target.

## 13. Rencana tahap

1. **Discovery dan sign-off:** lengkapi keputusan terbuka, SOP, threat model, privacy review, service boundary, target SLA, dan kontrak responder.
2. **Fondasi operasional staging:** DB/migrasi, RBAC/MFA, audit, idempotent API, durable outbox, dashboard antrian, responder/configuration management, observability, dan deployment terisolasi.
3. **Hardening:** uji security, load, failure/recovery, restore, privacy/retention, role, abuse, accessibility, dan latihan dispatcher.
4. **Pilot terbatas:** luncurkan kepada pengguna terpilih hanya setelah seluruh sign-off dan jalur fallback nyata tersedia; operator memonitor sesuai coverage yang disepakati.
5. **Perluasan produksi:** berdasarkan hasil pilot, integrasi resmi terverifikasi, dukungan, kapasitas, dan persetujuan ulang.

## 14. Referensi dokumen proyek

- Kondisi prototipe saat ini dan bukti gap: [full-feature-gap-analysis.md](./full-feature-gap-analysis.md)
- Rancangan arsitektur awal: [operational-architecture-draft.md](./operational-architecture-draft.md)
- Roadmap bertahap menuju platform operasional penuh: [roadmap-sigap-operasional.md](./roadmap-sigap-operasional.md)
- Spesifikasi lama untuk demo: [PRD-sistem-SOS-keamanan-publik.md](./PRD-sistem-SOS-keamanan-publik.md)

Perluasan ke operasi nyata mengikuti keputusan terbuka dan review spesifikasi operator. Source fase 1–3 terintegrasi; fase 3 direview, typechecked dan dibuild sebelum integrasi, tetapi runtime validation masih terbuka. Fase 4–6 dan semua keputusan/sign-off keamanan, privasi, responder, layanan, dan deployment masih diperlukan sebelum pilot.
