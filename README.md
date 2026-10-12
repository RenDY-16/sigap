# SIGAP — Source code

Kode frontend React/Vite, backend Express/Socket.IO, migrasi PostgreSQL, aset kota, serta dokumentasi PRD dan desain. Source mencakup pembaruan desain dashboard admin 5 Oktober 2026. Snapshot GitHub disiapkan 12 Oktober 2026.

Aplikasi masih staging: tidak mengirim bantuan darurat nyata. Repository tidak berisi akun, data PostgreSQL, sesi, sertifikat privat, atau file .env lokal. Nilai database pada .env.example adalah contoh sintetis untuk development lokal, bukan akun admin.

## Menjalankan di laptop

Prasyarat: Node.js/npm dan Podman untuk database lokal. Jalankan semua perintah dari folder frontend, bukan folder home.

```sh
cd frontend
npm ci
cp .env.example .env
```

Buat secret sesi baru:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Masukkan hasilnya ke SESSION_SECRET pada .env lokal. Lalu jalankan berurutan:

```sh
npm run db:up
npm run db:migrate
npm run staff:bootstrap
npm run build
npm start
```

Bootstrap meminta username, nama, dan password admin melalui terminal. Tidak ada password admin bawaan dalam repository. Jika database sudah berisi admin, bootstrap akan menolak membuat admin pertama lagi.

Buka http://127.0.0.1:3001 dan login petugas di http://127.0.0.1:3001/dashboard/login.

Panduan lengkap: frontend/docs/fathul/run-demo.md. PRD/desain: docs/fathul/. Dependensi node_modules dan build dist dikeluarkan; npm ci dan npm run build akan membuatnya kembali.

## Status pengembangan

Fase 1–3 memiliki source untuk persistence, identitas staf, dan workflow operator. Fitur provider/dispatch resmi, privacy lifecycle, security hardening, observability, serta verifikasi runtime menyeluruh masih belum selesai. Lihat docs/fathul/full-feature-gap-analysis.md dan docs/fathul/roadmap-sigap-operasional.md.
