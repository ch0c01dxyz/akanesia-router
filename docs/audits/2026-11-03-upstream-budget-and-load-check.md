# Batas fallback, pembatalan satu akun, dan pemeriksaan beban

Tindak lanjut: [perbaikan suite dan kontrak provider](2026-11-03-remaining-suite-repairs.md) menghasilkan gate offline dengan 4.967 tes lulus dan nol kegagalan. Angka kegagalan di bawah merupakan hasil historis sebelum tindak lanjut tersebut.

## Perubahan yang diterapkan

- Error konfigurasi proxy diberi kode `ERR_PROXY_CONFIG` dan tidak lagi masuk retry jaringan pada executor default. Pemilihan akun berikutnya tetap tersedia.
- Pembukaan koneksi upstream dan fallback berbagi deadline 90 detik, dapat diatur lewat `CHAT_UPSTREAM_BUDGET_MS`. Timer percobaan dilepas ketika executor mengembalikan response headers, sehingga stream sehat atau pembacaan body yang sudah berjalan tidak dipotong oleh timer ini. Batas ini bukan deadline mutlak seluruh generasi atau seluruh proses refresh autentikasi.
- Signal pembatalan klien diteruskan hanya ketika provider memiliki tepat satu akun aktif. Pembatalan tersebut menghasilkan 499 tanpa menghukum kesehatan akun. Provider multiakun tetap mempertahankan alur fallback sesuai permintaan pengguna.
- `.env` dilepas dari pelacakan Git dan diabaikan; file lokal tetap tersedia. `.env.example` tetap dilacak dan mendokumentasikan variabel baru. Riwayat Git tidak ditulis ulang.

Lokasi utama: [chat handler](../../src/sse/handlers/chat.js), [core](../../open-sse/handlers/chatCore.js), [executor](../../open-sse/executors/base.js), [proxy](../../open-sse/utils/proxyFetch.js), [konfigurasi](../../open-sse/config/runtimeConfig.js).

## Validasi key Token Harbor

Seluruh 362 key unik aktif diperiksa dengan concurrency 3, satu request kecil per key pada `deepseek-v4.1-flash:free`, output maksimum 8 token, tanpa retry otomatis.

| Hasil saat pemeriksaan | Jumlah |
|---|---:|
| HTTP 200 dengan choices | 161 |
| HTTP 403 | 176 |
| HTTP 429 | 25 |

Sampel 403 menjelaskan bahwa email akun belum diverifikasi. Hal ini tidak membuktikan seluruh 176 respons memiliki penyebab identik. Sampel 429 berhasil saat diperiksa ulang, sehingga kelompok ini tidak dianggap sebagai key invalid permanen. Tidak ada akun yang dinonaktifkan otomatis atau email verifikasi yang dikirim.

Hasil berlaku untuk akses ke model gratis tersebut pada waktu pengujian, bukan jaminan akses seluruh model atau besaran saldo. Laporan per koneksi hanya memuat ID, status, kategori, dan waktu respons; tersimpan lokal di `APPDATA/9router/db/tokenharbor-key-validation-20261103.json`, tanpa key atau body respons. Skrip: [validate-tokenharbor-accounts.mjs](../../scripts/validate-tokenharbor-accounts.mjs).

## Beban terbatas pada provider yang disetujui

32 request streaming, concurrency global 3, delapan request per model, output maksimum 16 token. Hanya empat provider dengan kuota cukup yang ditunjuk pengguna digunakan untuk benchmark ini. p50/p95 dihitung dari request yang berhasil; waktu token pertama juga mencakup token reasoning bila provider mengirimkannya.

| Provider/model | Berhasil | p50 total | p95 total | p95 token pertama |
|---|---:|---:|---:|---:|
| Token Harbor / deepseek-v4.1-flash:free | 7/8 | 13.010 ms | 18.291 ms | 18.290 ms |
| Bansos Montera / deepseek-v4-flash | 7/8 | 7.819 ms | 19.867 ms | 19.210 ms |
| Bansos Lightvela / deepseek-v4-pro-202606 | 8/8 | 1.602 ms | 4.486 ms | 4.246 ms |
| IFM / IFM/K2-Horizon-375B-A23B | 8/8 | 1.298 ms | 8.148 ms | 1.714 ms |

Satu request Token Harbor berakhir 429 setelah 25.027 ms termasuk fallback. Satu request Montera mencapai deadline benchmark 30 detik; ini berbeda dari budget pembukaan koneksi router 90 detik. Tidak ada klaim bahwa kuota upstream atau latensi model eksternal dapat diperbaiki oleh perubahan lokal ini.

Working set server: sekitar 152,1 MB pada sampel awal, 146,4 MB setelah beban, dan 147,8 MB pada pemeriksaan berikutnya; handle turun dari 291 menjadi 279. Pemeriksaan terakhir menemukan satu listener, satu socket `FinWait2`, dan tidak ada `CloseWait`. Sampel singkat ini tidak membuktikan tidak ada kebocoran jangka panjang.

Skrip: [benchmark-gateway.mjs](../../scripts/benchmark-gateway.mjs). Hasil mentah tanpa kredensial: `logs/optimization-benchmark.json`.

## Pembuktian dan penerapan

- Lima file tes terkait lulus: 42 tes, termasuk batas deadline, penghentian retry proxy, pembatalan satu akun, kelanjutan fallback multiakun, dan forwarding sesi provider.
- Suite yang lebih luas daripada gate audit sebelumnya menghasilkan 4.845 tes lulus, 75 gagal, 60 pending; 571 snapshot cocok tanpa mismatch. Suite lengkap belum hijau.
- Baseline dari commit `7e16ebe5` diuji melalui salinan terpisah. Seluruh 74 kegagalan assertion non-live yang dibandingkan berhasil direproduksi; tidak ada kegagalan assertion baru pada perbandingan tersebut. Tes live yang tersisa tidak diulang pada baseline agar tidak memakai kuota tambahan. Salinan baseline sementara sudah dibersihkan.
- Uji live pembatalan Montera yang memiliki satu akun aktif: klien abort sekitar 501 ms dan server mencatat `ABORTED` sekitar 487 ms. Pengujian tidak menonaktifkan mekanisme fallback provider multiakun.
- Build produksi berhasil; server baru aktif di `localhost:20127`, PID `10752`; `/api/health` HTTP 200 setelah benchmark. Build sebelumnya dipertahankan di `.next-analyze/production-before-upstream-budget-20261103`.
- `git diff --check` lulus. Perubahan lockfile milik pengguna, database, laporan per-key, dan log lokal tidak disertakan dalam commit.

Tidak menjalankan soak test panjang atau semua model berbayar. Tindak lanjut operasional yang masih diperlukan: verifikasi email akun yang terblokir, pemeriksaan ulang rate limit setelah reset, dan penanganan kegagalan tes lama secara terpisah.
