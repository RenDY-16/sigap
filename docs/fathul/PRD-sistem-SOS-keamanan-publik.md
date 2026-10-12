# PRD — Prototipe Sistem SOS Keamanan Publik Berbasis Web

**Status:** Draf kebutuhan produk  
**Versi:** 1.1  
**Tanggal:** 2 Oktober 2026  
**Jenis produk:** Prototipe demonstrasi, bukan layanan tanggap darurat operasional

**Panduan visual dan interaksi:** [design.md](./design.md)
**Rencana implementasi teknis:** [implementation-plan.md](./implementation-plan.md)

## 1. Ringkasan

Prototipe web ini mendemonstrasikan alur laporan SOS keamanan dari warga ke dashboard petugas. Warga dapat mengirim laporan tanpa membuat akun atau memberikan kontak, membagikan lokasi saat SOS aktif, melihat perkembangan laporan, dan membatalkannya. Petugas demo dapat menerima laporan, memverifikasinya, menetapkan unit simulasi, dan memperbarui status.

Prototipe berjalan pada beberapa perangkat dalam satu jaringan lokal. Laporan hanya disimpan selama proses server berjalan. Sistem tidak terhubung ke pusat komando atau unit respons sungguhan, dan tidak boleh dipresentasikan sebagai layanan yang mengirim bantuan nyata.

## 2. Masalah dan peluang

Warga yang mengalami atau melihat insiden keamanan membutuhkan cara sederhana untuk menyampaikan kejadian dan lokasinya. Petugas membutuhkan tampilan terpusat agar dapat melihat laporan, status penanganan, dan posisi pelapor dalam satu alur.

Prototipe ini digunakan untuk memperagakan alur tersebut dan mengumpulkan masukan sebelum ada keputusan tentang wilayah, instansi, prosedur, atau kesiapan operasional.

## 3. Tujuan produk

- Memperlihatkan perjalanan laporan dari pengiriman SOS oleh warga hingga pembaruan status oleh petugas.
- Memperagakan berbagi dan pembaruan lokasi hanya selama insiden aktif.
- Menunjukkan laporan warga dan pembaruan petugas secara langsung pada beberapa perangkat di satu LAN.
- Menjaga demo mudah dijalankan tanpa layanan hosting atau database permanen.

### Bukan tujuan

- Menangani keadaan darurat nyata atau menjamin respons petugas.
- Menggantikan nomor telepon atau kanal resmi layanan darurat.
- Mengintegrasikan laporan dengan sistem dispatch, kepolisian, pemerintah, atau instansi lain.
- Menyediakan identitas warga, riwayat laporan permanen, analitik operasional, atau pelacakan sebelum SOS.
- Menentukan wilayah deployment atau prosedur keamanan publik untuk wilayah tertentu.

## 4. Pengguna dan kebutuhan

### Warga/pelapor

Warga perlu dapat mengirim laporan tanpa proses login yang memperlambat alur, membagikan posisi ketika insiden aktif, mengetahui apakah laporan sedang ditangani, dan menghentikan pelacakan bila laporan dibatalkan.

### Petugas demo

Petugas perlu melihat laporan baru pada peta dan daftar, memverifikasi laporan, memilih unit respons simulasi, dan memperbarui status agar warga dapat melihat perkembangannya.

### Presenter/demo operator

Presenter perlu menjalankan satu server lokal yang dapat diakses oleh perangkat berbeda dalam jaringan yang sama, dengan data uji sementara dan instruksi akses yang jelas.

## 5. Ruang lingkup MVP

### Termasuk

- Halaman warga yang responsif untuk ponsel dan desktop.
- Kategori laporan untuk **insiden keamanan**.
- Form SOS dengan deskripsi insiden dan lokasi.
- Pengambilan lokasi melalui Geolocation browser setelah izin diberikan.
- Pembaruan lokasi hanya ketika SOS aktif, sampai insiden selesai atau dibatalkan.
- Fallback lokasi simulasi jika izin lokasi ditolak, lokasi tidak tersedia, atau perangkat demo tidak mendukung Geolocation. Lokasi simulasi harus diberi label dengan jelas.
- Nomor atau tautan insiden unik agar warga tanpa akun dapat membuka status dan membatalkan laporan miliknya.
- Halaman konfirmasi warga dengan status yang diperbarui langsung.
- Dashboard petugas yang memerlukan akun demo.
- Daftar dan peta insiden, verifikasi petugas, penetapan unit simulasi, serta perubahan status.
- Sinkronisasi laporan, lokasi, pembatalan, penugasan unit, dan status secara langsung.
- Penyimpanan sementara di memori server. Semua insiden hilang saat proses server dimulai ulang.
- Basemap jalan daring dengan penanda lokasi dan atribusi penyedia peta.
- Penanda yang mudah terlihat bahwa aplikasi adalah prototipe dan tidak mengirim bantuan nyata.

### Tidak termasuk

- Akun atau kontak warga.
- Chat, panggilan, foto, audio, atau lampiran.
- Notifikasi SMS, email, atau push.
- Penetapan tingkat keparahan otomatis atau rekomendasi AI.
- Pencatatan permanen, audit log, analitik, manajemen banyak instansi, atau multiwilayah.
- Sinkronisasi dengan sistem pusat komando sungguhan.
- Hosting publik atau operasi 24/7.

## 6. Alur utama

### Alur warga

1. Warga membuka halaman SOS dan melihat pemberitahuan bahwa aplikasi adalah prototipe demo.
2. Warga memilih/mengonfirmasi kategori insiden keamanan dan mengisi deskripsi.
3. Warga memilih mode lokasi GPS atau simulasi. Untuk mode simulasi, warga memilih titik sebelum mengirim.
4. Setelah warga menekan kirim dan server mengonfirmasi laporan aktif, browser meminta izin lokasi bila mode GPS dipilih. Lokasi GPS tidak diambil sebelum laporan aktif.
5. Jika izin/lokasi GPS tidak tersedia, laporan tetap terlihat dengan status lokasi belum tersedia; warga dapat memilih titik simulasi pada halaman status.
6. Warga menerima tautan atau nomor insiden unik; halaman status menampilkan status terkini dan perubahan petugas secara langsung.
7. Warga dapat membatalkan laporan. Pelacakan berhenti, laporan ditandai dibatalkan, dan dashboard petugas diperbarui.

### Alur petugas

1. Petugas masuk melalui akun demo.
2. Dashboard menampilkan laporan baru pada daftar dan peta.
3. Petugas memverifikasi laporan.
4. Petugas menetapkan unit respons simulasi dan menandai unit telah ditugaskan.
5. Petugas menyelesaikan laporan; status terbaru terlihat oleh warga.
6. Laporan yang dibatalkan warga terlihat sebagai dibatalkan dan tidak lagi mengirim pembaruan lokasi.

## 7. Persyaratan fungsional

| ID | Persyaratan | Prioritas |
|---|---|---|
| FR-01 | Warga dapat membuka dan mengirim SOS tanpa login dan tanpa memasukkan nama atau kontak. | MVP |
| FR-02 | Laporan memuat kategori keamanan, deskripsi insiden, dan status lokasi: menunggu GPS, GPS, atau simulasi. Koordinat boleh belum tersedia saat laporan pertama dibuat. | MVP |
| FR-03 | Aplikasi meminta izin lokasi browser secara eksplisit hanya setelah server mengonfirmasi SOS aktif; tidak ada koordinat yang diambil sebelum itu. | MVP |
| FR-04 | Selama SOS aktif, perubahan lokasi dikirim ke server dan diteruskan ke dashboard petugas. | MVP |
| FR-05 | Jika Geolocation gagal, aplikasi menjelaskan kegagalan dan menyediakan pemilihan titik simulasi berlabel, termasuk dari halaman status laporan aktif; titik simulasi tidak boleh tampil sebagai lokasi nyata. | MVP |
| FR-06 | Setelah laporan dibuat, warga memperoleh tautan/nomor unik dan dapat melihat status laporan tersebut. | MVP |
| FR-07 | Warga dapat membatalkan laporannya; pembatalan menghentikan pembaruan lokasi dan terlihat oleh petugas. | MVP |
| FR-08 | Dashboard petugas memerlukan login akun demo yang telah disediakan untuk presentasi. | MVP |
| FR-09 | Petugas dapat melihat laporan baru, memverifikasi laporan, menetapkan unit simulasi, dan mengubah status. | MVP |
| FR-10 | Perubahan laporan, lokasi, pembatalan, penugasan unit, dan status tersinkron langsung ke klien yang terkait. | MVP |
| FR-11 | Semua data insiden bersifat sementara dan hilang ketika server berhenti atau dimulai ulang. | MVP |
| FR-12 | Peta menunjukkan lokasi, status, serta penanda sumber lokasi, dengan atribusi basemap yang terlihat. | MVP |

### Status laporan

- **Baru** — laporan baru diterima.
- **Diverifikasi** — petugas sudah memeriksa laporan.
- **Unit ditugaskan** — petugas sudah memilih unit simulasi.
- **Selesai** — petugas menutup penanganan simulasi.
- **Dibatalkan** — warga membatalkan laporan; status terminal.

## 8. Persyaratan nonfungsional

- **Perangkat:** halaman warga dan dashboard harus dapat digunakan di browser ponsel maupun desktop modern.
- **Arah visual terpilih:** gunakan gaya terang-editorial seperti halaman product showcase premium: latar putih hangat, tipografi gelap berukuran besar, navigasi minimal, ruang lega, dan satu objek 3D utama berupa miniatur peta kota dengan pin/beacon lokasi dari kaca. Gunakan aksen biru/ungu pada jalur lokasi dan merah hanya untuk aksi SOS. Ini menjadi arah visual produk yang dikonfirmasi; nama “SIGAP” pada mockup masih placeholder dan belum menjadi keputusan branding.
- **Motion dan scroll animation:** jadikan halaman pengantar sebagai scroll journey dengan camera movement yang membawa pengguna mendekati dan mengitari miniatur peta, lalu menyingkap bab “Kenali — Laporkan — Pantau — Selesai”. Gunakan reveal bertahap untuk headline dan konten, perpindahan sudut pandang 3D yang halus, serta transisi singkat ketika laporan/status berubah. Animasi harus terasa ekspresif seperti website referensi, sambil menjaga hierarki dan akses ke aksi utama.
- **Batas motion pada alur darurat:** tombol SOS tidak boleh berdenyut atau bergerak sebelum tindakan warga; jangan menutupi form, status, koordinat, atau kontrol peta dengan animasi. Pada dashboard, perubahan status dan posisi marker boleh ditransisikan secara halus; hindari auto-pan yang menghilangkan konteks peta.
- **Preferensi reduced motion:** hormati `prefers-reduced-motion` dengan menghapus atau mengganti animasi non-esensial menjadi transisi sederhana, dan tampilkan konten scroll-reveal tanpa menunggu animasi. W3C menjelaskan bahwa animasi non-esensial yang dipicu interaksi dapat dinonaktifkan; media query ini adalah teknik yang disarankan. [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions) · [W3C technique C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
- **Jaringan:** semua perangkat demo terhubung ke server melalui satu LAN yang sama.
- **Lokasi:** Geolocation browser hanya dapat digunakan di *secure context* dan setelah izin eksplisit. Untuk akses melalui IP LAN, server demo perlu HTTPS dengan sertifikat yang dipercaya perangkat uji. Pengecualian browser untuk `localhost` tidak berlaku pada alamat IP LAN biasa. [Dokumentasi Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API) · [Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)
- **Peta:** basemap jalan memerlukan koneksi internet. Jika tile peta gagal, laporan dan koordinat tetap harus dapat dibaca. Bila menggunakan tile standar OpenStreetMap, tampilkan atribusi yang diwajibkan, hormati cache, dan jangan melakukan pengunduhan tile massal. Layanan tile publik memiliki kapasitas terbatas dan tidak menjamin SLA. [Kebijakan penggunaan tile OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/)
- **Privasi demo:** jangan meminta atau menyimpan data kontak. UI harus membedakan lokasi GPS dari lokasi simulasi. Jangan gunakan laporan demo untuk meminta bantuan nyata.
- **Ketahanan:** kegagalan izin lokasi, koneksi server, atau pemuatan tile harus ditampilkan dengan pesan yang jelas; peta bukan satu-satunya cara untuk melihat detail koordinat dan status.
- **Penyimpanan:** tidak ada database permanen; memulai ulang server menghapus data sesi.

## 9. Kriteria keberhasilan demo

Demo dinyatakan berhasil jika presenter dapat memperlihatkan seluruh hal berikut:

1. Warga mengirim satu SOS dari perangkat pertama.
2. Petugas melihat laporan itu di dashboard perangkat kedua tanpa memuat ulang halaman.
3. Lokasi nyata terlihat sebagai lokasi nyata, atau fallback terlihat jelas sebagai lokasi simulasi.
4. Perubahan status petugas muncul pada halaman status warga.
5. Pembaruan lokasi terlihat saat SOS aktif dan berhenti setelah laporan dibatalkan atau diselesaikan.
6. Petugas dapat menetapkan unit simulasi.
7. Login dashboard membatasi akses petugas; warga tetap dapat membuat dan melihat laporan melalui tautan uniknya.
8. Presenter dapat menjelaskan bahwa server restart menghapus data demo dan sistem tidak memanggil atau mengirim laporan ke layanan darurat sungguhan.

## 10. Risiko dan mitigasi

| Risiko | Mitigasi produk |
|---|---|
| Pengguna mengira prototipe mengirim bantuan sungguhan. | Tampilkan label prototipe yang terlihat pada halaman warga dan dashboard; jangan tampilkan klaim bahwa unit nyata sedang menuju lokasi. |
| Browser menolak izin lokasi atau perangkat tidak mendapatkan fix GPS. | Berikan penjelasan, opsi titik simulasi yang dilabeli, dan tampilan koordinat/status meski peta gagal. |
| HTTPS LAN tidak dipercaya atau sulit dipasang pada perangkat presentasi. | Dokumentasikan persiapan sertifikat dan uji perangkat demo sebelum presentasi; sediakan titik simulasi untuk demo alur tanpa GPS. |
| Internet atau penyedia tile peta tidak tersedia. | Tampilkan laporan dan koordinat tanpa basemap; jelaskan bahwa basemap membutuhkan internet. |
| Tautan insiden dibagikan dan orang lain melihat/membatalkan laporan. | Gunakan nilai akses unik yang sulit ditebak dan batasi akses warga pada insiden yang cocok dengan tautan tersebut. Ini hanya mitigasi prototipe, bukan klaim keamanan produksi. |

## 11. Asumsi dan keputusan tertunda

### Sudah diputuskan

- Ini prototipe demo untuk konsep layanan publik dengan penerima laporan berupa dashboard pusat komando simulasi.
- Kategori MVP hanya insiden keamanan.
- Wilayah target belum ditentukan.
- Demo berjalan di beberapa perangkat dalam satu LAN.
- Warga tanpa login dan tanpa kontak; petugas memakai akun demo.
- Gunakan Geolocation browser nyata selama SOS aktif dengan fallback simulasi yang jelas.
- Warga dapat melihat status dan membatalkan laporan langsung.
- Petugas memverifikasi laporan, menetapkan unit simulasi, dan memperbarui status.
- Data hanya selama sesi server.
- Peta menggunakan basemap jalan daring; internet diperlukan untuk tile.
- Arah visual halaman pengantar dipilih: terang-editorial dengan hero peta 3D dan scroll journey sinematik.
- Tidak ada integrasi dispatch resmi atau penggunaan operasional.

### Belum ditentukan

- Nama/branding produk.
- Wilayah yang akan ditampilkan pada data simulasi.
- Detail copywriting/form untuk deskripsi kejadian.
- Daftar nama dan jumlah unit simulasi.
- Kriteria pengujian lintas browser/perangkat untuk sesi demo.

## 12. Tahap setelah PRD

Tinjau PRD, `design.md`, dan [implementation-plan.md](./implementation-plan.md) sebelum implementasi. Rencana teknis menetapkan stack, autentikasi demo, sertifikat HTTPS lokal, peta, serta mekanisme sinkronisasi. Implementasi baru dimulai setelah ketiga dokumen disepakati.
