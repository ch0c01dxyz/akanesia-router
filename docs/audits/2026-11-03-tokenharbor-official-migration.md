# Migrasi Token Harbor ke provider official

Migrasi diterapkan pada database lokal dan server `localhost:20127` kembali aktif dengan PID `28428`.

## Hasil

- 355 koneksi custom dipindahkan ke provider bawaan `tokenharbor`; 42 koneksi official yang sudah ada dipertahankan.
- Total 397 koneksi tersimpan, dengan 362 key unik aktif. Sebanyak 35 salinan key yang sudah aktif pada official dinonaktifkan; kredensialnya tetap tersimpan.
- ID koneksi, API key, waktu pembuatan, metadata kesehatan, dan referensi riwayat dipertahankan. Metadata transport custom dilepas; pengaturan proxy per koneksi dipertahankan.
- 70 definisi model custom dipindahkan ke namespace official. Metadata official mendapat prioritas saat nama bertabrakan, sedangkan metadata tambahan custom tetap disertakan.
- Combo yang memakai `tokenharbor/...` tetap dapat digunakan. Tidak ditemukan referensi combo atau alias langsung ke ID node custom.
- Node custom kosong tetap disimpan sebagai `Token Harbor (migrated)` dengan prefix `tokenharbor-legacy` untuk pemulihan. Prefix ini tidak lagi berbenturan dengan official dan tidak menghasilkan model pada katalog aktif.

## Pemilihan akun

Uji gateway awal menemukan akun official lama yang menunjuk proxy pool tidak valid. Strategi global sticky round-robin terus memilih akun tersebut, sehingga request tertahan sebelum koneksi hasil migrasi digunakan.

Koneksi hasil migrasi ditempatkan lebih dahulu, dengan urutan relatif tiap kelompok tetap terjaga. Khusus Token Harbor, strategi menjadi `fill-first` agar prioritas ini digunakan. Strategi global tidak diganti. Saat migrasi, konfigurasi proxy akun lama dipertahankan; tindak lanjut di bawah menyelesaikan konfigurasi yang tidak valid atas permintaan pengguna.

## Tindak lanjut proxy akun lama

Pengguna mengizinkan perbaikan konfigurasi proxy atau penonaktifan proxy pada akun lama. Ditemukan 42 akun Token Harbor yang menunjuk satu pool nonaktif. Referensi pool dilepas dan proxy per koneksi dinonaktifkan melalui `PUT /api/providers/[id]`; akun kini memakai koneksi langsung. Pool itu sendiri dan konfigurasi provider lain tidak diubah.

Pemeriksaan terhadap seluruh 42 baris memastikan API key, status aktif, serta metadata kesehatan tetap sama. Sampel akun lama berhasil melakukan Chat Completions langsung dengan HTTP 200 dalam 2.377 ms. Gateway streaming berhasil dengan HTTP 200 dalam 2.412 ms dan terminal `[DONE]`; health HTTP 200 dan integritas SQLite `ok`. Tidak ada restart yang diperlukan untuk perubahan melalui API ini.

Backup sebelum penonaktifan proxy berada pada `db/backups/before-tokenharbor-proxy-disable-2026-11-03T10-43-16-796Z.sqlite` di direktori data lokal. Tidak ada database atau kredensial yang dimasukkan ke commit.

## Verifikasi

- Sebelum migrasi: sampel key custom berhasil mengambil 76 model dari endpoint official; Chat Completions HTTP 200 dalam 2.067 ms.
- Setelah migrasi: `/api/health` HTTP 200; dashboard menampilkan 397 koneksi official dan nol koneksi pada ID custom.
- Katalog lokal tanpa fetch dinamis: HTTP 200, 71 model berprefix `tokenharbor/`, nol model `tokenharbor-legacy/`. Katalog live upstream dapat berbeda dari katalog lokal ini.
- Gateway `tokenharbor/deepseek-v4.1-flash:free`: JSON HTTP 200 dalam 2.292 ms; streaming HTTP 200 dalam 3.766 ms dengan terminal `[DONE]`.
- Tiga tes migrasi dengan 20 assertion lulus: preview tanpa perubahan, preservasi data dan deduplikasi, penggabungan metadata, idempotensi, serta rollback transaksi saat terjadi konflik.
- `PRAGMA integrity_check` menghasilkan `ok`; `git diff --check` lulus. Menjalankan ulang skrip menghasilkan no-op.

## Backup dan pemulihan

Backup SQLite konsisten dibuat sebelum perubahan pada:

`C:\Users\ch0c0\AppData\Roaming\9router\db\backups\before-tokenharbor-official-2026-11-03T10-31-29-912Z.sqlite`

Backup mengandung kredensial seperti database utama; biarkan di direktori data lokal. Untuk pemulihan, hentikan server terlebih dahulu. Pemulihan penuh dari backup juga mengembalikan data lain ke waktu backup; jika sudah ada perubahan baru, pulihkan hanya koneksi terkait, node, definisi model, prioritas, dan override strategi Token Harbor.

Skrip: [migrate-tokenharbor-official.mjs](../../scripts/migrate-tokenharbor-official.mjs). Tes: [migrate-tokenharbor-official.test.mjs](../../scripts/migrate-tokenharbor-official.test.mjs). Preview merupakan mode default; penerapan memakai `--db <data.sqlite> --apply` dengan server dihentikan.

Tidak menguji seluruh 362 key atau semua model, dan tidak menjalankan soak test panjang. Tidak ada pembelian kredit, penggantian key, commit, atau push.
