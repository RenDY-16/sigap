# Monitoring antrean SIGAP

Tanggal: 12 Oktober 2026. Status: API agregat dan halaman internal tersedia; verifikasi HTTP/PostgreSQL sintetis, belum verifikasi browser atau operasi publik.

## Akses dan tampilan

Halaman `/dashboard/monitoring` tersedia untuk staf yang dapat membaca insiden: dispatcher, supervisor, operator_admin dan auditor. API `GET /api/staff/monitoring` memeriksa ulang akun aktif, role, credential version, session expiry/revocation serta wilayah dengan lock pada koneksi transaksi yang sama. Shared admin advisory lock diambil sebelum account/session locks agar urutannya konsisten dengan mutasi admin. Semua agregat insiden dan outbox berasal dari **satu statement snapshot**, setelah pemeriksaan akses. Count menggunakan decimal string, termasuk cumulative failures; frontend memformatnya dengan BigInt agar nilai besar tidak dibulatkan.

Dashboard memakai canvas putih hangat, judul besar hitam, indikator merah, kontrol stabil dan layout responsif yang mengikuti dashboard editorial. Navigasi Monitoring muncul di dashboard utama serta review realtime. Refresh dilakukan saat halaman dibuka atau tombol Segarkan dipilih; belum ada auto-refresh, worker pemeriksaan latar belakang, atau notifikasi on-call.

## Arti angka

| Angka | Definisi |
|---|---|
| Laporan aktif | Insiden dalam wilayah akun dengan status selain resolved/referred. Withdrawal tidak menghapusnya dari antrean penanganan. |
| Belum dimiliki petugas | Subset aktif dengan owner_staff_id kosong. |
| Melewati umur antrean | Subset aktif yang dibuat setidaknya 900 detik sebelum waktu snapshot. |
| Laporan aktif tertua | Umur maksimum sejak create, dibatasi minimum nol; null bila kosong. Bukan durasi sampai acknowledgment. |
| Distribusi status | Semua insiden dalam scope, termasuk terminal. Status tanpa data bernilai string 0. |
| Pending/backoff | Outbox belum published dan belum dead-letter. Termasuk next_attempt_at di masa depan. |
| Jatuh tempo | Subset pending dengan next_attempt_at pada atau sebelum waktu snapshot. |
| Terlambat jatuh tempo | Subset pending yang next_attempt_at setidaknya 120 detik sebelum snapshot. |
| Dead letter | Outbox belum published, dead_lettered_at terisi; memerlukan review di halaman Realtime. |
| Published 15 menit | published_at di rentang 15 menit terakhir sampai waktu snapshot. Ini penerimaan emit server, bukan receipt browser atau acknowledgment manusia/responder. |
| Total kegagalan tersimpan | Jumlah lifetime failures pada seluruh event dalam scope, termasuk published. Bukan total failure abadi jika event kelak dipurge. |

Ambang 900/120 detik adalah default staging tetap, dikirim sebagai metadata ke UI. Ini belum merupakan SLA/SLO yang disetujui. Tiga indikator diturunkan pada waktu snapshot: queue_overdue, realtime_dead_letter dan realtime_due_delayed. Jumlah nol pada indikator tidak membuktikan keseluruhan sistem sehat.

## Privasi dan gangguan

DTO tidak memilih report/event IDs, deskripsi, jawaban form, lokasi, identitas pemilik laporan, token atau connection string. Scope region serta timestamp tetap dicantumkan. API staf memakai Cache-Control no-store. Ini agregat operasional, bukan export laporan atau telemetry publik.

Jika query agregat gagal, API menghasilkan 503 monitoring_unavailable tanpa SQL/private detail atau angka nol palsu. Jika database pemulihan sesi/principal tidak tersedia, middleware sekarang menghasilkan 503 staff_authentication_unavailable; kegagalan storage tidak diklasifikasikan sebagai sesi invalid. Sesi yang benar-benar hilang, dicabut, expired atau akun disabled tetap menghasilkan 401 pada endpoint staf. Frontend hanya mengakhiri sesi pada 401; refresh 503 mempertahankan snapshot sebelumnya dengan label bahwa keadaan saat ini belum diketahui. Perilaku UI tersebut diperiksa dari source/build, belum browser.

## Bukti

`npm run test:monitoring` membuat/menghapus database unik dengan pool satu koneksi. Route yang belum ada gagal awal pada 404 vs 200; regression auth-storage gagal pada 401 vs 503 sebelum middleware diperbaiki. Dua belas kelompok pemeriksaan:

1. Scope kosong: count nol, waktu snapshot dan no-store.
2. Anonymous/citizen bearer tidak dapat membaca monitoring staf.
3. Active/unowned/overdue/status sesuai fixture.
4. Pending/due/dead-letter/published dibedakan.
5. Future backoff tetap pending dan cumulative failure di atas Number.MAX_SAFE_INTEGER tetap persis.
6. Semua role baca staf didukung; akun foreign-region tidak melihat agregat local-staging.
7. Projection tidak berisi data laporan/credential/identitas privat yang diuji.
8. App/pool recreation mempertahankan hasil; pool satu koneksi selesai tanpa deadlock pada skenario serial.
9. Akun disabled tidak memakai cookie lama.
10. Principal lookup storage failure menjadi unavailable, bukan invalid session.
11. Session restoration storage failure menjadi unavailable; akses pulih setelah tabel dikembalikan.
12. Query outbox yang gagal menjadi monitoring_unavailable tanpa SQL detail.

Fixture umur/ownership/status memakai SQL langsung sehingga bukan bukti transisi workflow. Isolasi foreign-region diuji dengan akun scope wilayah tanpa laporan; konfigurasi operasional source saat ini membatasi intake local-staging. Belum ada fixture kedua wilayah sama-sama berisi data. Belum menguji race account mutation/snapshot, precise threshold boundary, full database outage/network timeout, crash/load, browser/reflow/aksesibilitas atau alert delivery. Regression workflow/realtime/login/intake/outbox serta build/TypeScript/packaging diperiksa terpisah.

## Prosedur lokal awal

- Indikator umur laporan: buka antrean, periksa claim dan status dengan operator/supervisor; umur agregat bukan alasan otomatis menutup laporan.
- Dead letter: buka Realtime, tinjau penyebab, jadwalkan retry beralasan jika sesuai. Admin saja melakukan retry.
- Event due terlambat: periksa proses server/publisher, readiness database, serta backlog. Jangan menyimpulkan penyampaian bantuan nyata dari published_at.
- Monitoring unavailable: jangan membaca angka terakhir sebagai keadaan sekarang. Periksa readiness/server/database dan ikuti fallback operator yang nantinya ditetapkan.

Monitoring scoped ini menyelesaikan sebagian observability. DB capacity metrics, local alert sink durable, routing on-call, acknowledgment alert, service targets, encrypted backups, restore drill dan deployment/pilot masih terbuka. Tidak ada layanan berbayar atau pesan eksternal yang dikonfigurasi.
