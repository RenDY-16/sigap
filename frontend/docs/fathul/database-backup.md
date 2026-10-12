# Runbook backup dan pemulihan database staging

Runbook ini hanya untuk PostgreSQL 18 lokal SIGAP dengan database sintetis. Ia tidak mengatur backup produksi, offsite, jadwal otomatis, retensi, point-in-time recovery, atau target RPO/RTO.

## Prasyarat dan batas aman

- Jalankan dari direktori `frontend` dengan `.env` server lokal yang sudah berisi `DATABASE_URL`.
- Database sumber harus berupa `sigap_staging` atau database uji unik `sigap_backup_<timestamp>_<random>` pada `127.0.0.1:54329`, menggunakan user `sigap_dev`.
- Script memeriksa label container SIGAP, bind loopback, dan named volume sebelum dump/restore.
- File output harus memakai path absolut di luar repository. File yang sudah ada tidak akan ditimpa.
- Passphrase dibaca dari environment `SIGAP_BACKUP_PASSPHRASE`, harus setidaknya 32 byte, dan tidak disimpan oleh aplikasi. Buat passphrase acak melalui password manager. Jangan menaruhnya di command argument, file proyek, atau chat.
- Backup masih mengandung isi laporan sintetis setelah didekripsi. Simpan folder dengan izin user saja, jangan commit, kirim, atau gunakan pada layanan publik.

## Buat dan verifikasi backup

```sh
mkdir -p "$HOME/Documents/sigap-staging-backups"
chmod 700 "$HOME/Documents/sigap-staging-backups"
read -r -s -p 'Passphrase backup (minimal 32 byte): ' SIGAP_BACKUP_PASSPHRASE
printf '\n'
export SIGAP_BACKUP_PASSPHRASE
backup_file="$HOME/Documents/sigap-staging-backups/sigap-staging-$(date +%Y%m%d-%H%M%S).gpg"
npm run db:backup -- backup "$backup_file"
npm run db:backup -- verify "$backup_file"
unset SIGAP_BACKUP_PASSPHRASE
```

Dump PostgreSQL dialirkan langsung ke GPG AES-256; plaintext tidak ditulis ke file saat membuat backup. File sementara dan passphrase memiliki permission terbatas dan dihapus setelah proses. Output terminal hanya menyatakan sukses/gagal, bukan isi laporan.

## Latihan restore terisolasi

Pilih target baru dengan akhiran timestamp dan 8 karakter acak heksadesimal. Script menolak target lain, target yang sudah ada, host/database di luar staging lokal, serta backup yang gagal autentikasi/integrity check. Validasi arsip dilakukan sebelum database target dibuat. Restore yang gagal menghapus hanya database target yang baru dibuat oleh proses tersebut.

```sh
read -r -p 'Path backup yang sudah dibuat: ' backup_file
read -r -s -p 'Passphrase backup: ' SIGAP_BACKUP_PASSPHRASE
printf '\n'
export SIGAP_BACKUP_PASSPHRASE
npm run db:backup -- restore "$backup_file" "sigap_restore_$(date +%s)_$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
unset SIGAP_BACKUP_PASSPHRASE
```

Restore dibuat sebagai database terpisah; ia tidak mengganti `sigap_staging` atau mengarahkan ulang aplikasi. Setelah pemulihan, script memeriksa status migrasi pada target dan hanya mengembalikan sukses bila schema cocok dengan source saat ini. Setelah memeriksa data target untuk latihan, hapus database itu secara eksplisit dengan `podman exec sigap-postgres18-local dropdb -U sigap_dev --if-exists <nama-target-yang-baru-dibuat>`. Pastikan nama target tepat sebelum menjalankan penghapusan.

## Verifikasi otomatis

`npm run test:database-backup` membuat hanya database bernama unik untuk pengujian, menulis satu laporan simulasi melalui HTTP, melakukan backup terenkripsi dan restore, membandingkan jumlah baris serta checksum migrasi, lalu menghapus database uji. Tes juga memeriksa penolakan overwrite/path repo dan arsip yang diubah. Tes ini tidak menyalin database staging aktif.

## Batas kesiapan operasi

Backup lokal tunggal bukan disaster recovery: kerusakan disk dapat menghilangkan database dan arsip bersamaan. Belum ada target offsite, key rotation/recovery escrow, retensi yang disetujui, backup terjadwal, WAL/PITR, alert kegagalan, uji pemulihan lintas-host, atau target RPO/RTO. Semua keputusan itu harus dibuat bersama pemilik layanan sebelum data non-sintetis digunakan.
