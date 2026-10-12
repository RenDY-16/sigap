# Menjalankan demo SIGAP dari ponsel

Panduan ini untuk demo di jaringan Wi-Fi lokal yang sama dengan **data sintetis**. Aplikasi ini tetap prototipe staging: laporan tidak dikirim ke layanan darurat atau responder sungguhan. Laporan disimpan pada PostgreSQL lokal sehingga tetap ada setelah proses aplikasi dimulai ulang selama named volume database dipertahankan. Akun petugas individual dan sesi tersimpan di PostgreSQL; restart aplikasi tidak otomatis menghapus sesi yang masih aktif. Sesi memiliki expiry absolut delapan jam dan dapat dicabut.

Jangan masukkan laporan nyata, koordinat sensitif, atau data pribadi ke demo ini. Unit yang terlihat di dashboard adalah unit simulasi; aksi petugas tidak mengirim bantuan.

## Siapkan HTTPS lokal

Geolocation browser memerlukan secure context. Untuk membuka dari ponsel lewat alamat LAN, gunakan HTTPS dengan sertifikat yang dipercaya ponsel. Alamat `http://localhost` dapat dianggap aman di perangkat yang menjalankan server, tetapi alamat LAN seperti `http://192.168.x.x` tidak.

Salah satu pilihan untuk development adalah `mkcert`. Instalasi CA lokal hanya dilakukan pada Fedora milikmu; jangan jalankan perintah install sebagai root. Sertifikat server harus mencakup alamat IP LAN Fedora yang dipakai ponsel.

1. Pasang `mkcert` dan dukungan NSS sesuai petunjuk resmi proyeknya. Jika mkcert membuat root CA, simpan private key root CA hanya di Fedora. Jangan salin atau kirim `rootCA-key.pem`.
2. Buat folder lokal yang diabaikan Git untuk sertifikat:

   ```sh
   mkdir -p .local-certs
   chmod 700 .local-certs
   ```

3. Cari alamat IPv4 lokal Fedora, misalnya `192.168.1.20`, lalu buat sertifikat yang mencakup alamat itu:

   ```sh
   mkcert -cert-file .local-certs/sigap-lan.pem -key-file .local-certs/sigap-lan-key.pem 192.168.1.20
   chmod 600 .local-certs/sigap-lan-key.pem
   ```

   Ganti contoh IP dengan alamat Fedora yang sebenarnya. Jika alamat LAN berubah, buat ulang sertifikat untuk alamat baru.
4. Agar ponsel mempercayai sertifikat, pasang hanya sertifikat publik root CA (`rootCA.pem`) pada perangkat demo, lalu tandai sebagai CA tepercaya melalui pengaturan perangkat. Alurnya berbeda menurut Android/iOS dan browser. Berbagi CA memperluas kepercayaan perangkat terhadap sertifikat yang ditandatangani CA tersebut; batasi pada perangkat milik sendiri dan hapus CA setelah demo bila tidak dipakai lagi. Jangan pernah berbagi `rootCA-key.pem`.

> Android dapat membatasi pemakaian sertifikat CA yang dipasang pengguna pada aplikasi native. Uji melalui browser perangkat; dukungan aplikasi native berbeda.

## Siapkan database staging lokal

Jalankan dari folder `frontend`. Database development memakai Podman dan PostgreSQL 18, hanya bind ke `127.0.0.1:54329`, serta memakai named volume `sigap-postgres18-data`.

1. Pasang dependency Node.js, lalu salin `.env.example` ke `.env` dan isi secret sesi lokal sendiri. Password staf dibuat melalui bootstrap/admin, bukan melalui `.env`. `DATABASE_URL` pada template sudah cocok dengan database lokal yang dibuat script; jangan menaruh kredensial ini pada `VITE_*` atau mengirim file `.env`.

   ```sh
   npm ci
   cp .env.example .env
   ```

2. Nyalakan PostgreSQL dan tunggu health check:

   ```sh
   npm run db:up
   npm run db:container:status
   ```

3. Terapkan migrasi dan pastikan semua schema version sudah terpasang:

   ```sh
   npm run db:migrate
   npm run db:status
   ```

   Status siap mengeluarkan `ready: true`, `currentVersion`, dan daftar `pending` kosong. Server juga menerapkan migrasi saat startup; bila database tidak tersedia atau migrasi gagal, proses server berhenti dengan pesan generik agar app tidak mulai menerima laporan pada schema yang belum siap.

### Bootstrap administrator dan akun individual

Setelah migrasi diterapkan, jalankan `npm run staff:bootstrap` dari terminal interaktif di folder `frontend`. Masukkan username 3–64 karakter (huruf kecil, angka, titik, underscore atau tanda minus), nama tampilan, password minimal 12 karakter, dan konfirmasi password. CLI menerima password tanpa menampilkannya; jangan memasukkan password melalui command argument, `.env`, atau chat. Verifier scrypt dan salt tersimpan, bukan plaintext password. Bootstrap menolak jika akun operator_admin sudah ada; tidak ada akun/default password bersama atau registrasi publik.

Login di `/dashboard/login`, lalu buka `/dashboard/accounts` sebagai operator_admin untuk membuat akun tambahan, mengubah nama/peran/scope, menonaktifkan/mengaktifkan akun, reset password manual, atau mencabut seluruh sesi akun. UI tidak mengembalikan atau menampilkan password setelah create/reset. Minimal satu operator_admin aktif dengan scope harus dipertahankan; disable/demotion terakhir ditolak. Perubahan akses, credentials, atau pencabutan sesi menaikkan versi akun dan mencabut sesi lama secara atomik. Jika mengubah akun sendiri, login ulang diperlukan. Logout mencabut sesi browser tersebut.

| Role staging | Hak dalam wilayah yang ditugaskan |
|---|---|
| dispatcher | Membaca antrean/detail dan mengerjakan workflow insiden biasa. |
| supervisor | Hak dispatcher serta mengelola transisi/penugasan eskalasi. |
| operator_admin | Membaca insiden/audit dan mengelola akun; tidak mengubah workflow insiden. |
| auditor | Membaca insiden serta audit; tidak mengubah workflow atau akun. |

Scope yang tersedia melalui provisioning saat ini hanya `local-staging`, satu wilayah sintetis. Admin akun adalah capability staging tersendiri; akses insiden/audit tetap membutuhkan scope eksplisit. REST dan setiap delivery socket membaca ulang principal, role, versi/sesi aktif, serta assignment wilayah dari database. Staf hanya bergabung ke room wilayah; region insiden berasal dari storage termasuk event outbox lama yang tidak memuat region. Akun nonaktif, sesi revoked/expired, role tak dikenal, scope kosong, atau error database tidak menerima data staf. Hook logout/revoke/disable memutus socket lokal; koneksi juga divalidasi kembali sebelum setiap broadcast.

Halaman `/dashboard/audit` tersedia untuk auditor/operator_admin, dengan feed aktivitas insiden dan administrasi akun/akses yang dibatasi wilayah. Audit list/detail dan `incident:realtime_delivery_attempt` merekam percobaan akses/pengiriman oleh server dengan actor individual; audit umum tidak menyalin koordinat. Event realtime bukan bukti browser menerima event atau manusia membaca laporan. Histori warga hanya menyebut `staff`; actor historis `staff-demo` dipertahankan sebagai legacy, tidak dialihkan ke akun baru.

Sesi menggunakan cookie HttpOnly, SameSite=Lax, dan Secure ketika HTTPS dikonfigurasi. Expiry absolut delapan jam tidak diperpanjang oleh aktivitas/touch; logout menyimpan tombstone agar stale session write tidak menghidupkan kembali sesi. Jangan mengganti `SESSION_SECRET` saat mengharapkan cookie lama tetap berlaku. Database tidak tersedia berarti akses ditolak; tidak ada fallback MemoryStore atau antrean global.

### Health dan readiness

- `GET /api/healthz` hanya menunjukkan proses web merespons; endpoint ini tidak membuktikan database siap.
- `GET /api/readyz` mengecek koneksi PostgreSQL dan kesesuaian migrasi. Respons `200` dengan `status: "ready"` berarti siap; kegagalan koneksi/schema atau migrasi tertunda menghasilkan `503` dan `status: "not_ready"`.
- Preflight `/api/readyz` hanya memberi petunjuk kesiapan, bukan bukti penyimpanan. Form warga baru menampilkan laporan sebagai tersimpan setelah API create mengembalikan sukses. Jika preflight, POST, atau koneksi gagal, UI menampilkan bahwa penyimpanan belum terkonfirmasi dan mempertahankan percobaan lokal agar dapat dikirim ulang dengan token serta idempotency key yang sama; jangan menganggap timeout atau `503` sebagai bukti laporan tersimpan.
- Bila halaman status atau dashboard tidak dapat membaca server, tampilkan status terakhir dan error. Setelah koneksi pulih, client mengambil ulang snapshot melalui HTTP. Socket.IO sendiri bukan bukti bahwa database tersedia.

## Backup, restore, dan reset data sintetis

Backup demo tetap dapat memuat deskripsi dan koordinat simulasi. Simpan file hanya di folder lokal dengan akses terbatas, jangan commit atau kirim. Jangan melakukan backup data nyata dengan alur staging ini.

```sh
set -eu
umask 077
backup_dir="$HOME/Documents/sigap-staging-backups"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup_file="$backup_dir/sigap-staging-$(date +%Y%m%d-%H%M%S)-$$.dump"
backup_tmp="${backup_file}.partial"
trap 'rm -f -- "$backup_tmp"' EXIT HUP INT TERM
podman exec sigap-postgres18-local pg_dump -U sigap_dev -d sigap_staging --format=custom > "$backup_tmp"
test -s "$backup_tmp"
mv -- "$backup_tmp" "$backup_file"
trap - EXIT HUP INT TERM
printf 'Backup tersimpan: %s\n' "$backup_file"
```

Untuk latihan restore, pulihkan ke database pemeriksaan terpisah agar data staging yang sedang dipakai tidak tertimpa:

```sh
set -eu
read -r -p "Path backup yang akan dipulihkan: " backup_file
test -s "$backup_file"
podman exec sigap-postgres18-local createdb -U sigap_dev sigap_restore_check
podman exec -i sigap-postgres18-local pg_restore --exit-on-error -U sigap_dev -d sigap_restore_check --no-owner --no-privileges < "$backup_file"
podman exec sigap-postgres18-local psql -v ON_ERROR_STOP=1 -U sigap_dev -d sigap_restore_check -c 'select current_database(), (select count(*) from incidents) as incidents, (select count(*) from schema_migrations) as migrations;'
```

Restore menggunakan `set -e`, sehingga kegagalan membuat database menghentikan blok sebelum `pg_restore`. Setelah query verifikasi menunjukkan database `sigap_restore_check` dan jumlah baris insiden dan migrasi yang sesuai dengan backup, bersihkan hanya database latihan tersebut:

```sh
podman exec sigap-postgres18-local dropdb -U sigap_dev --if-exists sigap_restore_check
```

Jangan menjalankan cleanup atau restore terhadap `sigap_staging` jika ada laporan yang ingin dipertahankan. Untuk mengulang demo dari data kosong, buat dan verifikasi backup dulu, hentikan aplikasi, lalu pastikan target volume benar. `npm run db:down` hanya menghapus container dan **mempertahankan** `sigap-postgres18-data`; perintah itu bukan reset data. Penghapusan named volume menghilangkan seluruh database secara permanen dan tidak tersedia sebagai perintah reset otomatis pada script proyek.

## Jalankan server

Isi `.env` dengan konfigurasi lokal. Untuk server yang hanya diakses di Fedora, gunakan `HOST=127.0.0.1` dan `LAN_DEMO=0`.

Untuk demo LAN, isi bagian ini pada `.env`:

```dotenv
HOST=0.0.0.0
PORT=3001
LAN_DEMO=1
TLS_CERT_PATH=.local-certs/sigap-lan.pem
TLS_KEY_PATH=.local-certs/sigap-lan-key.pem
```

Jalankan dari folder `frontend`:

```sh
npm run build
npm start
```

Untuk membuka ponsel, siapkan HTTPS lokal dahulu lalu gunakan konfigurasi LAN di atas. `npm start` menjalankan Express, API, Socket.IO, dan bundle client dari satu origin. Saat `Ctrl+C`/SIGTERM, server menghentikan penerimaan perubahan dan menunggu mutasi aktif, lalu mencoba mengirim hingga sepuluh batch outbox sebelum menutup koneksi. Event yang gagal atau tersisa setelah batas batch tetap berada di database untuk dicoba lagi saat proses berikutnya berjalan; shutdown tidak menjamin outbox kosong. Hentikan server sebelum menghentikan container database.

Container dapat dihentikan/dihapus sambil mempertahankan data database:

```sh
npm run db:down
```

Container berikutnya memakai named volume yang sama:

```sh
npm run db:up
npm run db:status
```

Untuk melihat `currentVersion` dan daftar file migration yang masih `pending`, gunakan `npm run db:status`; untuk menerapkan migration baru jalankan `npm run db:migrate`. Jangan mengedit migration yang sudah diterapkan karena checksum akan diperiksa; tambahkan migration baru untuk perubahan schema.

Gunakan `https://<IP-LAN-Fedora>:3001` di ponsel. Pastikan Fedora dan ponsel berada pada Wi-Fi yang sama. Jika koneksi gagal, periksa firewall Fedora untuk mengizinkan port TCP 3001 hanya di jaringan privat yang sedang dipakai. Jangan membuka port ini ke internet atau jaringan publik.

Setelah sertifikat dipercaya, buka alamat tersebut di browser ponsel dan izinkan lokasi ketika diminta. GPS memerlukan HTTPS yang dipercaya, izin lokasi browser, dan layanan lokasi perangkat aktif. Peta memakai tile OpenStreetMap dan memerlukan internet; tampilkan atribusi yang sudah ada.

## Catatan versi source fase 3

Source workspace utama mencakup fase 1–3, termasuk konfigurasi, antrean, intake warga dan workflow Editorial-UI. Pada 3 Oktober 2026, migration 0001–0004 telah diterapkan pada database staging sintetis lokal dan `db:status` menunjukkan schema v4 tanpa migration pending. Terapkan migration berikutnya hanya pada database staging sintetis.

Source fase 3 telah direview secara independen/scoped dengan perbaikan sebelum integrasi. TypeScript check dan production build lulus pada pemeriksaan sebelumnya (warning bundle JavaScript utama sekitar 1.62 MB). PostgreSQL lokal kini berhasil start; server startup, `GET /`, health/readiness, dan public config allowlisted merespons HTTP 200 dengan schema v4. Dua route staf yang diperiksa tanpa sesi menolak akses (401). Workflow SQL, authenticated role/region, Socket.IO, browser/UI, backup/restore, dan demo warga–petugas belum diverifikasi. Petunjuk di atas adalah panduan staging, bukan bukti kesiapan produksi.

### Konfigurasi dan workflow yang dituju oleh source fase 3

Konfigurasi versi-baru per wilayah simulasi mencakup jam/timezone, fallback copy/contact, kategori dan required fields, SOP, serta responder/availability/coverage simulasi. Warga memakai kategori dan field dari konfigurasi publik yang di-allowlist; konfigurasi staf dan SOP memerlukan role/scope sesuai route. Simpan konfigurasi dengan expected version; jika mendapat 409, muat ulang versi terbaru dan review sebelum menyimpan ulang.

Queue staf menyediakan filter server untuk status, owner, withdrawal pending dan umur, detail workflow, histori, ownership dan assignment. Dispatcher menjalankan workflow biasa; supervisor dapat mengelola eskalasi/takeover; operator_admin mengelola akun/config tanpa workflow; auditor read-only untuk insiden/audit. Setiap scope tetap dibatasi ke `local-staging`. Assignment responder hanya simulasi; tidak ada pengiriman atau acknowledgment eksternal.

Create warga menyematkan config version. Jika terjadi timeout atau hasil belum pasti, retry wajib memakai token, idempotency key dan payload sama. Hanya `operations_version_conflict` yang menjamin reject sebelum commit membuka pemuatan config baru dan review ulang; jangan mengganti payload/key untuk error yang hasil commit-nya belum diketahui. Jam layanan menampilkan fallback tetapi pada staging tidak memblokir submit. Withdrawal menghentikan tracking segera; koordinat baru ditolak dan tracking tidak mulai lagi otomatis. Keputusan withdrawal dicatat terpisah dari status operasional.

## Batasan demo

- Gunakan hanya lokasi simulasi atau lokasi yang memang ingin kamu tampilkan selama demo.
- Geolocation mengirim pembaruan ke server demo hanya selama laporan aktif dan berbagi lokasi diaktifkan.
- Data laporan bertahan setelah server aplikasi restart selama PostgreSQL dan named volume lokal tetap dipakai. Data hilang bila database atau volume dihapus tanpa backup yang bisa dipulihkan. Sesi aktif tetap tersimpan di PostgreSQL selama belum expired/revoked dan konfigurasi cookie/secret tetap sesuai.
- PostgreSQL dan server web pada panduan ini hanya untuk development/staging lokal dengan data sintetis, bukan deployment produksi atau koordinasi darurat nyata.
- `/api/readyz` dan proses migrasi membantu mencegah server menerima laporan ketika schema belum siap; keduanya bukan jaminan layanan produksi, backup, monitoring, atau on-call.
- Akun staf individual ini tetap identitas staging lokal; organisasi/role final, wilayah nyata, provisioning/recovery owner, IdP/MFA, persistent login throttle, kebijakan audit/retensi dan CSRF/security assessment masih perlu keputusan serta hardening sebelum penggunaan non-sintetis.
- Sertifikat `mkcert` hanya untuk development. Simpan private key server dan CA root dengan aman; `.local-certs` diabaikan Git.

## Batas verifikasi pembaruan 3 Oktober 2026

Fase 3 Task 1–4 source terintegrasi di workspace utama dan telah direview secara independen/scoped dengan perbaikan sebelum integrasi. TypeScript check dan production build lulus pada pemeriksaan sebelumnya dengan warning bundle utama sekitar 1.62 MB; empat protected Sites hashes tetap sama dengan baseline pada pemeriksaan tersebut. Migration 0001–0004 kini berhasil diterapkan; schema v4 tidak memiliki migration pending.

Tidak ada tests ditambahkan/dijalankan. PostgreSQL startup, migration execution, server startup/readiness, `GET /`, `/api/healthz` dan `/api/readyz` berhasil pada staging sintetis lokal. Browser preview belum terverifikasi. Auth/role/region enforcement, business SQL/transaksi, queue pagination, socket invalidation, retry/conflict, withdrawal stop, backup/restore, dan tampilan Editorial-UI tetap belum diverifikasi saat runtime. Pemeriksaan dasar ini bukan status kesiapan produksi.

Provider contract/adapter masih fase 4; privacy lifecycle, retensi, security hardening, anti-abuse fase 5; observability, reliability, deployment dan pilot gate fase 6. Perlu keputusan serta artefak eksternal: organisasi/operator dan pemilik teknis, wilayah/yurisdiksi, SOP, roster/shift, kanal resmi dan kontrak acknowledgment, kredensial/sandbox, fallback resmi, privacy/retention policy, legal/security sign-off, target SLO/RPO/RTO, on-call, biaya/hosting dan uji penerimaan bersama responder. Hingga semua itu tersedia, tetap gunakan data sintetis staging saja; SIGAP belum siap untuk bantuan darurat nyata.

Referensi: [mkcert README](https://github.com/FiloSottile/mkcert), [MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts), dan [MDN Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).
