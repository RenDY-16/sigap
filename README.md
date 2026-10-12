# SIGAP

SIGAP adalah aplikasi web pelaporan dan pemantauan insiden keselamatan. Warga dapat mengirim laporan dengan lokasi GPS perangkat; petugas dapat meninjau dan memperbarui status laporan. Aplikasi ini memerlukan server Node.js. XAMPP menyediakan MariaDB untuk penyimpanan data.

> **Batas layanan:** instalasi mandiri ini tidak terhubung ke layanan darurat resmi dan tidak mengirim petugas. Jangan gunakan untuk menggantikan panggilan ke layanan darurat setempat.

## Isi repository

- `frontend/` — aplikasi React/Vite, backend Express/Socket.IO, serta skrip setup dan migrasi.
- `docs/fathul/` — PRD, desain, panduan penggunaan, dan catatan teknis.

## Setup cepat dengan XAMPP

Ikuti bagian ini untuk instalasi baru di Windows atau Linux. XAMPP menyediakan MariaDB yang panelnya biasa memberi nama layanan **MySQL**. Apache tidak diperlukan untuk menjalankan SIGAP; nyalakan Apache hanya jika ingin memakai phpMyAdmin.

### 1. Pasang prasyarat

1. Pasang **Node.js versi LTS** beserta npm.
2. Pasang XAMPP yang menyertakan MariaDB.
3. Buka XAMPP Control Panel (Windows) atau panel/manager XAMPP (Linux), lalu nyalakan **MySQL**. Catat portnya; biasanya `3306`.
4. Pastikan MySQL/MariaDB XAMPP berjalan sebelum melanjutkan. Database harus dapat diakses lokal di laptop yang menjalankan SIGAP.

### 2. Unduh source code

Pilih salah satu cara berikut.

**Dengan Git:**

```bash
git clone https://github.com/RenDY-16/sigap.git
cd sigap/frontend
```

**Tanpa Git:** buka [repository SIGAP](https://github.com/RenDY-16/sigap), pilih **Code → Download ZIP**, ekstrak ZIP, lalu buka terminal di folder `sigap/frontend`.

> Semua perintah `npm` berikut dijalankan dari folder `frontend`, yaitu folder yang berisi `package.json`. Jangan jalankan dari folder home atau `htdocs`.

### 3. Instal dependensi dan konfigurasi database

```bash
npm ci
npm run setup:xampp
```

Wizard setup akan:

- meminta password database lokal jika diminta (pada beberapa instalasi XAMPP lokal akun `root` tidak memakai password; tekan Enter hanya jika memang kosong);
- membuat database baru bernama `sigap`;
- membuat file `.env` lokal dengan secret sesi acak;
- menjalankan migrasi tabel aplikasi;
- meminta pembuatan akun administrator pertama jika database belum memilikinya.

Isi sendiri username, nama, dan password administrator di terminal. Repository tidak menyediakan password admin bawaan. Simpan kredensial itu secara aman. File `.env` lokal tidak masuk Git.

Jika wizard menyatakan database tidak dapat dihubungi, periksa bahwa MySQL XAMPP sedang menyala, lalu cocokkan port dan akun database. Untuk port atau nama database khusus, jalankan setup dengan opsi, misalnya:

```bash
npm run setup:xampp -- --port 3307 --user root --database sigap
```

Wizard meminta password saat perlu. Jika XAMPP memakai host database selain `127.0.0.1`, tambahkan `--host HOST_DATABASE`. Jalankan wizard lagi hanya jika perlu mengubah konfigurasi yang sudah dibuat.

### 4. Jalankan SIGAP

```bash
npm run xampp
```

Perintah ini menyiapkan konfigurasi bila belum ada, menjalankan pemeriksaan migrasi, membangun frontend, lalu menyalakan server. Buka:

- Halaman warga: <http://127.0.0.1:3001/>
- Login petugas/admin: <http://127.0.0.1:3001/dashboard/login>

Biarkan terminal dan XAMPP tetap berjalan saat menggunakan aplikasi. Hentikan server dengan `Ctrl+C`; database dapat tetap berjalan di XAMPP.

### 5. Akses dari HP pada Wi-Fi yang sama

Di terminal folder `frontend`, jalankan:

```bash
npm run xampp:lan
```

Perintah ini membuat sertifikat HTTPS lokal untuk alamat IP laptop dan menyalakan server agar dapat diakses di jaringan lokal. Terminal menampilkan URL yang perlu dibuka di HP, biasanya berbentuk `https://ALAMAT-IP-LAPTOP:3001`.

1. Hubungkan HP dan laptop ke jaringan Wi-Fi yang sama.
2. Buka URL HTTPS yang dicetak oleh perintah.
3. Terima/percayai sertifikat lokal pada browser jika diminta, kemudian beri izin lokasi untuk situs tersebut.
4. Jika halaman tidak terbuka, izinkan koneksi masuk untuk Node.js/port `3001` pada firewall laptop dan pastikan jaringan Wi-Fi mengizinkan perangkat saling terhubung.

Jangan membuka port database `3306` ke Wi-Fi; hanya aplikasi di port `3001` yang perlu diakses HP. Akses lokasi GPS pada browser memerlukan konteks aman HTTPS. Sertifikat yang dibuat lokal mungkin tetap menampilkan peringatan sampai dipercaya pada perangkat.

## Memindahkan instalasi ke laptop lain

Pindahkan atau unduh source code, lalu ulangi langkah setup di atas. Di laptop baru, pasang Node.js dan XAMPP, nyalakan MySQL, kemudian jalankan `npm ci` dan `npm run xampp` dari `frontend`. Wizard membuat konfigurasi dan admin lokal baru.

Menyalin folder kode **tidak memindahkan isi database**. Untuk membawa data lama, ekspor database MariaDB dari laptop lama melalui phpMyAdmin atau `mariadb-dump`, lalu impor ke MariaDB laptop baru sesuai kebutuhan. Jangan membagikan file `.env`, password database, secret sesi, sertifikat privat, atau backup database publik.

## Setup alternatif: PostgreSQL

Repository juga mendukung setup pengembangan PostgreSQL yang sudah ada. Panduan rinci tersedia di [`docs/fathul/run-demo.md`](docs/fathul/run-demo.md). Perintah `db:up`, `db:down`, dan `db:backup` adalah helper PostgreSQL, bukan untuk database XAMPP.

## Catatan dukungan dan pemecahan masalah

- Target XAMPP adalah MariaDB `10.4+`; kompatibilitas Oracle MySQL 8 belum diverifikasi.
- Database tujuan untuk setup awal harus kosong. Jangan arahkan ke database yang sudah dipakai aplikasi lain.
- Data PostgreSQL lama tidak dikonversi otomatis ke MariaDB.
- Jika port `3001` sudah dipakai, hentikan aplikasi lain atau ubah `PORT` di `.env`, lalu jalankan ulang.
- Jika setup berhenti karena migrasi parsial, baca pesan terminal sebelum mencoba lagi. Jangan hapus database yang berisi data penting.
- Untuk masalah akses HP, pastikan alamat IP laptop masih sama, kedua perangkat ada di Wi-Fi yang sama, server berjalan dengan mode `xampp:lan`, dan firewall mengizinkan port aplikasi.
- XAMPP lokal belum dijalankan pada saat panduan ini ditulis; setup koneksi MariaDB dan izin GPS HP tetap perlu dikonfirmasi di perangkat tujuan.

Panduan rinci XAMPP: [`docs/fathul/xampp.md`](docs/fathul/xampp.md). PRD dan desain: [`docs/fathul/`](docs/fathul/).
