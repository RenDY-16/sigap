# Draft Arsitektur SIGAP Operasional

**Tanggal:** 3 Oktober 2026  
**Status:** Draft arsitektur untuk ditinjau; arah produknya telah dikonfirmasi pengguna, detail organisasi dan operasi tetap terbuka  
**Arah produk dikonfirmasi:** platform menggunakan dispatcher manusia; koneksi ke dispatch instansi resmi dilakukan setelah pemilik dan kanal responder disepakati.

## 1. Tujuan dan batas layanan

Membawa aplikasi dari demonstrasi lokal menuju platform penerimaan dan penanganan laporan yang dapat dipersiapkan untuk operasi. Sistem harus menyimpan laporan secara tahan restart, mengelola akses petugas per individu, mencatat perubahan penting, dan menginformasikan status laporan kepada warga.

Draft ini **belum menyatakan layanan siap menerima keadaan darurat**. Wilayah layanan, organisasi operator, jam jaga, SOP, kanal eskalasi, mitra responder, kewajiban hukum, dan deployment belum ditetapkan. Sebelum hal tersebut disepakati dan diuji, semua lingkungan harus jelas berlabel *staging* dan tidak mengarahkan warga untuk mengandalkannya sebagai layanan penyelamatan.

Dispatch resmi di luar dashboard operator memerlukan integrasi yang disetujui pemilik instansi. Jika belum tersedia, produk tidak boleh menampilkan seolah-olah unit sedang bergerak. Status “diterima”, “sedang ditangani”, dan “bantuan dikirim” hanya boleh diberikan berdasarkan acknowledgement nyata dari operator atau kanal yang terhubung.

## 2. Prinsip desain

- **Konfirmasi jujur:** bedakan laporan terkirim, diterima operator, sedang ditangani, bantuan diteruskan, dan selesai.
- **Manusia bertanggung jawab:** triase dan dispatch mengikuti SOP operator; aplikasi membantu antrian dan pencatatan, bukan membuat klaim respons otomatis.
- **Lokasi terbatas:** minta izin sebelum lokasi, tunjukkan apakah GPS terkini, simpan dengan masa retensi terpilih, dan batasi akses berbasis tugas/wilayah.
- **Tahan gangguan:** reconnect mengambil snapshot terbaru; event yang terlewat tidak boleh menghilangkan laporan; alarm operator tidak hanya mengandalkan tab browser yang terbuka.
- **Audit penting:** catat siapa melakukan perubahan status, assignment, pembatalan, dan tindakan administratif, tanpa menulis token atau kredensial ke log.
- **Gagal dengan aman:** bila layanan tak dapat memastikan laporan diterima, beritahu warga dengan jelas dan tampilkan kanal bantuan resmi yang berlaku setelah wilayah diputuskan.

## 3. Pengguna dan peran yang diusulkan

| Peran | Tanggung jawab |
|---|---|
| Warga/pelapor | Membuat laporan, memberi izin berbagi lokasi, menerima status, dan meminta pembatalan. |
| Dispatcher | Memantau antrian, menghubungi/menilai laporan sesuai SOP, mencatat keputusan, dan meneruskan ke responder yang berwenang. |
| Supervisor | Mengambil alih eskalasi, memantau laporan tertunda, dan meninjau tindakan operasional. |
| Administrator organisasi | Mengelola akun, peran, wilayah, roster, jam layanan, konfigurasi kanal, dan masa retensi. |
| Auditor/petugas privasi | Meninjau jejak audit dan permintaan akses/penghapusan sesuai kewenangan. |

Peran, batas wilayah, dan nama akhir harus disesuaikan dengan struktur organisasi operator.

## 4. Arsitektur yang diusulkan

### Klien warga

- Form mobile-first dan singkat dengan kategori insiden yang disetujui operator.
- Pelaporan dapat dimulai tanpa akun; akses status memakai kredensial insiden acak yang tidak muncul di query URL, referrer, analitik, atau log.
- UI menjelaskan apakah lokasi sedang diminta, GPS berhasil, lokasi tidak tersedia, atau input manual dipakai. Pemilihan titik manual tidak dilabeli sebagai GPS.
- Laporan yang gagal karena jaringan harus dapat dicoba kembali tanpa menggandakan insiden; server menyimpan idempotency record secara persisten.
- Reconnect memuat ulang status otoritatif dari server; notifikasi di luar halaman (SMS/push/telepon) belum dipilih dan perlu persetujuan biaya serta kebijakan.
- Warga dapat meminta pembatalan pada tahap mana pun; browser segera menghentikan live location updates, server mencatat permintaan, dan operator menerima pemberitahuan. Permintaan tidak menghapus koordinat sebelumnya; akses dan retensinya mengikuti kebijakan yang disetujui. Tracking hanya dapat dimulai lagi setelah warga memberi persetujuan baru.

### Dashboard operasi

- Antrian tersimpan dan difilter menurut wilayah, waktu, status, serta kepemilikan dispatcher.
- Tampilan daftar tetap dapat digunakan bila basemap gagal; koordinat, waktu update, dan status sumber lokasi tetap tersedia.
- Dispatcher melakukan acknowledgement, triase manual, assignment responder yang nyata, dan pencatatan kanal tujuan.
- SLA/indikator laporan tertunda memakai target operasional yang ditetapkan operator; draft ini tidak menetapkan angka SLA.
- Supervisor dapat mengambil alih, mengeskalasi, dan melihat antrean yang belum diakui.
- Semua perubahan menghasilkan audit event append-only dengan actor, waktu server, entitas, aksi, dan alasan bila diperlukan.

### API, data dan proses latar

- API server tetap menjadi otoritas autentikasi, validasi status, lokasi, dan authorization.
- **Usulan penyimpanan utama:** PostgreSQL untuk laporan, lokasi terbaru (latitude/longitude), konfigurasi wilayah, responder, assignment, dan audit. Tambahkan PostGIS hanya jika geometri batas wilayah/kueri spasial dibutuhkan setelah wilayah layanan ditentukan. Sebelum pemilihan final, tinjau skala, kebutuhan retensi, hosting, biaya, dan kemampuan operator.
- Riwayat perubahan penting masuk tabel audit terpisah; data lokasi berpresisi tinggi mengikuti retensi yang lebih pendek daripada metadata laporan bila sesuai kebijakan.
- Transactional outbox menjaga perubahan database dan event integrasi/realtime tetap konsisten saat proses restart.
- Socket.IO atau transport realtime hanya untuk pembaruan UI; database tetap snapshot otoritatif. Integrasi eksternal berjalan melalui adapter yang memiliki retry, idempotency, acknowledgement, dead-letter/review queue, dan dashboard kegagalan.
- Unit/responder bersifat data operasional dengan wilayah, status ketersediaan, roster, kontak/kanal, dan riwayat assignment; tidak ada lagi konstanta Unit 01–03 sebagai unit operasional.

### Identitas dan keamanan

- Ganti akun bersama dengan identitas per petugas dan peran minimal (RBAC), MFA, kebijakan sesi, pemulihan, dan proses pencabutan akun.
- OIDC dengan identity provider organisasi menjadi opsi awal bila operator telah memilikinya; alternatif identity provider mandiri memerlukan evaluasi biaya dan on-call. Pilihan belum final.
- Pisahkan akses warga berbasis token insiden dari akses petugas; simpan hash/token digest dengan rotasi atau pencabutan yang dapat diaudit.
- Terapkan HTTPS, proteksi CSRF untuk sesi browser, rate limit dan proteksi penyalahgunaan SOS, validasi payload, security headers, secret manager, patching, backup terenkripsi, dan kontrol akses least privilege.
- Terapkan log terstruktur dengan redaksi token, kata sandi, dan koordinat presisi. Kebijakan siapa dapat mengakses audit perlu ditetapkan.

### Operasi dan deployment

- Pisahkan development, staging, dan production dengan data/secret berbeda; staging memakai data sintetis.
- Produksi memerlukan TLS tepercaya, database backup dan uji restore, pemeriksaan kesehatan, alerting, monitoring aplikasi dan integrasi, prosedur rollback, incident response, serta petugas operasional yang ditetapkan.
- Tetapkan target uptime, waktu tanggap dukungan, RPO/RTO, dan jam operasi bersama operator sebelum memilih deployment.
- Ketersediaan tile peta bukan dependency untuk melihat atau menangani laporan. Pilih penyedia basemap dan alamat geocoding setelah wilayah, kebutuhan privasi, lisensi, dan SLA diketahui.
- Hosting, SMS, email, push provider, peta komersial, dan identity service berbayar perlu keputusan biaya sebelum dipilih.

## 5. Alur insiden yang diusulkan

```text
Dikirim warga
  -> diterima server (nomor laporan; belum berarti diterima operator)
  -> masuk antrian operator
  -> diakui dispatcher
  -> triase manusia sesuai SOP
  -> ditugaskan ke responder / kanal resmi (acknowledgement tercatat)
  -> responder memberi pembaruan
  -> selesai atau dirujuk sesuai prosedur
```

Setiap tahap mencatat aktor, waktu, dan hasil. Laporan yang tidak diakui sebelum batas yang nanti ditetapkan harus masuk jalur eskalasi operator. Jika jalur ini tidak tersedia, warga menerima pesan kegagalan yang jujur serta tautan/nomor bantuan resmi yang sesuai wilayah.

**Pencabutan oleh warga:** segera hentikan update lokasi baru, simpan permintaan pembatalan sebagai event, dan tampilkan bahwa lokasi tidak lagi diperbarui. Jika telah diakui atau diteruskan, operator harus melihat dan menanganinya sesuai SOP; status operasi berubah setelah keputusan tercatat. Lokasi terakhir tetap tunduk pada retensi dan authorization yang disetujui.

## 6. Tahapan menuju rilis

### Tahap A — keputusan produk dan operasi

Tentukan wilayah, pemilik layanan, operator, jam jaga, SOP, responder, kontak bantuan resmi, target layanan, retensi, kanal notifikasi, dan anggaran. Review hukum/privasi serta threat model bersama pihak berwenang.

### Tahap B — fondasi platform

Implementasikan database permanen dan migrasi, auth petugas individual dan peran, audit, outbox/realtime tahan restart, konfigurasi wilayah, pengelolaan roster/responder, dashboard antrean, pemulihan warga, dan alerting internal. Lingkungan staging tetap tertutup dan berlabel staging.

### Tahap C — pilot terkendali

Jalankan pilot hanya setelah ada pemilik operator/responder, SOP dan jalur fallback, persetujuan yang diperlukan, dukungan saat jam layanan, instruksi warga yang akurat, backup/restore, serta uji keamanan dan latihan insiden. Mulai dengan peserta dan wilayah yang disetujui; ukur hasil sebelum perluasan.

### Tahap D — operasi umum

Perluasan memerlukan hasil pilot, kesiapan dukungan, kapasitas, reliabilitas, legal/privacy sign-off, dan integrasi resmi terverifikasi. Hanya setelah checklist pemilik layanan disetujui, label demo dapat diganti dengan informasi layanan nyata.

## 7. Kriteria penerimaan sebelum penggunaan nyata

- Laporan dan audit bertahan restart dan database failover sesuai target yang dipilih; backup berhasil dipulihkan pada latihan.
- Hak warga, dispatcher, supervisor, administrator, dan auditor diuji terhadap akses yang diizinkan dan ditolak.
- Token insiden tidak muncul pada URL query, log, analitik, error trace, atau referer; token invalid tidak membuka detail.
- Keadaan jaringan putus, reconnect, duplikasi submit, penyimpanan gagal, map tiles gagal, GPS ditolak, dan GPS basi tampil jelas serta memiliki perilaku yang disetujui.
- Semua klaim “diterima/ditugaskan/bantuan dikirim” bersandar pada aksi atau acknowledgement yang tercatat.
- Laporan yang tidak diakui, sistem yang tak tersedia, dan kegagalan kanal responder menghasilkan eskalasi serta fallback yang ditetapkan operator.
- Uji beban, threat model, pentest/penilaian keamanan, uji restore, latihan operator, dan review privasi/lokal selesai sesuai standar organisasi.
- Pemilik layanan, operator on-call, jam operasi, target reliabilitas, prosedur insiden, dan kontak fallback sudah tercantum dan diverifikasi.

## 8. Keputusan untuk tinjauan pengguna

1. Apakah target sementara **platform siap produksi dengan dispatcher manusia dan dispatch resmi menyusul** benar?
2. Negara/kota/wilayah awal apa yang dituju, dan organisasi siapa yang akan menjadi operator?
3. Apakah ada jam layanan yang direncanakan, atau targetnya 24/7?
4. Apakah pelaporan warga tetap tanpa akun? Jika ya, apakah akses status cukup dengan token rahasia yang disimpan warga, atau perlu kanal pemulihan seperti SMS (dengan konsekuensi biaya/data pribadi)?
5. Database, hosting, identity provider, basemap/geocoding, dan notifikasi mana yang sudah disediakan organisasi? Jika belum, keputusan berbayar akan ditunda sampai opsi dan biaya ditinjau.
6. Berapa lama data laporan dan koordinat rinci boleh disimpan, siapa berwenang mengaksesnya, dan siapa yang menyetujui kebijakan tersebut?

## 9. Status setelah persetujuan

Setelah pengguna meninjau dan menyetujui arah rancangan, tahap berikutnya adalah menulis rencana implementasi rinci per deliverable dan acceptance test, termasuk migrasi dari demo. Implementasi belum dimulai dari draft ini.
