# Pembatasan login staf persisten

Tanggal: 12 Oktober 2026. Status: implementasi dan verifikasi PostgreSQL/HTTP sintetis; kebijakan produksi dan pemeriksaan browser belum disetujui/dibuktikan.

## Perilaku

Setiap request login dengan username/password bertipe dan berukuran valid melakukan reservasi sebelum password diverifikasi. Semua percobaan, termasuk sukses, dihitung. Batas awal development:

| Bucket | Batas | Window tetap |
|---|---|---|
| Sumber koneksi TCP | 30 | 5 menit |
| Sumber + username ternormalisasi | 5 | 15 menit |
| Username lintas sumber | 30 | 15 menit |

Reservasi atomik memakai transaction PostgreSQL dan UPSERT. Bucket dikunci dalam urutan digest yang konsisten untuk menghindari deadlock antarreservasi. Counter saturasi dibatasi limit+1. Request terblokir tidak memperpanjang window. Login berhasil tidak menghapus counter sehingga kredensial yang diketahui tidak dapat dipakai untuk mereset batas sumber.

HTTP 429 memakai kode login_throttled, pesan generik dan Retry-After; tidak membedakan akun terdaftar/nonaktif/tidak dikenal. Jika storage throttle gagal, login ditolak 503 login_protection_unavailable. Tidak ada fallback counter in-memory. Guard origin/custom header dari tahap sebelumnya tetap berjalan lebih awal.

## Identitas dan penyimpanan

Tabel staff_login_throttle hanya menyimpan bucket_key HMAC-SHA256, attempts, dan expires_at. Tidak menyimpan password, username mentah, atau alamat IP mentah. Ini pseudonimisasi, bukan anonimisasi penuh. HMAC memakai SESSION_SECRET dengan domain pemisah khusus; semua instance harus memakai secret yang sama. Perubahan secret mereset pemetaan bucket, selain mengubah validitas sesi; jangan merotasinya secara tidak sengaja antarrestart. Kebijakan secret lifecycle tetap perlu ditetapkan sebelum produksi.

IP diambil dari socket TCP; X-Forwarded-For tidak dipercaya. Di belakang proxy, semua request dapat dianggap berasal dari proxy yang sama. Dukungan proxy tepercaya perlu konfigurasi/desain terbatas sebelum deployment tersebut; jangan mengaktifkan trust proxy global tanpa verifikasi.

Record kedaluwarsa dibersihkan secara bounded, maksimal 100 record pada tiap reservasi. Cleanup berjalan autocommit sebelum transaksi reservasi dan memakai SKIP LOCKED. Jika tidak ada login, record kedaluwarsa dapat tetap ada sampai cleanup berikutnya; job retensi terjadwal belum tersedia.

## Bukti

Migration 0005 diterapkan pada database staging lokal; db:status menyatakan currentVersion 5, ready true, pending kosong. Migration 0001–0004 tidak diubah.

Jalankan dari frontend:

```sh
npm run test:login-throttle
```

Test membuat database sintetis unik, menerapkan semua migrasi, membuat akun admin sintetis dengan password acak di memori, menjalankan HTTP loopback pada port sementara, lalu menghapus database miliknya pada finally. Database staging dan akun pengguna tidak menjadi target test. SIGAP_VERIFY_DATABASE_URL dapat menunjuk server PostgreSQL development lain dengan izin membuat database; jangan menjalankan terhadap server produksi.

Sebelas pemeriksaan berhasil:

1. Lima login gagal diizinkan; keenam ditolak 429 dengan Retry-After.
2. Tiga record bucket hanya berisi digest.
3. Membuat ulang instance aplikasi mempertahankan blokir.
4. Percobaan terblokir tidak memperpanjang expiry.
5. Window kedaluwarsa mereset counter.
6. Dua puluh request serentak memberi lima respons kredensial dan lima belas throttle.
7. Rotasi username tetap terkena batas sumber.
8. Case/whitespace username memakai counter yang sama; password sah tidak melewati batas.
9. Setelah expiry, login sah membuat sesi admin yang dapat membaca API akun.
10. Username lintas sumber mencapai batas account global.
11. Tabel throttle tidak tersedia menghasilkan 503 generik.

Test awal menunjukkan percobaan keenam masih 401 sebelum implementasi; setelah implementasi semua pemeriksaan di atas berhasil. Verifikasi tidak mencakup browser, TLS, reverse proxy, restart OS, account recovery, IdP/MFA, attack assessment, atau workflow insiden lengkap.

## Sisa pekerjaan

Kebijakan limit produksi, dampak shared-IP dan denial of service terhadap username, monitoring/alert tanpa data sensitif, konfigurasi proxy, kontrol intake warga, retensi terjadwal, dan security assessment tetap terbuka. Target fitur lengkap belum selesai.
