# Verifikasi realtime dan GPS protocol

Tanggal: 12 Oktober 2026. Status: 20 kelompok pemeriksaan Socket.IO native dan PostgreSQL sintetis berhasil. Ini bukan bukti browser, GPS perangkat, integrasi responder, crash durability atau kesiapan produksi.

## Menjalankan pemeriksaan

Dari frontend:

```sh
npm run test:realtime
```

Script membuat database unik sigap_socket_ pada PostgreSQL development lokal, menerapkan migrasi, membuat akun/laporan sintetis, dan menjalankan HTTP/Engine.IO/Socket.IO pada port loopback sementara. Semua password/token dibuat acak di memori. Database test dibersihkan pada finally; akun dan data staging pengguna tidak dipakai. SIGAP_VERIFY_DATABASE_URL dapat menunjuk PostgreSQL development lain dengan izin membuat database; jangan memakai server produksi.

Test memakai pool berukuran satu, server dan publisher sebenarnya, serta klien native Socket.IO dengan transport WebSocket dan polling. Background poll timer publisher tidak dinyalakan; test memanggil publishPending agar tiap percobaan dapat diperiksa secara deterministik.

## Kelompok pemeriksaan yang berhasil

1. unauthenticated, wrong token, cross-origin and query-token handshakes rejected.
2. websocket/polling citizen snapshots scoped to authenticated report.
3. failed publisher persists bounded backoff metadata without marking delivery.
4. pending outbox recovered by publisher; pool size one delivers without deadlock.
5. replay preserves event ID; frontend dedup helper rejects duplicate ID.
6. GPS acknowledgement follows persisted update; authorized clients receive outbox event.
7. invalid/future/stale GPS and staff GPS attempts rejected.
8. client-supplied report ID cannot redirect GPS to another citizen.
9. audit SQL failure rolls event attempt back, prevents partial citizen emit, then retries.
10. per-delivery revalidation disconnects account invalidated outside local revoke callback.
11. admin account disable immediately disconnects staff socket.
12. open citizen socket cannot update GPS after committed withdrawal.
13. reconnect snapshot restores stopped tracking state.
14. revoke-all-sessions disconnects account socket and blocks stale-cookie reconnect.
15. password reset revokes old socket/cookie/password; new credentials reconnect.
16. logout disconnects socket and revoked cookie cannot reconnect.
17. observed deliveries preserve region/citizen isolation and private projection redaction.
18. expired session is disconnected before the next delivery and cannot reconnect.
19. realtime delivery audit metadata excludes coordinates, token and message content.
20. shutdown gates reject socket/HTTP mutations while committed state remains readable.

Hasil lokal: exports/probes/realtime-result.json. Fault injection hanya dilakukan pada database test: publisher callback gagal, trigger audit sengaja gagal, dan expiry/active akun diubah untuk memeriksa revalidasi. Tidak ada fault injection pada staging pengguna.

## Batas bukti

- Packet receipt dibuktikan pada klien native yang diuji; bukan browser, render React, notifikasi perangkat atau pembacaan manusia.
- Replay disimulasikan dengan membuat kembali event yang sama sebagai pending, lalu ID event dan helper dedup frontend diperiksa. Tidak ada simulasi process crash atau jaminan exactly-once.
- Published-at pada outbox berarti publisher menerima percobaan emit; tidak berarti setiap pengguna menerima/membaca event. Reconnect memakai snapshot sebagai sumber state terbaru.
- Window observasi isolasi mengikuti durasi test. Fixture region lain dibentuk langsung dalam database sintetis untuk memeriksa penolakan delivery local-staging; bukan bukti multi-region produksi lengkap.
- GPS points sintetis dikirim oleh client native; izin Geolocation, trust HTTPS di ponsel dan lokasi fisik tidak diperiksa.
- Session expiry diperiksa saat delivery/reconnect. Test tidak menyatakan idle socket diputus tepat pada detik expiry.
- Shutdown gates diperiksa untuk menolak mutasi baru dan tetap membaca state tersimpan; drain semua operasi in-flight, batas waktu shutdown, crash/restore dan RTO belum diperiksa.
- Backoff failure tersimpan dan defer scheduling diperiksa. Delay publisher saat ini dicap 60 detik, tetapi jumlah retry belum dicap dan dead-letter/manual review belum tersedia.

## Pekerjaan berikutnya

Tambahkan cap retry/dead-letter dan review operator untuk outbox realtime, kemudian verifikasi failure/recovery serta observability. Dispatch intent/provider queue tetap subsystem terpisah yang belum ada. Privacy lifecycle, intake abuse controls, browser/device verification, deployment dan persetujuan pilot tetap terbuka.
