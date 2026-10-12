# Analisis Gap Menuju SIGAP Operasional

**Tanggal pembaruan:** 12 Oktober 2026  
**Status:** audit source dan bukti yang tersedia; bukan bukti runtime atau persetujuan pilot  
**Arah produk:** dispatcher manusia menangani laporan; adapter resmi menyusul setelah kontrak kanal disetujui.

## Ringkasan kondisi saat ini

Source fase 1–3 telah terintegrasi di workspace utama. Source mencakup penyimpanan PostgreSQL untuk insiden/audit/session, identitas staf individual, role dan scope wilayah sementara, konfigurasi operasi berversi, intake warga dinamis, workflow antrean, withdrawal, serta event outbox untuk realtime. TypeScript check dan production build sebelumnya lulus.

Database staging sintetis lokal kini menjalankan migration 0001–0007; endpoint readiness pada 12 Oktober 2026 memberi schema version 7. Backup/restore terenkripsi kini tersedia untuk PostgreSQL staging lokal dan diuji end-to-end pada database sintetis terpisah; arsip lolos integritas GPG, seluruh nilai fixture dan checksum migration cocok setelah restore. Backup offsite, retensi/key lifecycle, WAL/PITR, jadwal, alert, RPO/RTO dan verifikasi produksi belum tersedia. UI/browser, GPS perangkat dan readiness produksi juga belum diverifikasi. Fase dispatch adapter, privacy lifecycle, anti-abuse/security hardening, observability penuh, deployment staging dan pilot tetap terbuka.

## Requirement matrix

| Area | Status saat ini | Batas bukti |
|---|---|---|
| Insiden, lokasi, status, audit dan retry create | HTTP/PostgreSQL sintetis diverifikasi untuk create, retry, concurrency, status, lokasi simulasi dan app/pool recreation | [Walkthrough](./workflow-verification.md) memeriksa transaksi melalui routes sebenarnya. GPS perangkat, crash durability, restore dan semua kegagalan storage belum dicakup. |
| Identitas staf, sesi, role/region scope dan audit admin | Provisioning/login individual, subset role/region boundary, session persistence, account disable dan last-admin guard terverifikasi HTTP | Test memakai database sintetis dan fixture region lain untuk penolakan akses local-staging. Socket disable/logout/revoke/reset-password, expiry saat delivery dan reconnect diverifikasi sintetis. Seluruh account lifecycle, MFA/IdP dan recovery produksi tetap belum lengkap. |
| Kategori, SOP, konfigurasi operasi, roster simulasi dan intake dinamis | Config version/conflict, pinned SOP, required boolean field, roster snapshot/availability dan public allowlist terverifikasi HTTP/PostgreSQL | [Walkthrough](./workflow-verification.md) memeriksa perubahan snapshot dan workflow laporan lama. Browser intake dinamis dan seluruh tipe field belum diverifikasi; roster tetap simulasi internal. |
| Queue, claim/release/takeover, workflow dan proyeksi warga | HTTP/PostgreSQL sintetis terverifikasi pada cabang yang dicakup test; browser/socket belum | Role/scope, status transition, withdrawal, private staff projection dan redaksi public projection ada pada roadmap. HTTP/PostgreSQL diuji dalam walkthrough sintetis; Delivery socket native diperiksa terpisah; browser belum dibuktikan. |
| Outbox realtime | Payload/redaksi dan subset delivery/retry/replay native diverifikasi; browser/crash belum | Publisher mengirim event UI. Ini bukan dispatch ke responder dan bukan bukti browser menerima atau petugas membaca event. |
| Dispatch intent, provider adapter, acknowledgment dan dead-letter | Belum tersedia di source | Belum ada durable dispatch queue/provider contract. Outbox realtime yang ada tidak memenuhi requirement dispatch. Desain usulan ada di [spesifikasi workflow operasional](../superpowers/specs/2026-10-03-sigap-full-operational-design.md), masih menunggu persetujuan dokumen. |
| Privacy request, retensi, ekspor, penghapusan/anonimisasi | Belum tersedia | Kebijakan dan workflow lifecycle belum ada. Durasi retensi/legal hold tidak boleh diasumsikan sebelum pemilik layanan memutuskan. |
| Anti-abuse/security hardening | Sebagian fondasi tersedia; kontrol penting belum ada | Ada batas ukuran payload, cookie/session dan beberapa security header. Guard mutasi staf memakai custom header, Origin dan Fetch Metadata; handshake realtime memeriksa origin sebelum sesi. Pemeriksaan terisolasi 13 skenario berhasil pada 12 Oktober 2026. Throttle login PostgreSQL (source, source–username, account global) diterapkan dengan 11 pemeriksaan integrasi sintetis berhasil. Intake create request budget PostgreSQL kini tersedia, dengan 11 pemeriksaan HTTP/DB sintetis. MFA/IdP, ingress proxy tepercaya dan assessment abuse menyeluruh masih terbuka. |
| Reliability dan observability | Readiness, monitoring scoped, backup terenkripsi lokal, dan restore drill terisolasi tersedia; reliability operasional belum lengkap | 23 kelompok workflow HTTP/DB, 20 kelompok realtime, 10 kelompok outbox review, 11 intake throttle, 12 monitoring, dan backup/restore terenkripsi sintetis berhasil pada pemeriksaan masing-masing. Runbook menjelaskan backup GPG AES-256 lokal dan restore target terpisah. DB capacity metrics, alert routing, offsite/retention/key lifecycle/WAL-PITR, load/failure targets, deploy/rollback serta RPO/RTO masih terbuka. |
| Pilot/operasi publik | Belum siap dan belum disetujui | Belum ada pemilik layanan, wilayah, responder/kanal, fallback, policy data, roster/SOP nyata, dukungan on-call, target SLO/RPO/RTO, hosting, security/privacy sign-off atau penerimaan lapangan. |

## Bukti baseline yang perlu dibedakan

Dokumen implementation plan historis memuat snapshot prototipe awal: penyimpanan in-memory, satu akun demo, daftar unit statis dan global staff room. Itu bukan lagi deskripsi source terkini. Gunakan [roadmap operasional](./roadmap-sigap-operasional.md) untuk status source fase 1–3. Migration yang tersedia sekarang adalah `0001_operational_core.sql` hingga `0007_citizen_intake_throttle.sql`; keberadaan file migration tidak berarti sudah diterapkan.

## Gap untuk melanjutkan sampai staging feature-complete

1. **Verifikasi runtime fase 1–3.** Terapkan migration pada database staging sintetis, bootstrap admin, lalu verifikasi create/retry, login/role/region, queue/workflow, withdrawal, realtime invalidation, konflik dan restart. Catat command, hasil, dan keterbatasan yang benar-benar diamati.
2. **Lengkapi dispatcher workflow.** Pastikan acknowledgment, ownership, umur antrean, supervisor takeover dan eskalasi memiliki precondition, audit dan perilaku serentak yang teruji.
3. **Bangun dispatch adapter framework lokal.** Tambahkan durable intent/attempt/ack, local mock tanpa network egress, idempotency, timeout-unknown, bounded retry, manual review/dead-letter dan UI operasional. Tetap beri label simulasi.
4. **Bangun privacy lifecycle untuk data sintetis.** Sediakan policy versioning, request workflow, export control, dry-run purge/anonymize dan audit. Jangan menjalankan purge pada data nyata sampai policy serta legal hold disetujui.
5. **Tambahkan security/abuse controls.** Rate limit yang tidak menghukum jaringan bersama secara berlebihan, CSRF, header, persistent login throttle, redacted logs, role/scope review dan threat-model exercise.
6. **Lengkapi reliability staging.** Queue/outbox/database metrics, readiness dependency/migration, alert sink lokal, backup offsite/retention/key lifecycle, WAL/PITR, failure/load checks, runbook serta startup/shutdown/rollback yang dapat diulang. Backup/restore drill lokal terenkripsi sudah memiliki implementasi dan bukti integrasi sintetis.
7. **Lakukan acceptance rehearsal.** Warga → dispatcher → mock handoff, duplicate/retry, timeout ambigu, role/region, outage/restart, withdrawal, privacy workflow, reduced-motion/accessibility, mobile dan tile failure.
8. **Perbarui bukti.** Sinkronkan roadmap dan PRD dengan hasil aktual. Jangan menandai feature complete dari build/typecheck saja.

## Keputusan eksternal sebelum dispatch nyata atau pilot

- Nama organisasi operator, pemilik layanan, yurisdiksi dan wilayah cakupan.
- Instansi/recipient, kanal resmi, otorisasi integrasi, sandbox, autentikasi, idempotency serta acknowledgment contract.
- Fallback resmi dan prosedur bila operator, database, internet atau responder tidak tersedia.
- SOP/roster/jam layanan nyata, staffing, on-call, target response, SLO, RPO dan RTO.
- Kebijakan lokasi/data, dasar dan tujuan pemrosesan, retensi, export/deletion, legal hold, enkripsi dan backup expiry.
- Authentication/MFA, provisioning/recovery, hosting/data residency, peta/notifikasi, biaya dan dukungan.
- Security/privacy review, tabletop dan penerimaan bersama sebelum pilot.

Tidak ada konektor dispatch eksternal, notifikasi berbayar, hosting berbayar, atau klaim 24/7 yang boleh diasumsikan dari source saat ini. Ketiadaan kontrak eksternal tidak menghalangi engineering staging menggunakan local mock dan data sintetis.

## Dokumen terkait

- [PRD operasional](./PRD-sigap-operasional-draft.md)
- [Roadmap SIGAP operasional](./roadmap-sigap-operasional.md)
- [Desain workflow operasional penuh](../superpowers/specs/2026-10-03-sigap-full-operational-design.md)
- [Panduan run staging](../../frontend/docs/fathul/run-demo.md)
- [Runbook backup dan pemulihan staging](../../frontend/docs/fathul/database-backup.md)

## Verifikasi tambahan 12 Oktober 2026

[Throttle login](./login-throttle.md) diverifikasi pada database sintetis terpisah: concurrency, instance recreation, expiry, source/account limits, valid session dan fail-closed. Ini memperkuat bukti sebagian fase 2/5; bukan verifikasi semua workflow maupun kesiapan produksi.

## Walkthrough HTTP/PostgreSQL — 12 Oktober 2026

[Verifikasi workflow](./workflow-verification.md) mencatat 23 kelompok pemeriksaan yang berhasil. Ini menggantikan pernyataan historis bahwa seluruh workflow belum pernah dijalankan, tetapi tidak menyelesaikan gate browser/realtime, provider, privacy, security assessment, reliability atau pilot.

## Realtime native — 12 Oktober 2026

[Verifikasi realtime](./realtime-verification.md) mencatat 20 kelompok pemeriksaan: auth/origin, transport, retry/replay, pool satu koneksi, GPS validation/isolation/stop, audit failure, session/account revocation/expiry dan shutdown gates. Client receipt terbukti pada klien uji; bukan human acknowledgement atau dispatch responder. Cap/dead-letter belum tersedia pada snapshot awal test; kini telah ditambahkan dan diperiksa kembali melalui outbox review.

## Outbox review — 12 Oktober 2026

[Antrean review](./outbox-review.md) kini menyediakan cap retry, dead-letter persisten, daftar metadata scoped, admin retry beralasan dan audit atomik yang dapat dibaca pada halaman Audit. Regresi workflow/throttle/realtime lulus; schema lokal v6 ready. Ini memperbaiki sebagian reliability realtime, bukan implementasi dispatch queue/provider atau kesiapan produksi.

## Intake request budget — 12 Oktober 2026

[Pembatasan create](./intake-throttle.md) menambahkan budget sumber koneksi dan token normalisasi yang persisten. Percobaan malformed juga dihitung, header forwarding tidak dipercaya, retry normal tetap idempotent dan endpoint baca/withdrawal tetap tersedia. Sebelas kelompok HTTP/DB sintetis lulus; semua regresi terkait berhasil. Ini bukan assessment abuse menyeluruh atau kebijakan layanan publik yang sudah disetujui.

## Monitoring scoped — 12 Oktober 2026

[Monitoring](./monitoring.md) menambahkan API ringkasan scope wilayah dan halaman `/dashboard/monitoring`. Queue age/ownership/status, pending/due/dead-letter dan server publish acceptance dihitung dari satu statement snapshot. Storage auth outage kini menghasilkan 503, bukan sesi invalid. Dua belas kelompok pemeriksaan API/DB sintetis dan regresi berhasil; browser, background alert sink, on-call routing dan capacity/load tetap belum diverifikasi.

## Backup/restore sintetis — 12 Oktober 2026

`frontend/scripts/database-backup.mts` menyediakan `npm run db:backup -- backup|verify|restore`. Operasi dibatasi ke container PostgreSQL SIGAP lokal dengan bind loopback dan volume yang dikenali, database staging sintetis, file di luar repo dan passphrase kuat. `npm run test:database-backup` lulus: fixture laporan dibuat lewat HTTP pada database sementara, dump dienkripsi GPG AES-256, hasil dipulihkan ke database lain, isi dan checksum migrasi cocok, overwrite/path repository/arsip rusak ditolak, lalu fixture dibersihkan. Bukti ini hanya local staging; tidak ada backup dari database staging aktif dalam tes ini. Belum ada offsite, rotasi/pemulihan key, retensi, scheduled job, WAL/PITR, alert kegagalan, recovery lintas host atau target RPO/RTO. Runbook: [database-backup.md](../../frontend/docs/fathul/database-backup.md).
