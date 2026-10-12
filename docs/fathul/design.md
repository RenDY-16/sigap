# Design — Sistem SOS Keamanan Publik

**Status:** Draf desain produk  
**Tanggal:** 2 Oktober 2026  
**Dokumen kebutuhan:** [PRD Sistem SOS Keamanan Publik](./PRD-sistem-SOS-keamanan-publik.md)

Dokumen ini menerjemahkan arah visual yang dipilih ke panduan layar, komponen, dan motion untuk prototipe. Ini adalah acuan desain, belum merupakan keputusan implementasi teknis.

## 1. Ringkasan arah desain

Prototipe memakai gaya **terang-editorial**: latar putih hangat, headline gelap berukuran besar, navigasi ringkas, dan ruang lega. Objek visual utama adalah miniatur kota 3D dengan rute beraksen biru-ungu dan beacon lokasi transparan seperti kaca. Merah dipakai khusus untuk aksi SOS.

Halaman pengantar bergerak seperti perjalanan sinematik melalui empat bab: **Kenali — Laporkan — Pantau — Selesai**. Setelah pengguna memulai laporan, pengalaman berpindah ke layar yang tenang dan fungsional; form, status, lokasi, dan tindakan penting tidak bergantung pada animasi scroll.

### Keputusan yang dikonfirmasi

- Arah visual terang-editorial mengikuti gambar referensi yang dipilih pengguna.
- Hero menampilkan miniatur peta kota 3D dan beacon lokasi bergaya kaca.
- Scroll journey menggunakan bab “Kenali — Laporkan — Pantau — Selesai”.
- Aksen biru/ungu menunjukkan rute atau konteks lokasi; merah menandai aksi SOS.
- Produk adalah prototipe demo. UI harus menyatakan bahwa laporan tidak dikirim ke layanan atau petugas sungguhan.
- “SIGAP” pada gambar hanyalah placeholder. Nama dan branding produk belum diputuskan.

### Usulan desain dalam dokumen ini

- Tata letak, tipografi, warna status, dan komposisi dashboard di bawah adalah rekomendasi awal agar desain bisa diterapkan secara konsisten.
- Detail form, dashboard, dan sistem komponen belum dikonfirmasi lewat mockup tersendiri.
- Nilai token warna dan motion bersifat titik awal; sesuaikan saat desain visual final tersedia.

## 2. Prinsip desain

1. **Tenang dan tepercaya.** Hindari tampilan yang terasa seperti sirene, pusat komando sungguhan, atau layanan resmi.
2. **Aksi mudah ditemukan.** Tombol SOS, pembatalan, status, dan sumber lokasi tetap terlihat tanpa harus menyelesaikan animasi.
3. **Simulasi selalu jelas.** Bedakan GPS dan titik simulasi dengan teks serta ikon/penanda, bukan warna saja.
4. **Informasi tidak bergantung pada peta.** Koordinat, status, dan deskripsi laporan masih dapat dibaca ketika tile peta gagal.
5. **Gerak punya tujuan.** Gunakan motion untuk memperkenalkan konteks atau menjelaskan perubahan keadaan, bukan untuk menghias setiap elemen.

## 3. Bahasa visual

### Palet awal

Palet berikut diturunkan dari referensi dan kebutuhan status. Nilainya rekomendasi awal, bukan token brand final.

| Token | Nilai awal | Penggunaan |
|---|---|---|
| `canvas` | `#F7F6F2` | Latar utama putih hangat |
| `surface` | `#FFFFFF` | Form, panel, kartu, dan popover |
| `ink` | `#111214` | Headline dan teks utama |
| `muted` | `#62656D` | Deskripsi, label sekunder |
| `line` | `#E2E2E0` | Garis pemisah dan border tipis |
| `sos` | `#E6262D` | Tombol kirim SOS dan indikator aksi SOS |
| `route-blue` | `#4E85F5` | Jalur, titik posisi, dan tautan peta |
| `route-violet` | `#8177F5` | Aksen sekunder jalur dan motion peta |
| `status-new` | `#B7791F` | Status Baru; sertakan label teks |
| `status-verified` | `#3567B7` | Status Diverifikasi |
| `status-assigned` | `#6554A5` | Status Unit ditugaskan |
| `status-done` | `#3D755D` | Status Selesai |
| `status-cancelled` | `#737780` | Status Dibatalkan |

Status memakai warna yang lebih tenang daripada tombol SOS. Setiap status selalu menampilkan label teks dan tidak boleh dibedakan dengan warna saja.

### Tipografi

- **Display:** sans-serif modern dengan bentuk bersih dan bobot tebal untuk headline hero. Keluarga font final belum ditentukan.
- **Body/UI:** sans-serif yang sangat terbaca untuk form, koordinat, status, dan dashboard.
- Gunakan ukuran display yang responsif; hindari headline besar yang memaksa CTA atau peringatan demo keluar dari layar awal ponsel.
- Pakai angka tabular untuk koordinat, waktu, dan ID laporan agar mudah dipindai.

### Bentuk, bayangan, dan tekstur

- Permukaan utama datar dan bersih; gunakan sudut membulat moderat pada tombol, input, serta panel.
- Kedalaman visual terutama datang dari objek peta 3D dan beacon kaca, bukan tumpukan kartu dan shadow tebal.
- Gunakan garis peta dan grid sangat halus sebagai latar pendukung. Pastikan kontras konten tetap lebih kuat daripada dekorasi.
- Gunakan aset 3D nyata untuk hero. Jangan menggantinya dengan ilustrasi CSS atau elemen dekoratif yang menyerupai peta fungsional.

## 4. Struktur halaman dan komposisi

### 4.1 Halaman pengantar warga

Halaman ini memperkenalkan konsep demo dan menjadi awal alur warga.

**Desktop**

- Header tipis: nama produk sementara di kiri; tautan “Alur SOS” dan “Dashboard” di kanan.
- Hero dua kolom: headline, deskripsi, CTA, dan disclaimer di kiri; miniatur kota 3D mengisi sisi kanan dan sebagian area tengah.
- Penanda perjalanan di bawah hero menunjukkan empat bab dan posisi scroll.
- CTA utama “Mulai simulasi SOS” berada dalam jangkauan tanpa harus scroll.

**Ponsel**

- Navigasi ringkas; tautan dashboard dapat dipindahkan ke menu sekunder bila ruang terbatas.
- Headline, keterangan demo, dan CTA tampil sebelum ilustrasi besar.
- Peta 3D menjadi ilustrasi yang lebih pendek di bawah area aksi. Beri pilihan visual statis saat perangkat atau preferensi pengguna meminta motion minimal.
- Jangan mengecilkan tombol utama atau peringatan demo demi mempertahankan komposisi desktop.

### 4.2 Scroll journey

1. **Kenali:** headline dan miniatur kota tampil utuh; beacon menandai titik perhatian.
2. **Laporkan:** kamera mendekati area kota dan menjelaskan proses pengisian laporan.
3. **Pantau:** rute dan status laporan menjadi fokus; sorot bahwa lokasi dibagikan hanya saat SOS aktif.
4. **Selesai:** perjalanan visual mereda dan menjelaskan bahwa laporan dapat dibatalkan atau ditutup dalam simulasi.

Bab dapat menggunakan perubahan sudut kamera, kedalaman, dan reveal teks. Jangan menyembunyikan paragraf penting sampai pengguna menggulir dengan kecepatan tertentu. Penanda bab berfungsi sebagai progres, bukan satu-satunya navigasi.

### 4.3 Form laporan

Tampilan ini memprioritaskan penyelesaian tugas dan tetap stabil, tanpa camera scroll.

- Ringkas judul menjadi “Buat laporan simulasi”.
- Tampilkan label prototipe/demo di area yang mudah terlihat.
- Sediakan pilihan/konfirmasi kategori keamanan, deskripsi kejadian, pilihan mode GPS atau simulasi, serta aksi kembali dan kirim.
- CTA landing hanya membuka form. Setelah submit dikonfirmasi server, laporan menjadi aktif; baru kemudian browser meminta izin GPS bila mode GPS dipilih.
- Untuk mode simulasi, warga menentukan titik pada peta sebelum submit. Jika GPS gagal setelah laporan aktif, halaman status menawarkan peta untuk memilih titik simulasi.
- Sebelum submit, ringkas deskripsi dan mode lokasi agar pengguna paham apa yang akan dibagikan. Saat GPS masih mencari lokasi, tampilkan “Lokasi GPS belum tersedia” pada halaman status dan dashboard.

### 4.4 Status laporan warga

- Tampilkan nomor/tautan insiden, status terkini, deskripsi, sumber lokasi atau status “GPS belum tersedia”, dan peta bila basemap tersedia.
- Susun progres status sebagai urutan yang dapat dibaca: Baru → Diverifikasi → Unit ditugaskan → Selesai.
- Status Dibatalkan tampil sebagai keadaan akhir yang jelas; kontrol berbagi lokasi tidak lagi aktif.
- Jika warga membuka kembali laporan aktif dengan mode GPS setelah watch berhenti, tampilkan aksi “Lanjutkan berbagi lokasi” sebelum meminta browser melanjutkan tracking. Laporan mode simulasi tidak menjalankan watch GPS.
- Jika warga beralih dari GPS ke titik simulasi, hentikan tracking GPS sebelum titik simulasi dikirim.
- Sediakan tombol pembatalan yang terpisah dari aksi navigasi. Jika aksi ini dipilih, minta konfirmasi singkat yang menyebut bahwa pembatalan menghentikan pembaruan lokasi.
- Beri status koneksi/sinkronisasi. Jika koneksi putus, jangan menyiratkan bahwa laporan atau lokasi sedang terkirim.

### 4.5 Dashboard petugas demo

Dashboard adalah rekomendasi turunan dari arah terang-editorial; referensi visual yang dipilih belum menunjukkan layar dashboard.

- Gunakan permukaan terang yang sama dengan PRD agar terasa satu produk.
- Komposisi desktop: header dengan label “Dashboard demo”, ringkasan jumlah laporan simulasi, daftar laporan di satu sisi, dan peta utama di sisi lain.
- Memilih laporan membuka detail pada panel yang tidak menutupi seluruh peta.
- Detail memuat status, waktu pembaruan, deskripsi, koordinat, sumber lokasi, dan kontrol verifikasi/penugasan/perubahan status.
- Marker baru harus mudah dibedakan. Marker GPS dan simulasi memakai ikon atau teks sumber yang berbeda.
- Hindari auto-pan yang memindahkan konteks pengguna. Sediakan kontrol “Pusatkan ke laporan” secara eksplisit.
- Pada layar sempit, daftar dan peta dapat berganti tab; tampilkan jumlah laporan baru dan status koneksi di kedua tab.

## 5. Komponen utama

| Komponen | Gaya dan perilaku |
|---|---|
| Tombol SOS | Merah solid, kontras tinggi, label langsung; tidak berkedip atau berdenyut sebelum interaksi. Tampilkan loading hanya setelah pengiriman dimulai. |
| Tombol sekunder | Latar terang dengan border halus atau gaya teks; jangan memberi warna SOS pada aksi biasa. |
| Demo notice | Banner atau label tetap dengan copy eksplisit “Prototipe demo — tidak mengirim bantuan nyata”. Jangan hanya memakai tooltip. |
| Location source | Label “GPS perangkat” atau “Lokasi simulasi” di dekat koordinat dan marker; selalu tampilkan kata-katanya. |
| Status badge | Label pendek dan ikon sederhana; warna status sesuai tabel palet dan tidak memakai merah untuk status rutin. |
| Incident timeline | Urutan status, waktu, dan aktor (warga/petugas demo); update terbaru dapat disorot singkat tanpa menggeser layout. |
| Map marker | Simbol titik/pin yang berbeda untuk lokasi GPS dan simulasi; sertakan teks alternatif/label di daftar laporan. |
| Empty/error state | Jelaskan apa yang gagal dan tindakan berikutnya; jangan menyalahkan pengguna atau menghilangkan koordinat yang masih tersedia. |

## 6. Motion dan scroll animation

### Gerak halaman pengantar

- Gunakan scroll sebagai pengendali perubahan scene dan gerakan kamera yang berkelanjutan, dengan easing lembut dan tanpa hentakan.
- Reveal judul dan keterangan secara bertahap; batasi stagger agar konten cepat terbaca.
- Gerakkan rute cahaya pada peta secara singkat saat bab Pantau diperkenalkan. Jangan membuatnya tampak sebagai kendaraan/unit sungguhan.
- Gunakan perpindahan scene yang berakhir pada posisi stabil. Beri pengguna kontrol scroll browser normal dan izinkan melewati animasi.

### Gerak pada alur laporan dan dashboard

- Gunakan transisi singkat untuk membuka/mengirim form, memperbarui status, dan memindahkan marker.
- Hindari parallax, camera takeover, countdown animasi, atau efek yang menunda submit, pembatalan, maupun pembacaan status.
- Jangan menggerakkan tombol SOS saat idle. Animasi loading hanya menunjukkan bahwa aksi sedang diproses dan harus punya batas waktu/keadaan gagal.
- Ketika marker berpindah, jaga skala dan pusat peta kecuali pengguna memilih “Pusatkan ke laporan”.

### Reduced motion

Hormati `prefers-reduced-motion`. Hilangkan camera travel, parallax, gerak rute dekoratif, dan reveal berbasis scroll; tampilkan semua konten langsung dengan transisi sederhana atau tanpa transisi. Alur laporan tetap lengkap tanpa animasi.

## 7. Konten dan microcopy

- Gunakan bahasa Indonesia yang langsung, pendek, dan menjelaskan hasil tindakan.
- Hindari istilah yang menyiratkan petugas sungguhan, respons dijamin, atau laporan sudah diterima instansi resmi.
- Selalu sebut “simulasi” ketika menjelaskan unit atau tindakan petugas demo.
- Copy peringatan utama: **“Prototipe demo — laporan tidak dikirim ke layanan darurat.”**
- Copy saat lokasi simulasi dipakai: **“Lokasi simulasi — bukan posisi GPS perangkat.”**
- Copy izin lokasi menjelaskan alasan permintaan dan kapan pembaruan berhenti.
- Jangan mencantumkan nomor hotline tertentu sebelum wilayah target dan sumber resminya dipastikan.

## 8. Aksesibilitas dan penggunaan perangkat

- Semua kontrol utama dapat dicapai dan digunakan dengan keyboard; fokus keyboard terlihat jelas.
- Sediakan label yang terbaca untuk input, tombol ikon, marker, status koneksi, dan kontrol peta.
- Pastikan teks dan kontrol memiliki kontras yang memadai pada latar hangat.
- Gunakan ukuran target sentuh yang nyaman pada ponsel dan jangan menaruh aksi batal terlalu dekat dengan kirim.
- Perubahan status yang penting perlu dapat diumumkan ke teknologi bantu tanpa memindahkan fokus secara otomatis.
- Informasi lokasi dan status tetap dapat diakses ketika animasi, basemap, atau koneksi realtime tidak tersedia.
- Hentikan pembaruan lokasi ketika insiden dibatalkan atau diselesaikan sesuai perilaku produk di PRD.

## 9. Perilaku pada keadaan khusus

| Keadaan | Presentasi UI |
|---|---|
| Belum memberi izin lokasi | Jelaskan fungsi izin dan sediakan langkah untuk mencoba lagi atau memilih lokasi simulasi. |
| Lokasi GPS tersedia | Tampilkan label “GPS perangkat” serta waktu pembaruan terakhir. |
| Lokasi simulasi aktif | Tampilkan label menonjol “Lokasi simulasi”; pertahankan label pada detail dan dashboard. |
| Tile peta gagal | Beri pesan ringkas; tetap tampilkan koordinat, sumber lokasi, alamat bila tersedia, dan status. |
| Server terputus | Tampilkan indikator terputus dan waktu sinkronisasi terakhir; jangan menunjukkan keberhasilan kirim/pembaruan palsu. |
| Laporan dibatalkan | Hentikan pembaruan lokasi dan tampilkan status terminal Dibatalkan. |
| Laporan selesai | Tampilkan status Selesai dan hentikan pembaruan lokasi. |
| Data demo hilang setelah server restart | Tampilkan state laporan tidak ditemukan beserta penjelasan bahwa data prototipe bersifat sementara. |

## 10. Batas scope visual

**Termasuk dalam desain:** halaman pengantar dan scroll journey, form SOS, status warga, serta dashboard petugas demo yang mendukung alur MVP dalam PRD.

**Belum diputuskan:** nama/identitas final, jenis huruf final, wilayah peta, detail copy kategori/deskripsi, visual final dashboard, serta detail unit simulasi.

**Tidak ditambahkan:** fitur di luar PRD seperti chat, unggah media, notifikasi, analitik, dispatch nyata, atau pelacakan sebelum SOS.

## 11. Kriteria review desain

Desain siap menjadi dasar rencana implementasi ketika:

1. Arah visual halaman pengantar jelas mengikuti referensi yang dipilih.
2. Tombol SOS, disclaimer demo, status, serta label GPS/simulasi mudah dikenali pada desktop dan ponsel.
3. Alur warga dari mulai laporan sampai pembatalan/selesai dapat dipahami tanpa bergantung pada scroll animation.
4. Dashboard petugas menampilkan laporan, peta, status, dan kontrol perubahan tanpa kehilangan konteks.
5. Semua animasi non-esensial memiliki alternatif reduced-motion.
6. Kegagalan GPS, tile, atau koneksi tidak menyembunyikan informasi penting atau memberi kesan sukses palsu.

## 12. Langkah berikutnya

Dokumen ini menjadi acuan implementasi bersama [PRD](./PRD-sistem-SOS-keamanan-publik.md) dan [implementation-plan.md](./implementation-plan.md). Implementasi lokal di [frontend/](../../frontend/) kini mencakup landing, scroll journey, alur warga, dashboard petugas, API Express, sesi demo server, dan sinkronisasi status Socket.IO. Data tetap sementara di memori server dan konfigurasi HTTPS LAN tepercaya belum disiapkan. Referensi visual terpilih menggambarkan landing; dashboard memakai susunan operasional yang lebih padat dengan bahasa visual SIGAP yang sama. Aset kota Blender/GLB yang editable tetap menjadi pekerjaan lanjutan.


## Revisi visual 13 Oktober 2026

Arahan terbaru: campuran magazine UI dan minimalism UI untuk semua halaman. Canvas putih terang #FFFFFF; hitam untuk tipografi, abu-abu netral untuk garis, merah untuk aksi utama. Hierarki editorial melalui judul, label bagian, kolom, dan garis pemisah; kontrol tetap ringkas. Judul halaman tugas memakai kalimat literal seperti “Buat laporan” dan “Akses petugas”. Arahan ini menggantikan canvas warm-white sebelumnya.

### Aset sesuai topik

| Halaman | Aset | Makna |
| --- | --- | --- |
| Landing | city-safety-hero.png / scene kota 3D yang ada | Identitas SIGAP dan konteks kota |
| Dashboard | dashboard-city-editorial.png | Gambaran wilayah laporan |
| Laporan baru | report-editorial.png | Dokumen kejadian dan pensil |
| Pelacakan/status | tracking-editorial.png | Pin lokasi dan rute |
| Login staff | access-editorial.png | Akses yang memerlukan otorisasi |

Aset PNG dekoratif; tidak mewakili koordinat atau status laporan sebenarnya. Pelaporan di HP memakai ilustrasi kecil agar field tetap segera terlihat. Halaman audit, monitoring, akses staff dan konfigurasi memakai struktur teks, angka, serta ikon yang sesuai fungsi, tanpa mengulang gambar kota.
