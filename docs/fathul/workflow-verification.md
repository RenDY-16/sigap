# Verifikasi workflow warga–petugas

Tanggal: 12 Oktober 2026. Status: pemeriksaan HTTP dan PostgreSQL sintetis berhasil. Ini bukan bukti browser, delivery realtime, integrasi responder atau kesiapan layanan darurat.

## Cara menjalankan

Dari frontend, pada server PostgreSQL development lokal:

```sh
npm run test:incident-workflow
```

Test membuat database unik dengan prefix sigap_workflow_, menerapkan seluruh migrasi, membuat admin dan staf sintetis melalui bootstrap/API, serta menjalankan server HTTP loopback pada port sementara. Password dan token dibuat acak di memori; hasil tidak menampilkan nilainya. Database hanya milik test dihapus dalam finally. Akun/laporan staging pengguna tidak dipakai atau dimodifikasi. Variabel SIGAP_VERIFY_DATABASE_URL dapat menunjuk PostgreSQL development lain; diperlukan izin membuat database. Jangan menjalankan pada database server produksi.

## Bukti yang diperiksa

1. admin provisions individual accounts; login cookies usable.
2. anonymous staff API denied; public config excludes SOP/roster.
3. concurrent idempotent create returns one durable incident.
4. changed payload/credential retry rejected; unknown token cannot read.
5. admin/auditor cannot work incidents; dispatcher cannot administer accounts.
6. foreign-region session cannot list/read local incidents.
7. competing claims yield one owner and one conflict.
8. invalid transition, wrong owner and stale expected status rejected.
9. config update versioned; stale config rejected; required field enforced.
10. old incident keeps pinned SOP; assignment is versioned internal selection only.
11. supervisor takeover authorized and audited.
12. withdrawal retry stable; pending request stops location and blocks closure.
13. withdrawal denial does not restart tracking; resolved is terminal.
14. public report and durable outbox redact ownership, staff IDs, reasons and responder identity.
15. audit accessible to authorized role only.
16. release permits another operator to claim.
17. delivery failure escalates only via supervisor; busy responder rejected; referral terminal.
18. pending withdrawal filter and acceptance work; tracking remains stopped.
19. cursor pagination has no repeats; status and owner filters agree.
20. invalid pagination and age filters rejected.
21. last active operator admin cannot be disabled.
22. app and pool recreation preserve report, workflow and staff session.
23. disabling account invalidates existing HTTP session.

Bukti hasil lokal: exports/probes/incident-workflow-result.json. Test memakai Express routes, repository/transaksi PostgreSQL, session store, validators dan projection yang sebenarnya; tidak mengganti implementasi bisnis dengan mock. Counter login juga tetap aktif selama walkthrough.

Fixture cross-region memindahkan satu akun sintetis ke region sintetis lain lewat SQL dalam database test, karena provisioning aplikasi saat ini dibatasi local-staging. Ini memeriksa penolakan akses akun tersebut terhadap laporan local-staging; bukan bukti dukungan konfigurasi/multi-region produksi.

Assignment yang diperiksa adalah pilihan internal berdasarkan roster simulasi. Test secara eksplisit memeriksa externalDispatchAcknowledged false, SOP lama tetap dipatok ke config laporan, serta assignment memakai snapshot roster yang baru. Tidak ada pengiriman atau acknowledgment dari pihak luar.

## Batas dan pekerjaan berikutnya

- Belum ada walkthrough browser, interaksi form/status/dashboard pada perangkat, izin GPS, HTTPS atau proxy.
- Outbox payload di database telah diperiksa untuk redaksi; publisher, replay/delivery/socket authorization/revocation belum dibuktikan oleh test ini.
- Belum memeriksa seluruh error storage, rollback fault injection, backup/restore atau load/failure target produksi.
- Privacy lifecycle, intake anti-abuse, IdP/MFA, dispatch adapter resmi, observability/deployment dan persetujuan operator tetap terbuka.

Test login throttle tetap terpisah (11 pemeriksaan). Source TypeScript dan build lulus pada pemeriksaan tanggal ini; warning Vite bundle >500 kB tetap ada. Empat file Sites yang dilindungi tidak diubah.
