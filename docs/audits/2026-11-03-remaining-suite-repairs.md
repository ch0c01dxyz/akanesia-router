# Perbaikan kegagalan suite dan kontrak provider

## Hasil akhir

Suite offline lengkap lulus: **4.967 tes pada 464 file, nol kegagalan, 55 pending, dan 571 snapshot cocok**. Build produksi berhasil. Server baru aktif pada `localhost:20127`, PID `28460`; health HTTP 200.

## Bug produksi yang diperbaiki

| Bagian | Akar masalah | Perbaikan |
|---|---|---|
| Pencatatan penggunaan | Request berbeda dengan timestamp milidetik, akun, model, dan token identik digabung sebagai duplikat | Setiap pemanggilan pencatatan menyimpan request tersendiri dalam transaksi. Uji 100 request paralel dengan timestamp identik membuktikan seluruhnya tercatat |
| Thinking Haiku 5.5 | Entri capability memakai format `anthropic`, yang tidak dikenali dispatcher thinking | Gunakan format internal `claude-budget`; override adaptive khusus provider tetap berlaku |
| Thinking Gemini Argon | Entri capability memakai format `gemini`, yang tidak dikenali dispatcher thinking | Gunakan `gemini-level`, diuji lewat `applyThinking` yang sebenarnya |
| Katalog Cursor HTTP/2 | Request dan sesi berpotensi tertinggal saat timeout atau pembatalan | Tutup request, hancurkan sesi, dan lepas listener abort pada penyelesaian; signal yang sudah aborted tidak membuka koneksi |
| Error verifikasi akun | Semua 403 dilabeli kuota habis, dan error verifikasi email hanya mengunci model yang sedang dipakai | 403 umum menjadi `permission_denied`; penanda verifikasi email mendapat `email_verification_required` dan cooldown akun lintas model 30 menit |

Cooldown verifikasi tidak menghapus key atau mengubah `isActive`. Percobaan akun berikutnya tetap tersedia. Verifikasi email tetap merupakan tindakan pemilik akun; router tidak mengirim email, melewati verifikasi, atau menonaktifkan seluruh kelompok 403 secara otomatis. Perilaku 429 dan penghormatan hint reset upstream dipertahankan.

Perbaikan pencatatan berlaku untuk request baru; data penggunaan yang sebelumnya tidak pernah tersimpan tidak direkonstruksi.

Lokasi utama: [usageRepo](../../src/lib/db/repos/usageRepo.js), [capabilities](../../open-sse/providers/capabilities.js), [Cursor models](../../open-sse/services/cursorModels.js), [auth](../../src/sse/services/auth.js), [error config](../../open-sse/config/errorConfig.js).

## Perbaikan infrastruktur dan kontrak tes

- Empat file memakai `node:test` di dalam suite Vitest; kini dijalankan oleh runner yang sama sehingga tes benar-benar dikumpulkan dan diperiksa.
- Handle SQLite fixture ditutup sebelum direktori sementara dibersihkan pada Windows. Flag observability yang salah ketik diperbaiki pada fixture.
- `lowdb` ditambahkan sebagai dependency pengembangan pada paket tes untuk perbandingan SQLite/legacy yang sudah ada, tanpa menambah dependency runtime aplikasi.
- Fixture executable dan mock pencarian PATH mengikuti Windows/POSIX. Import lazy headroom pada tes lifecycle dijalankan setelah environment fixture disiapkan.
- Mock DNS mengikuti kontrak `{ all: true }`; proteksi SSRF produksi tetap dipertahankan. Mock katalog Cursor memakai HTTP/2, bukan HTTP fetch yang sudah tidak digunakan.
- Tes OAuth Cursor memeriksa query key yang eksplisit, alias legacy yang didukung, penutupan database, serta fallback manual. Query fuzzy yang tidak lagi dipakai tidak dikembalikan.
- Ekspektasi translator mengikuti preservasi blok teks, `mediaType` gambar, dan prefix sistem Kiro yang berada pada giliran percakapan. Ekspektasi endpoint, versi SDK, dan provider yang sudah dipensiunkan diselaraskan dengan kontrak saat ini.
- Jalur utama Muse Spark OpenCode ternyata memakai `OpenCodeBridgeExecutor` dengan format Chat. Registry produksinya dipertahankan; tes membedakan jalur bridge dengan kelas executor direct. Tidak ada pemaksaan format Responses pada jalur bridge.
- Cold import registry diberi waktu tes 15 detik dan hook 30 detik, dengan maksimum empat worker untuk mengurangi persaingan resource.

Tes live `*.live.test.js` kini memerlukan `RUN_LIVE_TESTS=1`. Tes embeddings cloud hanya dimasukkan bila source komponen cloud tersedia; checkout ini tidak memilikinya. Keduanya tidak diklaim sebagai pengujian upstream yang sudah lulus. Sebanyak 55 tes pending juga tetap dilaporkan sebagai pending.

Perintah gate: `node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js`. Hasil terperinci lokal: `logs/remaining-fixes-final.json`.

## Pemeriksaan live setelah build

Pengujian memakai Bansos Lightvela yang termasuk provider berkuota cukup menurut pengguna. Tidak menjalankan ulang seluruh key atau model pada provider berkuota sedikit.

| Protokol | JSON | Streaming | Terminal streaming |
|---|---:|---:|---|
| Chat Completions | 200; 4.251 ms | 200; 4.836 ms | `[DONE]` |
| Responses | 200; 1.915 ms | 200; 2.361 ms | `response.completed` |
| Messages | 200; 2.898 ms | 200; 7.574 ms | `message_stop` |

Enam request menghasilkan tepat enam entri `usageHistory` baru. `PRAGMA integrity_check` menghasilkan `ok`. Aturan pembatalan khusus provider dengan tepat satu akun aktif tetap dipertahankan; fallback multiakun tidak dihentikan oleh perubahan ini.

Build sebelumnya disimpan di `.next-analyze/production-before-remaining-fixes-20261103`. Log build: `logs/remaining-fixes-build.log`. Tidak ada migrasi schema atau penulisan ulang riwayat penggunaan. Lockfile pengguna, database, kredensial, dan log lokal tidak dimasukkan ke commit.

Belum menjalankan soak test panjang atau verifikasi langsung seluruh model Haiku/Gemini/Cursor pada akun berbayar. Verifikasi email akun upstream dan pemulihan kuota tetap bergantung pada provider serta pemilik akun.
