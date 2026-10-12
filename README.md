# SIGAP

SIGAP adalah aplikasi web pelaporan dan pemantauan insiden keselamatan. Warga dapat mengirim laporan dengan lokasi GPS perangkat, sedangkan petugas dapat meninjau dan memperbarui status laporan.

> **Batas layanan:** instalasi ini tidak terhubung ke layanan darurat resmi dan tidak mengirim petugas. Jangan gunakan untuk menggantikan panggilan ke layanan darurat setempat.

## Setup dari awal (Windows atau Linux + XAMPP)

Ikuti langkah berikut berurutan untuk menjalankan SIGAP di laptop. XAMPP menyediakan MariaDB yang biasanya ditampilkan sebagai layanan **MySQL**. SIGAP tetap berjalan melalui Node.js; menyalin source ke `htdocs` saja tidak cukup. Apache tidak diperlukan kecuali ingin memakai phpMyAdmin.

### 1. Pasang dan nyalakan prasyarat

1. Pasang **Node.js versi LTS** (npm disertakan bersama Node.js).
2. Pasang **XAMPP** yang menyertakan MariaDB.
3. Buka XAMPP Control Panel (Windows) atau panel XAMPP (Linux), lalu tekan **Start** pada **MySQL**. Catat portnya; default biasanya `3306`.
4. Pastikan status MySQL sudah **Running**. SIGAP dan database harus berada di laptop yang sama untuk setup lokal ini.

### 2. Clone repository

Buka terminal (Windows: PowerShell atau Command Prompt; Linux: Terminal), lalu jalankan:

```bash
git clone https://github.com/RenDY-16/sigap.git
cd sigap/frontend
```

Pastikan folder aktif adalah `frontend` dan di dalamnya ada `package.json`. Semua perintah `npm` pada panduan ini harus dijalankan dari folder tersebut. Jika Git belum terpasang, unduh ZIP dari [repository SIGAP](https://github.com/RenDY-16/sigap), ekstrak, lalu buka terminal pada folder hasil ekstraksi `sigap/frontend`.

### 3. Instal paket dan jalankan setup pertama

```bash
npm ci
npm run xampp
```

Perintah pertama memasang paket aplikasi sesuai lockfile. Perintah kedua menjalankan wizard setup, migrasi database, build frontend, lalu memulai server. Saat wizard berjalan:

1. Masukkan password database XAMPP untuk user `root`. Pada sebagian instalasi XAMPP lokal password root kosong; tekan **Enter** hanya jika akun Anda memang tidak memakai password. Input password tidak terlihat saat diketik.
2. Wizard menguji koneksi dan membuat database baru bernama `sigap`, lalu mengisi tabel yang diperlukan.
3. Jika database belum memiliki administrator, ikuti prompt untuk membuat username, nama tampilan, dan password admin. Tentukan password sendiri dan simpan dengan aman; tidak ada password admin bawaan.
4. Setup membuat `frontend/.env` dengan konfigurasi koneksi serta secret sesi acak. Setelah itu proses membangun aplikasi dan menyalakan server.

Biarkan terminal tetap terbuka. Jika wizard gagal, baca bagian pemecahan masalah di bawah. Jangan menjalankan perintah dari `/home/nama-user`, root repository, atau `htdocs`; jalankan dari `sigap/frontend`.

### 4. Buka dan cek website di laptop

Setelah terminal menunjukkan server berjalan, buka browser pada laptop yang sama:

- Halaman pelaporan warga: <http://127.0.0.1:3001/>
- Login petugas/admin: <http://127.0.0.1:3001/dashboard/login>

Untuk mematikan server tekan `Ctrl+C` pada terminal. Untuk menjalankan kembali, pastikan MySQL XAMPP aktif, masuk lagi ke folder `sigap/frontend`, lalu jalankan `npm run xampp`.

## Isi file `.env`

Untuk instalasi baru dengan XAMPP, Anda **tidak perlu membuat atau mengisi `.env` secara manual**. Perintah `npm run xampp` membuat file tersebut otomatis. Bentuk nilai standarnya seperti berikut (password dan secret sengaja berupa placeholder; gunakan nilai yang dibuat wizard):

```dotenv
DATABASE_URL=mysql://root:PASSWORD_DATABASE@127.0.0.1:3306/sigap
DATABASE_POOL_MAX=10
HOST=127.0.0.1
PORT=3001
SESSION_SECRET=SECRET_ACAK_MINIMAL_32_BYTE
LAN_DEMO=0
TLS_CERT_PATH=
TLS_KEY_PATH=
VITE_DEMO_MAP_CENTER_LAT=0
VITE_DEMO_MAP_CENTER_LNG=0
VITE_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
VITE_MAP_ATTRIBUTION=© OpenStreetMap contributors
```

`DATABASE_URL` memakai password root XAMPP yang Anda masukkan; jika password kosong bagian `:PASSWORD_DATABASE` juga kosong. `SESSION_SECRET` dibuat otomatis dan berbeda untuk tiap laptop. Jangan memakai teks placeholder di atas sebagai nilai sungguhan, jangan bagikan file `.env`, dan jangan commit file itu ke Git.

### Jika port, host, atau user MySQL berbeda

Jika MySQL XAMPP menggunakan port bukan `3306`, jalankan setup dengan nilai yang benar. Contoh port `3307`:

```bash
npm run setup:xampp -- --host 127.0.0.1 --port 3307 --user root --database sigap
npm run xampp
```

Ganti host/user/database sesuai konfigurasi XAMPP Anda. Wizard akan meminta password database. Database baru harus kosong dan akun database perlu izin membuat database. Jika `.env` yang ada memakai PostgreSQL, setup tidak menimpanya diam-diam. Untuk beralih secara sengaja gunakan `npm run setup:xampp -- --reconfigure`; konfigurasi lama disimpan di backup privat. Data PostgreSQL tidak dikonversi.

## Akses dari HP pada Wi-Fi yang sama

Jalankan perintah ini dari terminal `sigap/frontend`:

```bash
npm run xampp:lan
```

Perintah tersebut menyiapkan HTTPS lokal, lalu build dan menyalakan server. Buka alamat HTTPS yang dicetak terminal di HP, misalnya `https://192.168.1.20:3001`.

1. Hubungkan laptop dan HP ke Wi-Fi yang sama.
2. Ketik alamat IP persis seperti yang dicetak oleh terminal.
3. Jika browser memberi peringatan sertifikat lokal, percayai/lanjutkan sesuai pilihan browser. Beri izin lokasi saat diminta.
4. Jika alamat tidak terbuka, izinkan Node.js atau port aplikasi `3001` di firewall laptop untuk jaringan privat dan pastikan router mengizinkan komunikasi antarperangkat.

Browser membutuhkan HTTPS untuk akses GPS. Sertifikat dibuat lokal dan mungkin perlu dipercaya pada HP. Jangan membuka port database `3306` ke jaringan; HP mengakses aplikasi di port `3001`. Server dan terminal laptop harus tetap berjalan saat HP mengakses website.

## Menyalin project ke laptop lain

Di laptop baru, pasang Node.js dan XAMPP, nyalakan layanan MySQL, clone repository, lalu ulangi langkah 2–4. `npm ci` memasang paket, dan wizard membuat `.env`, database/tabel, secret sesi, serta admin lokal baru. Menyalin folder kode tidak membawa isi database laptop lama. Jika perlu membawa data, ekspor database MariaDB lama melalui phpMyAdmin atau `mariadb-dump`, lalu impor secara sengaja ke MariaDB laptop baru.

Jangan pindahkan atau bagikan `.env`, password database, `SESSION_SECRET`, sertifikat privat dalam `.local-certs`, atau backup database tanpa perlindungan.

## Pemecahan masalah

- **`Could not read package.json`** — terminal berada di folder yang salah. Jalankan `cd sigap/frontend`, lalu ulangi perintah npm.
- **Koneksi database gagal** — pastikan MySQL XAMPP berstatus Running; cocokkan host, port, username, dan password yang dimasukkan.
- **Tidak dapat membuat database** — akun MySQL yang dipakai perlu izin `CREATE DATABASE`; gunakan akun lokal yang berwenang atau buat database kosong `sigap` terlebih dahulu melalui phpMyAdmin, lalu jalankan setup dengan user yang dapat mengaksesnya.
- **Port 3001 sudah dipakai** — hentikan proses SIGAP lama atau ubah `PORT` di `.env`, lalu jalankan kembali.
- **Admin tidak bisa dibuat** — setup admin pertama memerlukan terminal interaktif; jalankan `npm run staff:bootstrap` dari `frontend`.
- **HP tidak dapat mengakses** — jalankan `npm run xampp:lan`, periksa IP yang tercetak, Wi-Fi, firewall, dan peringatan sertifikat browser.
- **Migrasi gagal sebagian** — jangan hapus database yang berisi data penting. Catat pesan terminal dan periksa database sebelum mencoba memperbaiki atau membuat ulang database kosong.

## Dukungan database dan dokumentasi

Setup XAMPP menargetkan MariaDB `10.4+`; kompatibilitas Oracle MySQL 8 belum diverifikasi. Data PostgreSQL lama tidak dikonversi otomatis. Perintah `db:up`, `db:down`, dan `db:backup` adalah helper PostgreSQL, bukan helper XAMPP.

Panduan teknis XAMPP: [`docs/fathul/xampp.md`](docs/fathul/xampp.md). Panduan PostgreSQL: [`docs/fathul/run-demo.md`](docs/fathul/run-demo.md). PRD, desain, dan catatan teknis lainnya: [`docs/fathul/`](docs/fathul/).
