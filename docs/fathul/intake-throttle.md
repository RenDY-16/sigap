# Pembatasan percobaan pembuatan laporan warga

Tanggal: 12 Oktober 2026. Status: implementasi dan verifikasi staging sintetis; belum merupakan kebijakan abuse layanan publik.

## Perilaku

`POST /api/citizen/incidents` memakai request budget PostgreSQL sebelum parser JSON, session, dan pekerjaan insiden:

| Bucket | Batas staging | Jendela |
|---|---:|---:|
| Sumber koneksi langsung | 120 percobaan | 60 detik |
| Token warga yang valid secara format | 10 percobaan | 60 detik |

Ini batas **percobaan**, termasuk retry idempotent, payload invalid dan konflik; bukan batas jumlah laporan yang diterima. Percobaan normal dengan token/key/payload yang sama tetap mengembalikan laporan yang sama. Ketika salah satu budget habis, request tidak mencapai service insiden dan mengembalikan HTTP 429 `intake_throttled`, `Retry-After` berupa detik, serta pesan penundaan. Membaca laporan dan withdrawal tidak menggunakan budget create ini. Frontend yang sudah ada menampilkan pesan error API dan menyimpan draft retry; belum ada countdown browser yang diverifikasi.

Token hex, uppercase hex dan base64url dinormalisasi ke digest byte yang sama sebelum HMAC. IP dan token mentah tidak disimpan pada tabel baru. Digest HMAC tetap data pseudonim, bukan jaminan anonimitas. Secret memakai `SESSION_SECRET` server dengan domain terpisah dari login throttle. Rotasi secret membuat bucket sebelumnya tidak berlaku; seluruh instance harus memakai secret yang konsisten. Pemisahan secret throttle dan kebijakan rotasinya masih pekerjaan deployment.

Window dimulai pada reservasi pertama dan tidak diperpanjang oleh request yang ditolak. Counter dijenuhkan pada limit + 1. Reservasi memakai transaksi/UPSERT dan urutan lock sumber lalu token; ketika sumber diblokir, token baru tidak menambah bucket. Cleanup menghapus paling banyak 100 bucket kedaluwarsa per request dengan `SKIP LOCKED`. Data yang kedaluwarsa saat trafik berhenti tetap tersimpan sampai request berikutnya; ini bukan lifecycle retensi seluruh aplikasi.

Kegagalan storage protection menghasilkan HTTP 503 `intake_protection_unavailable` dengan pesan generik. Tidak ada laporan baru yang diterima lewat endpoint tersebut ketika limiter tidak dapat memutuskan budget. Ini trade-off ketersediaan yang harus dinilai bersama fallback resmi sebelum pilot.

## Sumber dan deployment

Guard memakai `request.socket.remoteAddress`, menormalkan IPv4-mapped IPv6. `Forwarded` dan `X-Forwarded-For` dari klien tidak dipakai. Implementasi saat ini untuk koneksi langsung staging. Di belakang reverse proxy semua request dapat berbagi alamat proxy dan limit sumber; jangan mengaktifkan trust-proxy global tanpa merancang ingress tepercaya serta memverifikasi guard ini. NAT/jaringan kampus juga berbagi budget sumber. Ambang cukup longgar dibanding budget token tetapi belum dibuktikan tepat untuk trafik nyata.

Token warga bukan identitas terverifikasi. Penyerang dapat memutar token atau menyebar sumber. Fixed window juga mengizinkan burst di perbatasan window; dua budget ini tidak menyelesaikan distributed spam, volumetric DoS, penyalahgunaan GPS/read/withdrawal atau assessment abuse menyeluruh. Tidak ada CAPTCHA, layanan berbayar, atau klaim perlindungan produksi yang ditambahkan.

Migration `0007_citizen_intake_throttle.sql` menambahkan tabel khusus; migration lama tetap utuh. Terapkan migration sebelum menjalankan source baru. Readiness menganggap migration pending sebagai belum siap. Instance source lama tidak mengimplementasikan guard baru, sehingga rollout campuran tidak menjamin perlindungan yang sama.

## Bukti verifikasi

`npm run test:intake-throttle` membuat database unik lalu menghapusnya. Test awal gagal pada percobaan ke-11: HTTP 201, seharusnya 429; setelah implementasi 11 kelompok pemeriksaan berhasil:

1. Retry normal menghasilkan satu laporan; percobaan ke-11 ditolak dengan Retry-After.
2. Tabel hanya berisi HMAC key, counter, expiry.
3. App/pool recreation mempertahankan counter dan expiry.
4. Tiga encoding token memakai budget yang sama.
5. GET laporan dan withdrawal tetap tersedia setelah limit create habis.
6. Expiry membuka budget dan retry tetap mengembalikan laporan semula.
7. 20 request HTTP serentak menghasilkan tepat 10 penerimaan dan 10 penolakan.
8. JSON invalid dan spoofed forwarding header tetap mengonsumsi budget koneksi; sumber yang diblokir tidak mengalokasikan bucket token baru.
9. Token budget berlaku lintas sumber/instance limiter.
10. Shared-source concurrency 130 token berbeda menerima 120 dan menolak 10 tanpa bucket tambahan.
11. Storage limiter yang tidak tersedia menolak create tanpa menambah insiden.

Regresi yang dijalankan pada source ini: workflow 23 kelompok, realtime native 20, login throttle 11, outbox review 10, Sites packaging 4. TypeScript dan build berhasil. Bundle JavaScript masih sekitar 1.63 MB sebelum gzip; optimisasi pemuatan frontend belum selesai. Bukti ini bukan pengujian browser/perangkat, load test, outage seluruh sistem, atau sign-off publik.
