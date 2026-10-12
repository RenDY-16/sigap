# Antrean gagal realtime dan review operator

Tanggal: 12 Oktober 2026. Status: source API/publisher/UI terintegrasi; HTTP/PostgreSQL sintetis dan build diverifikasi. UI browser belum diperiksa langsung.

## Perilaku

Publisher berhenti mencoba otomatis setelah 8 kegagalan per siklus. Payload dan event ID dipertahankan pada dead-letter, tanpa mengklaim delivery sukses. Delay retry tetap eksponensial dan dicap 60 detik. Nilai 8 adalah default development; kebijakan produksi perlu persetujuan operator.

Migration 0006 menambah dead_lettered_at dan failed_attempts_total. Total kegagalan lama disalin dari attempts; pending historis yang sudah gagal setidaknya 8 kali masuk review. Migration tidak mengubah payload/ID maupun file migration lama. Hentikan worker versi lama sebelum deployment migration/worker baru agar semua worker mematuhi filter dead-letter.

## API dan halaman

- GET /api/staff/realtime/outbox: operator_admin/auditor dengan scope wilayah; state dead_letter (default) atau pending, limit 1–100, cursor keyset. Cursor mempertahankan mikrodetik PostgreSQL. DTO hanya metadata dan tidak mengandung payload, uraian atau koordinat.
- POST /api/staff/realtime/outbox/:id/retry: operator_admin saja, reason 1–500 karakter. Pemeriksaan sesi/role/wilayah diulang dalam transaksi. Row dikunci, current state diperiksa, satu siklus dijadwalkan ulang dan audit actor/reason ditulis atomik. Concurrent retry kedua ditolak 409. Total kegagalan dipertahankan; attempts siklus direset, bukan lifetime failures.
- /dashboard/realtime: antrean gagal/menunggu, pagination, metadata kegagalan, serta form review/retry admin. Auditor membaca saja. Tautan tersedia pada dashboard dan Audit. Gaya putih hangat, hitam/merah, tipografi besar dan kartu editorial mengikuti arah desain dashboard.
- Catatan outbox:list/outbox:retry dibaca melalui halaman Audit dengan allowlist khusus action dan batas wilayah. Alasan review merupakan field audit privat yang sengaja disimpan; jangan memasukkan kredensial atau menyalin payload laporan ke alasan.

Kirim ulang hanya menjadwalkan percobaan. Published-at berarti penerimaan emit oleh publisher, bukan bukti browser/manusia membaca event. Antrean ini khusus event UI dan tidak menggantikan dispatch intent/provider queue atau acknowledgment responder.

## Verifikasi

```sh
cd frontend
npm run test:outbox-review
```

Test memakai database sintetis unik sigap_outbox_, menerapkan migrasi, membuat akun/laporan milik test dan membersihkan database tersebut. Tidak memakai akun atau laporan staging pengguna. Publisher callback gagal/sukses merupakan fixture pada test ini; receipt socket nyata diperiksa terpisah oleh test:realtime.

Sepuluh kelompok pemeriksaan berhasil:

1. eight failures stop automatic retry.
2. dead-letter state and cumulative failures survive app/pool recreation.
3. authorized audit role reads metadata only; dispatcher and anonymous access denied.
4. region boundary applies to list and retry.
5. retry permission and bounded reason/query validation enforced.
6. concurrent manual retries yield one requeue and one conflict; actor audit atomic.
7. retry review is visible through scoped HTTP audit with allowlisted metadata.
8. requeued event can publish; published event leaves both review queues.
9. metadata keyset pagination retains microsecond precision and has no duplicates.
10. audit fault rolls back requeue and emits sanitized error.

Regresi lainnya dijalankan ulang: workflow 23 kelompok, throttle login 11, realtime 20; seluruhnya berhasil. TypeScript dan build lulus. Warning bundle Vite >500 kB tetap ada. Migration lokal diterapkan: schema v6, ready true, pending kosong. Server lokal merespons readiness schema 6, SPA /dashboard/realtime HTTP 200, dan menolak API antrean tanpa sesi dengan 401. HTTP 200 SPA bukan bukti render/interaksi browser.

Review subagent menemukan filter audit belum mengeluarkan event outbox. Test HTTP mereproduksi kegagalan sebelum perbaikan; filter dan allowlist khusus action diperbaiki, regression berhasil, dan reviewer tidak menemukan masalah konkret tambahan pada fix tersebut.

## Sisa pekerjaan

Browser/device verification, operational metrics/alert routing, capacity/crash/restore drills, privacy lifecycle, intake anti-abuse, provider dispatch subsystem serta deployment/sign-off pilot masih terbuka. Tidak ada layanan berbayar, responder resmi atau dispatch nyata yang diaktifkan.
