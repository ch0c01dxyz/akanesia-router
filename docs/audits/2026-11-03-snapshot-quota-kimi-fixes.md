# Perbaikan snapshot, kuota upstream, dan Kimi resmi

## Hasil pemeriksaan kode

**1.665 tes pada 98 file lulus** dalam mode CI dengan timezone UTC. Seluruh **571 snapshot cocok**, tanpa pembaruan otomatis. Pemeriksaan whitespace `git diff --check` lulus.

Ketiga permintaan ditangani bersama: 13 kegagalan snapshot dari audit awal, penanganan kuota upstream, dan pembaruan provider Kimi berdasarkan API key yang sudah ada di database. Key tidak diganti, ditampilkan, atau dipindahkan ke konfigurasi baru.

## 13 kegagalan snapshot

- Dua kegagalan Bedrock berasal dari penggunaan `DefaultExecutor`, padahal Bedrock menggunakan executor sendiri dan autentikasi SigV4. Bedrock dan Bedrock xAI sekarang dikecualikan dari golden test executor default; perilaku keduanya diperiksa oleh tes Bedrock yang sudah ada.
- UUID sesi MiniMax, device ID, hostname, platform, versi runtime, dan timezone dinormalisasi hanya pada snapshot. Header produksi tetap memakai nilai sebenarnya.
- Empat URL dan tujuh header baseline diperbarui berdasarkan registry dan implementasi saat ini. Pembaruan Kimi kemudian menyesuaikan baseline URL dengan endpoint internasional yang diuji langsung.
- Dua belas snapshot yang tidak lagi memiliki kasus uji dibersihkan: keluarga Bedrock dan ID provider lama yang sudah tidak ada di daftar executor default. Tidak ada snapshot baru yang direkam secara sembarang.

Lokasi: [golden test](../../tests/translator/golden-url-header.test.js), [snapshot](../../tests/translator/__snapshots__/golden-url-header.test.js.snap), [tes Bedrock](../../tests/unit/bedrock-provider.test.js).

## Penanganan kuota

| Pemicu | Perbaikan |
|---|---|
| Upstream memberi `Retry-After: 113`, tetapi parser executor generik menghilangkan waktu reset | Baca Retry-After dalam detik atau tanggal HTTP, serta `retry_after` numerik dari JSON. Waktu reset khusus provider tetap didahulukan. |
| Hint waktu tunggu hanya ada pada body error | Teruskan sebagai `Retry-After` pada respons klien dan cooldown akun. |
| Model lain memiliki lock yang lebih singkat | Abaikan lock model lain saat menentukan kapan model yang diminta bisa dicoba lagi. Jika ada lock seluruh akun dan lock model, tunggu sampai keduanya berakhir. |
| Akun pertama dalam daftar bukan akun yang pulih paling cepat | Ambil status dan pesan error dari akun yang cocok dengan waktu pemulihan terpilih. |
| Pool berisi ratusan akun yang seluruhnya gagal | Terapkan `quotaMaxFallbacks` juga pada perpindahan akun: satu percobaan awal ditambah jumlah fallback yang dikonfigurasi. |
| Request berikutnya membaca cooldown yang tersimpan | Pertahankan status upstream, misalnya 429, beserta waktu tunggunya. Jangan selalu mengubahnya menjadi 503. |

Regresi membuktikan cooldown 113 detik tidak ditimpa override lokal satu detik, model yang masih terkunci tidak dicoba terlalu awal, fallback tetap bisa berhasil pada akun terakhir yang diizinkan, serta input 400 biasa tidak berubah menjadi cooldown kuota.

Lokasi: [parser hint upstream](../../open-sse/utils/upstreamHeaders.js), [error response](../../open-sse/utils/error.js), [lock model](../../open-sse/services/accountFallback.js), [pemilihan akun](../../src/sse/services/auth.js), [batas fallback](../../src/sse/handlers/chat.js).

Perbaikan ini mengurangi retry yang sia-sia. Saldo habis, batas paket, atau kuota dari provider tetap memerlukan pemulihan di sisi provider. Batas cooldown maksimum dan konfigurasi retry pengguna yang sudah ada tetap dipertahankan.

## Verifikasi API key Kimi yang tersimpan

Database memiliki satu koneksi Kimi aktif dengan autentikasi API key. Hasil pengujian menggunakan key tersebut:

| Endpoint resmi | Hasil |
|---|---|
| `GET https://api.kimi.ai/coding/v1/models` | 200; enam ID resmi |
| `GET https://api.kimi.com/coding/v1/models` | 200; enam ID yang sama |
| `GET https://api.moonshot.ai/v1/models` | 401; key ini bukan key platform Moonshot |
| `POST https://api.kimi.ai/coding/v1/responses` | 200; object response, model `k3.1-pro` |
| `POST https://api.kimi.ai/coding/v1/messages` | 200; object message, model `k3.1-pro` |
| `GET https://api.kimi.ai/coding/v1/usages` | 200 |
| Responses dengan tool `web_search` | 200; terdapat item `web_search_call` |

Keenam model berikut diuji satu per satu melalui Chat Completions. Semuanya mengembalikan HTTP 200, dan field model respons cocok dengan ID yang diminta:

| Model | Sampel latensi |
|---|---:|
| `k3.1-pro` | 3.402 ms |
| `k3.1-pro-highspeed` | 2.296 ms |
| `k3` | 7.890 ms |
| `k3-256k` | 6.992 ms |
| `kimi-for-coding` | 10.760 ms |
| `kimi-for-coding-highspeed` | 1.170 ms |

Angka ini adalah sampel jaringan dan generasi model, bukan jaminan performa. Pengujian memakai prompt pendek dan batas output kecil.

## Pembaruan provider Kimi

Provider `kimi` diarahkan ke layanan **Kimi Code**, sesuai key yang terbukti valid. Endpoint internasional `api.kimi.ai/coding/v1` digunakan untuk Chat Completions, Responses, Messages, dan usage. Protokol native tetap dipilih berdasarkan protokol klien. URL console untuk mendapatkan key kini menunjuk ke console Kimi Code.

Katalog berisi enam ID resmi di atas. Alias kompatibilitas `kimi-k3`, `kimi-k2.7-code`, dan `kimi-k2.7-code-highspeed` tetap tersedia, dengan pemetaan eksplisit ke ID Code. ID platform lama seperti `kimi-k2.5`, `kimi-k2.5-thinking`, `kimi-k2.6`, dan `kimi-latest` tidak lagi diiklankan sebagai model resmi Code. Combo atau custom model pengguna tidak ditulis ulang untuk menggantinya dengan model lain.

Kemampuan model mengikuti perbedaan yang didokumentasikan: K3.1 Pro mendukung reasoning low/high/max dan tidak dapat mematikan thinking; K3-256K memiliki batas 256K serta tidak menerima video; `kimi-for-coding` adalah K2.8 Preview hingga 1M. Batas aktual tetap bergantung pada paket. Effort dan pilihan summary pada Responses menggunakan object `reasoning`. Pilihan internal `summary: none` dikonversi menjadi penghilangan field summary, karena Kimi menolak literal `none` dengan 400. Summary yang valid seperti `concise` tetap diteruskan.

Pencarian Kimi sebelumnya menggunakan endpoint Moonshot dengan key Code. Jalur ini sekarang menggunakan Responses native dan tool `web_search`, dengan parser jawaban Responses yang sudah ada. Pengujian menemukan deadline lama 15 detik terlalu singkat; khusus pencarian Kimi, deadline menjadi 30 detik dengan effort low dan batas output 512 token. Endpoint autentikasi OAuth tidak diganti tanpa bukti perubahan resmi.

Lokasi: [registry Kimi](../../open-sse/providers/registry/kimi.js), [capabilities](../../open-sse/providers/capabilities.js), [thinking levels](../../open-sse/providers/thinkingLevels.js), [normalisasi reasoning](../../open-sse/translator/concerns/thinkingUnified.js), [usage](../../open-sse/services/usage/kimi.js), [search](../../open-sse/handlers/search/chatSearch.js), [tes kontrak Kimi](../../tests/unit/kimi-official-catalog.test.js).

## Penerapan lokal

Build produksi berhasil dan sudah aktif pada `localhost:20127` dengan PID `19364`. Build sebelumnya disimpan pada `.next-analyze/production-before-quota-kimi-20261103`. Log build: `logs/quota-kimi-build.log`.

Pemeriksaan runtime setelah restart:

- `/api/health`: HTTP 200.
- Chat Completions, Responses, dan Messages berhasil melalui gateway; Responses dan Messages juga menyelesaikan streaming.
- Responses dengan pilihan internal `reasoning.summary: none`: HTTP 200 untuk JSON (3.721 ms) dan SSE (2.490 ms), dengan event terminal `response.completed` pada SSE.
- `/v1/search` dengan provider `kimi`: HTTP 200 dalam 14.903 ms dan jawaban tidak kosong. Sampel ini tidak menghasilkan item pada array hasil terstruktur.
- Usage Kimi melalui endpoint manajemen: HTTP 200, dengan field `plan` dan `quotas`.

Latensi adalah sampel singkat, bukan benchmark beban berkelanjutan.

Tidak ada commit, push, pembelian kredit, penambahan key, atau penghapusan akun.

## Rujukan dan batas verifikasi

Pemisahan Kimi Code dan Moonshot, ID model, endpoint, serta aturan reasoning dicocokkan dengan [dokumentasi model resmi Kimi](https://www.kimi.com/code/docs/en/kimi-code/models), [integrasi Codex resmi](https://www.kimi.com/code/docs/en/third-party-tools/codex), dan [referensi error Kimi](https://www.kimi.com/code/docs/en/kimi-code/error-reference.html).

Tidak sengaja menghabiskan kuota upstream untuk memancing 429. Kondisi tersebut diuji secara deterministik pada parser, penyimpanan cooldown, pemilihan akun, dan handler request. Tidak menjalankan soak test panjang, seluruh akun berbayar, atau seluruh halaman GUI.
