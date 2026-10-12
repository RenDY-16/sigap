# Cara cepat pindah laptop

Setelah Node.js dan XAMPP tersedia, aktifkan MySQL di XAMPP, lalu dari folder `sigap/frontend`:

```bash
npm ci
npm run xampp
```

Pada laptop baru, perintah membuat `.env`, secret acak, database `sigap`, migrasi, dan meminta akun administrator pertama melalui terminal, lalu build dan menjalankan SIGAP. Default XAMPP lokal: host127.0.0.1, port3306, userroot. Tekan Enter pada prompt password database hanya jika akun XAMPP lokal memang tidak memakai password. Password staff ditentukan sendiri melalui prompt; tidak ada password staff default.

Untuk akses HP pada Wi-Fi yang sama gunakan `npm run xampp:lan`. Sertifikat lokal dan alamat IP disiapkan otomatis, tetapi browser HP masih perlu mempercayai sertifikat dan memberi izin lokasi. Tidak ada perubahan trust/global firewall otomatis.

Jika port/user/database berbeda, cukup konfigurasi sekali:

```bash
npm run setup:xampp -- --port 3307 --user sigap_user --database sigap
npm run xampp
```

`.env` PostgreSQL yang sudah ada tidak ditimpa. Jika ingin sengaja beralih gunakan `npm run setup:xampp -- --reconfigure`; file konfigurasi sebelumnya dibackup privat. Proses ini tidak mengonversi data PostgreSQL lama.

Catatan dukungan: implementasi menargetkan MariaDB10.4+ milik XAMPP, bukan MySQL8 yang belum diverifikasi. Pemindahan folder kode tidak membawa isi database lama. Setup pada database yang sudah berisi tabel aplikasi lain ditolak.

# SIGAP dengan database XAMPP

SIGAP tetap aplikasi Node.js + React; XAMPP menyediakan MariaDB melalui layanan yang diberi label MySQL. Apache/phpMyAdmin dapat dipakai untuk mengelola database. Memindahkan source ke htdocs saja tidak menjalankan backend Node.js.

## Instalasi baru

1. Install XAMPP dan jalankan MySQL. Jika ingin phpMyAdmin, jalankan Apache juga.
2. Buat database `sigap` dengan charset utf8mb4/collation utf8mb4_bin. Gunakan database kosong agar tidak bercampur tabel aplikasi lain.
3. Buat pengguna `sigap_user` dengan akses pada database `sigap`. Gunakan password sendiri; jangan membagikan nilainya di chat/Git.
4. Dari terminal, masuk ke `sigap/frontend`, lalu `npm ci`.
5. Salin `.env.xampp.example` menjadi `.env`. Isi DATABASE_URL dengan akun, password dan port database XAMPP. Password dengan karakter khusus harus URL-encoded. Isi SESSION_SECRET dengan nilai acak baru minimal32byte; contoh pembuatnya `openssl rand -hex 32`. Perintah itu mencetak secret hanya pada terminal sendiri.
6. Jalankan `npm run db:migrate`, lalu `npm run db:status`.
7. Untuk database baru tanpa administrator, jalankan `npm run staff:bootstrap` dan isi akun melalui prompt terminal.
8. Jalankan `npm run build`, lalu `npm start`. Buka `http://127.0.0.1:3001`.

```dotenv
DATABASE_URL=mysql://sigap_user:PASSWORD_DATABASE@127.0.0.1:3306/sigap
DATABASE_POOL_MAX=10
HOST=127.0.0.1
PORT=3001
LAN_DEMO=0
SESSION_SECRET=SECRET_ACAK_BARU
```

Placeholder tersebut harus diganti. SESSION_SECRET bukan password database maupun password akun staff. Database MySQL/MariaDB dipilih dari skema URL; URL postgresql:// tetap memilih PostgreSQL.

## HP di Wi-Fi yang sama

Tetap gunakan mode HTTPS LAN SIGAP: HOST=0.0.0.0, LAN_DEMO=1, kedua TLS path tersedia dan sertifikat mencakup alamat akses. HOST database tetap127.0.0.1 jika database XAMPP dan Node.js berada di laptop yang sama. HP mengakses server Node.js; tidak perlu mengekspos port3306 ke jaringan. Sertifikat terpercaya dan izin lokasi harus diperiksa langsung pada HP.

## Migrasi data dan batas dukungan

- Skema MariaDB disediakan terpisah dari migrasi PostgreSQL; checksum PostgreSQL lama tidak diubah.
- Baseline MariaDB versi8 mencakup laporan, GPS, konfigurasi, akun/sesi staff, audit, throttle, outbox, dan dispatch simulasi.
- Ini instalasi database baru. Data PostgreSQL lama tidak dikonversi otomatis.
- MariaDB10.4 menggunakan locking yang menunggu, bukan SKIP LOCKED. Transaksi SIGAP diserialkan pada mutex per database agar klaim pekerjaan, penggantian akses, dan pencatatan tetap konsisten. Throughput berbeda dari PostgreSQL.
- Migrasi DDL MariaDB tidak atomik. Kegagalan migrasi awal meninggalkan journal tidak selesai dan startup menolak skema parsial. Periksa penyebab, lalu buat ulang database baru yang kosong hanya jika tidak ada data yang perlu dipertahankan. Tidak ada penghapusan otomatis.
- Perintah db:up/db:down/db:container:status dan db:backup masih helper PostgreSQL. Untuk MariaDB gunakan XAMPP untuk layanan dan export/import phpMyAdmin atau mariadb-dump untuk backup. Jangan menjalankan helper PostgreSQL untuk database XAMPP.
- XAMPP di laptop pengguna belum terpasang; build/type-check bukan bukti server XAMPP dan GPS HP sudah bekerja.

Dokumentasi resmi: https://www.apachefriends.org/faq_windows.html dan https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/incompatibilities-and-feature-differences-between-mariadb-and-mysql-unmaint/incompatibilities-and-feature-differences-between-mariadb-10-4-and-mysql-8
