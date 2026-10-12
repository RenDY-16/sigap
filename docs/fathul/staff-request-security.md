# Perlindungan request staf

Tanggal: 12 Oktober 2026. Status: sebagian kontrol keamanan diimplementasikan; bukan audit keamanan menyeluruh atau kesiapan produksi.

## Implementasi

- Frontend mengirim `X-SIGAP-Request: staff` pada mutasi API staf. Tidak ada secret tambahan disimpan di browser.
- Express menolak mutasi tanpa header itu sebelum parser body dan session middleware. Origin yang disertakan harus sama dengan protokol koneksi dan Host; null, path, multiple origin dan origin berbeda ditolak.
- Sec-Fetch-Site yang disertakan harus same-origin; cross-site, same-site dan none ditolak pada mutasi. Client native boleh tidak menyertakan metadata browser, tetapi wajib header aplikasi untuk mutasi dan tetap melewati pemeriksaan auth normal.
- Engine.IO memeriksa Origin/Fetch Metadata sebelum middleware sesi pada handshake dan request transport. Tidak ada CORS yang diaktifkan.
- API staf diberi Cache-Control no-store. Respons Express diberi X-Content-Type-Options nosniff.
- Pemeriksaan tidak mempercayai X-Forwarded-Host/Proto. TLS termination pada proxy belum didukung; perlu konfigurasi trusted origin/proxy yang dibatasi sebelum deployment seperti itu.

## Bukti terisolasi

Probe memakai createApplication dan attachSocketServer yang sebenarnya, HTTP loopback port sementara, serta pool database yang sengaja gagal. 13 skenario menghasilkan status sesuai harapan:

| Skenario | HTTP | Akses DB untuk request ditolak |
|---|---|---|
| Mutasi tanpa header aplikasi (sekaligus body malformed) | 403 | 0 |
| Origin asing | 403 | 0 |
| Origin null | 403 | 0 |
| Metadata same-site sibling | 403 | 0 |
| Metadata cross-site | 403 | 0 |
| Pemalsuan forwarded host/proto | 403 | 0 |
| Origin/header aplikasi sah, body login tidak lengkap | 400 dari validasi route | — |
| Client native/header aplikasi sah, body login tidak lengkap | 400 dari validasi route | — |
| Logout tanpa header | 403 | 0 |
| GET session tanpa cookie | 200 | — |
| Health | 200 | — |
| Handshake realtime origin asing | 400 dari Engine.IO | 0 |
| Handshake realtime origin yang sama | 200 | — |

Hasil lokal: exports/probes/staff-origin-check-result.json. Probe tidak menyimpan akun/password/token dan tidak menggunakan database warga. Hasil bukan bukti authenticated workflow, browser CORS/Fetch Metadata, HTTPS, proxy, persistence, socket revocation atau cross-region isolation.

## Sisa pekerjaan

Login throttling persisten, intake abuse controls, threat model/assessment, konfigurasi deployment proxy/TLS, validasi browser dan authenticated end-to-end, privacy lifecycle, dispatch/provider contract dan reliability tetap terbuka. Custom header bukan pengganti auth dan tidak mencegah XSS pada origin aplikasi. Jangan menambahkan credentialed CORS untuk origin lain tanpa mendesain ulang kontrol ini.
