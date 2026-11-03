# Audit kode dan server lokal — 3 November 2026

Tindak lanjut: [perbaikan snapshot, kuota, dan Kimi resmi](2026-11-03-snapshot-quota-kimi-fixes.md). Hasil 13 kegagalan snapshot di bawah adalah catatan audit awal; kegagalan tersebut sudah diperbaiki pada tindak lanjut.

## Ruang lingkup

Akanesia-Router adalah gateway lokal yang menerjemahkan protokol AI, memilih koneksi, dan melakukan fallback antar model/akun. Audit memakai asumsi deployment satu proses Node.js, dengan server utama di `localhost:20127`. Build kandidat diuji terpisah di port `20128` sebelum penerapan.

Prioritas: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, koneksi model, streaming, tool calling, penanganan kegagalan, dan latensi katalog. Kode yang ditelusuri meliputi handler chat, executor bersama, translator request/response, cache model, cooldown akun, refresh token, dan logger. Pemeriksaan tidak membaca seluruh file repository satu per satu.

Inventaris awal: **1.621 koneksi pada 54 provider**. Status tersimpan: 1.343 `active`, 277 `unavailable`, 1 `unknown`. Status tersebut adalah riwayat aplikasi, bukan hasil pengujian baru terhadap seluruh akun.

## Temuan dan perbaikan

| Prioritas | Masalah dan pemicu | Perbaikan | Bukti |
|---|---|---|---|
| Tinggi | Error `/v1/messages` memakai envelope dan tipe error OpenAI, sehingga kontrak error Anthropic tidak konsisten. | Normalisasi di endpoint Messages menjadi `type: error`, tipe error Anthropic berdasarkan status, dan `request_id`; pertahankan status serta header retry. Stream sukses tidak dibaca ulang. | 14 tes kontrak untuk status 400–529 dan passthrough SSE. |
| Tinggi | Gambar `source.type: url` dari pesan Anthropic hilang saat diterjemahkan ke Chat Completions. URL screenshot di tool result juga hilang. | Pertahankan URL sebagai `image_url`; screenshot tool mengikuti pola yang sudah ada: pesan tool berisi teks, gambar diteruskan pada user turn berikutnya. | Tes translator untuk URL biasa, URL screenshot, dan gambar base64. |
| Tinggi | `tool_result.is_error` hilang saat melewati format OpenAI. Model menerima kegagalan seolah hasil tool biasa. | Tandai teks hasil dengan `[Tool error]`, tanpa menambahkan field yang tidak sah pada payload OpenAI. | Tes memastikan pesan kegagalan dan ID tool tetap tersambung. |
| Tinggi | Responses membuat assistant turn dengan `tool_calls: []` sebelum menolak function call tanpa nama. | Validasi nama sebelum membuat turn. | Tes input seluruhnya tanpa nama dan kombinasi call tidak valid/valid beserta hasilnya. |
| Tinggi | Respons upstream yang dibuang saat retry/fallback tidak dibatalkan. Koneksi dan body dapat terus menggunakan sumber daya. | Batalkan body sebelum retry status atau berpindah URL; respons terakhir tetap diserahkan ke caller. | Tes cleanup untuk HTTP 502 dan fallback 429. |
| Tinggi | Jeda retry tidak berhenti ketika klien membatalkan request; alasan pembatalan berupa `Error` biasa dapat dianggap gangguan jaringan. | Gunakan timer yang menerima abort signal, cek pembatalan sebelum fetch, dan hentikan retry saat signal klien sudah dibatalkan. | Tes membatalkan backoff 60 detik tanpa fetch kedua; tes pre-abort dan custom abort reason. |
| Tinggi | Lock model yang sudah kedaluwarsa menutupi lock seluruh akun yang masih aktif karena pemilihan dengan `modelLock || accountLock`. | Periksa kedua lock secara independen. | Tes lock model kedaluwarsa/rusak, lock akun aktif, dan pelepasan lock. |
| Tinggi | Logger diagnostik sengaja melewatkan header autentikasi tanpa redaksi ketika logging aktif. | Gunakan redaksi yang sudah dipakai replay buffer, termasuk API key, cookie, token internal CLI/peer, dan header bernama token/secret/password. | Tes membaca file log yang dihasilkan dan memastikan nilai rahasia tidak tersimpan. |
| Sedang | JSON `null` menyebabkan 500 sebelum admission chat selesai. | Tolak JSON non-object, termasuk array dan scalar, baik terkompresi maupun biasa. | Reproduksi live 500 sebelum perbaikan dan 400 pada kandidat; tes gzip/non-gzip. |
| Sedang | Katalog model mengambil endpoint compatible secara berurutan, masing-masing dapat menunggu 60 detik. Satu endpoint lambat menghambat seluruh katalog. | Maksimal 8 pengambilan paralel; batas waktu 5 detik khusus discovery katalog. Timeout validasi provider manual tetap 60 detik. | Kandidat mengembalikan 3.280 model dalam 7.550 ms; server lama belum selesai pada batas uji 15.000 ms. |
| Sedang | Request katalog bersamaan mengulang pembangunan katalog dan panggilan upstream yang sama saat cache kosong. | Gabungkan pembangunan yang sedang berjalan berdasarkan jenis katalog; invalidasi mencegah hasil lama mengisi cache setelah setting berubah. | Tes satu build untuk request serentak, retry setelah kegagalan, invalidasi saat build berjalan, dan pemisahan katalog internal. |

Perbaikan pengujian: tutup SQLite sementara sebelum menghapus direktori pada Windows; reset singleton DB antar kasus; inisialisasi translator pada tes stream; tunggu finish event sebelum memeriksa argumen tool yang dibuffer; sesuaikan pengujian Kiro dengan system prefix di user turn; ubah penanda expected-failure yang sudah tidak sesuai. Search auto-switch yang memang belum diaktifkan tetap tidak diaktifkan.

## Pengujian live

Semua prompt audit pendek. Tidak ada pembelian kredit, perubahan key, penghapusan koneksi, atau penggantian strategi routing pengguna.

### Jalur utama dan harness

| Jalur | Hasil |
|---|---|
| Kimi → OpenAI Chat JSON | HTTP 200; content `OK`, finish `stop`; sampel 3.092 ms. |
| Kimi → OpenAI Chat SSE | HTTP 200; 9 data event; terminal `[DONE]`; sampel 2.642 ms. |
| Kimi → Responses JSON | HTTP 200; object `response`, status `completed`; sampel 4.317 ms. |
| Kimi → Responses SSE | HTTP 200; event teks/reasoning dan `response.completed`; sampel 2.123 ms. |
| Kimi → Anthropic JSON | HTTP 200; object `message`, content thinking/text, stop `end_turn`; sampel 3.594 ms. |
| Kimi → Anthropic SSE | HTTP 200; lifecycle content block lengkap dan `message_stop`; sampel 2.126 ms. |
| Chat tool loop | Call `audit_echo` memiliki ID dan JSON argumen benar; tool result diterima; respons lanjutan HTTP 200, finish `stop`. |
| Anthropic tool loop | Stop `tool_use`, ID dan input benar; tool result diterima; respons lanjutan HTTP 200, stop `end_turn`. |
| Responses tool loop | Dengan `tool_choice: auto`, SSE mengirim 5 argumen delta dan output function call yang benar; `response.completed`; respons setelah function output HTTP 200, status `completed`. Sampel 10.899 ms untuk call dan 2.521 ms untuk lanjutan. |
| Translasi OpenAI → Anthropic | Upstream OpenRouter Liquid mengirim Chat Completions; endpoint Messages menghasilkan lifecycle Anthropic sampai `message_stop`, HTTP 200 dalam 457 ms. |

Angka generasi model adalah sampel jaringan/upstream, bukan benchmark server murni atau jaminan latensi.

### Responsivitas dan pembatasan akses

- Health awal HTTP 200 dalam 28 ms.
- Dua puluh health request bersamaan seluruhnya HTTP 200: p50 sekitar 41 ms, p95 70 ms, maksimum 73 ms.
- Dashboard providers/combos tanpa sesi: HTTP 401.
- Chat tanpa API key: HTTP 401 untuk request biasa.
- Sebelum perubahan, body `null` memberikan HTTP 500; pada kandidat berubah menjadi HTTP 400.
- Katalog internal tanpa discovery: cold 1.956 ms, warm 19 ms. Ini jalur diagnostik berbeda dari katalog normal, sehingga tidak dipakai untuk menyatakan percepatan katalog normal.

## Batas upstream yang terkonfirmasi

- Kimi Responses menolak `tool_choice: required` dengan HTTP 400. Request langsung ke endpoint Kimi juga menghasilkan 400; `auto` berhasil langsung dan melalui router. Router mempertahankan maksud pemanggil dan tidak diam-diam mengganti required menjadi auto.
- Combo `kimigratis` mendapat penolakan batas request bersamaan dari upstream, lalu cooldown router. Combo `opus5` melewati batas probe 15 detik.
- OpenRouter Recursive mengembalikan `no upstreams available`. Liquid sempat berhasil untuk Anthropic, kemudian menolak sampel Responses karena rate limit. Validasi translasi Responses tetap dicakup tes offline dan jalur native Kimi; sampel translasi Responses lewat OpenRouter tersebut belum berhasil live.
- `typesafe/jev-1.13` ditolak upstream pada endpoint chat karena merupakan model decisions. Kegagalan probe ini tidak dipakai sebagai bukti kegagalan translator.
- Riwayat koneksi memuat saldo/kuota habis, token ditolak, model membutuhkan pembelian, connect timeout, dan kanal upstream tidak tersedia. Audit tidak menonaktifkan akun secara massal berdasarkan riwayat tersebut.

## Hasil pemeriksaan otomatis

- Gate gabungan: **78 file, 1.458 tes lulus, 13 gagal**. Seluruh 13 kegagalan berada pada snapshot URL/header provider di `tests/translator/golden-url-header.test.js`.
- Tes kontrak error Anthropic yang ditambahkan sesudah gate tersebut: **14/14 lulus**.
- Snapshot yang belum selaras: URL bedrock, chenzk, freetheai, opencode-zen, regolo; header agentrouter, bedrock, cline, clinepass, kimi, minimax-code, minimax-code-global, opencode-zen.
- Snapshot tersebut tidak diperbarui otomatis untuk membuat hasil tampak hijau. Snapshot tambahan yang ditulis runner saat discovery juga dikembalikan ke kondisi awal.
- Beberapa tes translator memakai `it.fails` untuk keterbatasan yang memang sudah diketahui. Tes semacam itu masuk hitungan lulus ketika keterbatasannya masih ada; hitungan di atas bukan pernyataan bahwa seluruh fitur/protokol sudah sempurna.
- Keterbatasan yang masih direkam tes: Responses image `file_id` lintas provider; encrypted/redacted thinking lintas format; input audio ke Claude; beberapa perilaku Gemini, Cursor, Kiro, dan CommandCode. Jalur tersebut memerlukan keputusan kemampuan provider atau implementasi tambahan tersendiri.
- Build produksi berhasil pada direktori kandidat. Pemeriksaan runtime final server utama dicatat pada bagian berikut.
- Pemeriksaan whitespace `git diff --check` lulus. ESLint terarah sempat melewati timeout 30 detik saat build berjalan; hasil lint tidak diklaim lulus.

## Penerapan dan pemeriksaan akhir

Build kandidat menggunakan direktori terpisah `.next-cli-build`; scheduler refresh token dimatikan hanya pada proses kandidat untuk menghindari dua scheduler pada database yang sama. Server utama memakai direktori build standar `.next` dan konfigurasi pengguna yang sudah ada.

Build sebelum audit disimpan di `.next-analyze/production-before-audit-20261103`. Perubahan `.env` dan `package-lock.json` yang sudah ada sebelum audit dipertahankan. Tidak ada commit, push, atau publikasi.

**Server utama sudah menjalankan build baru pada port 20127**, PID 35812, menggunakan direktori standar `.next`. Build kanonis selesai dengan exit code 0. Proses kandidat di port 20128 sudah dihentikan.

Pemeriksaan pascarestart, seluruhnya berhasil:

| Pemeriksaan | Hasil |
|---|---|
| Health | HTTP 200 |
| Chat Completions JSON / SSE | HTTP 200; 3.499 / 3.054 ms; format dan terminal SSE benar |
| Responses JSON / SSE | HTTP 200; 12.381 / 6.610 ms; status completed dan terminal SSE benar |
| Anthropic Messages JSON / SSE | HTTP 200; 3.126 / 3.249 ms; object message dan message_stop benar |
| Katalog normal, cache kosong | HTTP 200; **8.941 ms**, 3.216 model |
| Katalog normal, cache terisi | HTTP 200; **19 ms** |
| `/v1/messages/count_tokens` | HTTP 200; `input_tokens: 2` untuk pesan pendek |
| Body JSON null pada ketiga API | HTTP 400; Messages menggunakan envelope `type: error` |
| 20 health request serentak pascarestart | Semuanya HTTP 200; p50 48 ms, p95 72 ms, maksimum 75 ms |
| Anthropic tanpa API key | HTTP 401; `type: error`, `error.type: authentication_error` |

Jumlah model kandidat dan produksi dapat berbeda karena discovery memiliki batas waktu serta endpoint upstream berubah ketersediaannya. Pengurangan batas discovery tidak mengubah timeout inferensi atau menonaktifkan koneksi.

Total bukti otomatis yang dijalankan: **1.472 tes lulus**, dengan **13 kegagalan snapshot** yang dijelaskan di atas. Ini gabungan gate utama dan 14 tes kontrak error Anthropic yang dijalankan terpisah.

### Lokasi implementasi

- [Endpoint Messages dan kontrak error](../../src/app/api/v1/messages/route.js).
- [Translator Anthropic → OpenAI](../../open-sse/translator/request/claude-to-openai.js) dan [Responses → Chat](../../open-sse/translator/request/openai-responses.js).
- [Retry, fallback URL, dan pembatalan koneksi](../../open-sse/executors/base.js).
- [Lock akun dan model](../../open-sse/services/accountFallback.js).
- [Katalog model](../../src/app/api/v1/models/route.js), [cache](../../src/lib/modelsCache.js), dan [discovery compatible](../../src/lib/compatibleModelsFetch.js).
- [Parsing request JSON](../../src/lib/requestBodyEncoding.js).
- [Logger diagnostik](../../open-sse/utils/requestLogger.js) dan [redaksi header bersama](../../src/lib/requestReplayBuffer.js).

## Rujukan kontrak

- [Anthropic: streaming dan urutan event](https://platform.claude.com/docs/en/build-with-claude/streaming).
- [Anthropic: bentuk dan tipe error](https://platform.claude.com/docs/en/api/errors).
- [OpenAI: Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events).
- [Kimi Code: endpoint Chat Completions, Responses, dan Anthropic](https://www.kimi.com/code/docs/en/kimi-code/models).

## Yang belum diperiksa

Tidak menjalankan seluruh koneksi/model berbayar, soak test berjam-jam, beban inferensi serentak besar, seluruh halaman GUI, semua protokol media, atau deployment multi-proses. Tidak ada klaim bahwa kredit, kuota, atau ketersediaan provider eksternal telah diperbaiki. Redaksi log berlaku pada log baru; log lama tidak dihapus atau ditulis ulang.
