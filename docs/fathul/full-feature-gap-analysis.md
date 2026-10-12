# Analisis Gap Menuju SIGAP Operasional

**Tanggal pembaruan:** 3 Oktober 2026  
**Status:** audit source dan bukti yang tersedia; bukan bukti runtime atau persetujuan pilot  
**Arah produk:** dispatcher manusia menangani laporan; adapter resmi menyusul setelah kontrak kanal disetujui.

## Ringkasan kondisi saat ini

Source fase 1–3 telah terintegrasi di workspace utama. Source mencakup penyimpanan PostgreSQL untuk insiden/audit/session, identitas staf individual, role dan scope wilayah sementara, konfigurasi operasi berversi, intake warga dinamis, workflow antrean, withdrawal, serta event outbox untuk realtime. TypeScript check dan production build sebelumnya lulus.

Database staging sintetis lokal kini menjalankan migration 0001–0004; `db:status` melaporkan schema version 4 dan tidak ada migration pending. Server lokal merespons `GET /`, `/api/healthz`, dan `/api/readyz` dengan HTTP 200. Ini membuktikan startup dasar dan koneksi database/readiness saja. Workflow transaksi, authentication/role isolation, Socket.IO delivery, UI/browser, restart/restore, dan walkthrough warga–dispatcher belum diverifikasi. Fase dispatch adapter, privacy lifecycle, anti-abuse/security hardening, observability, backup/restore, dan deployment staging masih terbuka. Belum ada bukti organisasi/operator, instansi responder, kanal/acknowledgment contract, atau sign-off pilot.

## Requirement matrix

| Area | Status saat ini | Batas bukti |
|---|---|---|
| Insiden, lokasi, status, audit dan retry create | Source tersedia; PostgreSQL/schema/readiness dasar berhasil, workflow belum diverifikasi | Schema dan transaksi ada di [`0001_operational_core.sql`](../../frontend/src/server/db/migrations/0001_operational_core.sql). Migration diterapkan dan readiness HTTP berhasil; create/status transaction, concurrency, dan restart belum diperiksa. |
| Identitas staf, sesi, role/region scope dan audit admin | Source staging tersedia; unauthenticated access gate memberi 401; authenticated role/region belum diverifikasi | `GET /api/staff/incidents` dan `GET /api/staff/operations/config` memberi `401 staff_session_required` tanpa sesi. Session PostgreSQL, revocation, provisioning dan scope ada di [`staff-session.ts`](../../frontend/src/server/auth/staff-session.ts). MFA/IdP, recovery dan pemilik provisioning nyata belum diputuskan. |
| Kategori, SOP, konfigurasi operasi, roster simulasi dan intake dinamis | Source tersedia; migration 0004 diterapkan; public-config HTTP berhasil, staf workflow/UI belum dijalankan end-to-end | `GET /api/operations/public-config` memberi HTTP 200 dengan satu kategori simulasi, service hours kosong, fallback yang menyatakan tidak ada bantuan darurat, dan tanpa roster/SOP. Implementasi ada di [`0004_operator_workflow.sql`](../../frontend/src/server/db/migrations/0004_operator_workflow.sql). |
| Queue, claim/release/takeover, workflow dan proyeksi warga | Source fase 3 tersedia; runtime belum diverifikasi | Role/scope, status transition, withdrawal, private staff projection dan redaksi public projection ada pada roadmap. Belum dibuktikan melalui HTTP/socket/browser. |
| Outbox realtime | Source tersedia; delivery runtime belum diverifikasi | Publisher mengirim event UI. Ini bukan dispatch ke responder dan bukan bukti browser menerima atau petugas membaca event. |
| Dispatch intent, provider adapter, acknowledgment dan dead-letter | Belum tersedia di source | Belum ada durable dispatch queue/provider contract. Outbox realtime yang ada tidak memenuhi requirement dispatch. Desain usulan ada di [spesifikasi workflow operasional](../superpowers/specs/2026-10-03-sigap-full-operational-design.md), masih menunggu persetujuan dokumen. |
| Privacy request, retensi, ekspor, penghapusan/anonimisasi | Belum tersedia | Kebijakan dan workflow lifecycle belum ada. Durasi retensi/legal hold tidak boleh diasumsikan sebelum pemilik layanan memutuskan. |
| Anti-abuse/security hardening | Sebagian fondasi tersedia; kontrol penting belum ada | Ada batas ukuran payload, cookie/session dan beberapa security header. Rate limiting, CSRF untuk mutasi cookie, throttling login persisten, MFA/IdP dan latihan abuse belum dibuktikan/diimplementasikan. |
| Reliability dan observability | Startup/readiness lokal dasar berhasil; operational reliability belum tersedia/belum diverifikasi | `/api/healthz` dan `/api/readyz` menghasilkan 200 dengan database schema v4. Metrics, alert routing, retry cap/dead-letter, encrypted backup, restore drill dan deploy/rollback staging belum tersedia atau belum dibuktikan. |
| Pilot/operasi publik | Belum siap dan belum disetujui | Belum ada pemilik layanan, wilayah, responder/kanal, fallback, policy data, roster/SOP nyata, dukungan on-call, target SLO/RPO/RTO, hosting, security/privacy sign-off atau penerimaan lapangan. |

## Bukti baseline yang perlu dibedakan

Dokumen implementation plan historis memuat snapshot prototipe awal: penyimpanan in-memory, satu akun demo, daftar unit statis dan global staff room. Itu bukan lagi deskripsi source terkini. Gunakan [roadmap operasional](./roadmap-sigap-operasional.md) untuk status source fase 1–3. Migration yang tersedia sekarang adalah `0001_operational_core.sql` hingga `0004_operator_workflow.sql`; keberadaan file migration tidak berarti sudah diterapkan.

## Gap untuk melanjutkan sampai staging feature-complete

1. **Verifikasi runtime fase 1–3.** Terapkan migration pada database staging sintetis, bootstrap admin, lalu verifikasi create/retry, login/role/region, queue/workflow, withdrawal, realtime invalidation, konflik dan restart. Catat command, hasil, dan keterbatasan yang benar-benar diamati.
2. **Lengkapi dispatcher workflow.** Pastikan acknowledgment, ownership, umur antrean, supervisor takeover dan eskalasi memiliki precondition, audit dan perilaku serentak yang teruji.
3. **Bangun dispatch adapter framework lokal.** Tambahkan durable intent/attempt/ack, local mock tanpa network egress, idempotency, timeout-unknown, bounded retry, manual review/dead-letter dan UI operasional. Tetap beri label simulasi.
4. **Bangun privacy lifecycle untuk data sintetis.** Sediakan policy versioning, request workflow, export control, dry-run purge/anonymize dan audit. Jangan menjalankan purge pada data nyata sampai policy serta legal hold disetujui.
5. **Tambahkan security/abuse controls.** Rate limit yang tidak menghukum jaringan bersama secara berlebihan, CSRF, header, persistent login throttle, redacted logs, role/scope review dan threat-model exercise.
6. **Tambahkan reliability staging.** Queue/outbox/database metrics, readiness dependency/migration, alert sink lokal, backup/restore drill di database terpisah, runbook serta startup/shutdown/rollback yang dapat diulang.
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
