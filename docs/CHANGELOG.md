# Catatan Perubahan 9router

> Bahasa: Indonesia. Semua perubahan di bawah ini **belum dikomit**
> (review-first). Tanggal dalam WIB.

## 2026-09-30

### Dashboard Headroom Token Saver + deteksi non-blocking + animasi loading

- Dashboard Headroom baru di `/dashboard/token-saver/headroom` (menggantikan
  proxy dashboard bawaan yang kosong): status running/versi/uptime, tile
  request & token & USD saved (menangani `litellm_available`), grafik token
  savings (daily/weekly/monthly), tabel checkpoint, ekspor CSV, auto-refresh
  30 detik. Data diambil dari `/stats` dan `/stats-history` (API frontend
  stabil menurut dokumentasi resmi Headroom).
- Deteksi Headroom/PXPIPE kini non-blocking: seluruh probing proses
  (`findHeadroomBinary`, `findPython310`, `getHeadroomInstallKind`, extras)
  ditulis ulang menjadi async (`execFileOutputAsync`/`probeRunAsync`/
  `findOnPathAsync` di `src/lib/platform.js`); kandidat python di-probe
  paralel; hasil environment di-cache 30 detik (status `running` selalu
  fresh). Sebelumnya probe sinkron menahan event loop Node sehingga halaman
  tidak bisa ditinggal selama pengecekan. Smoke test: scan pertama ~2725 ms,
  cache hit ~3 ms, event loop tetap bergerak 27 ticks selama scan.
- Animasi loading di halaman Token Saver: badge "Checking…" dengan spinner,
  skeleton "Detecting Headroom installation…", tombol Setup/Manage dan toggle
  Headroom dinonaktifkan selama pengecekan, spinner status di modal; link
  dashboard di modal mengarah ke halaman internal baru.
- Test: `tests/unit/platform-detect.test.js` diperluas (22 lolos, termasuk
  fungsi async + event loop responsif); `tests/unit/headroom-detect.test.js`
  ditulis ulang untuk API async (5 lolos). Production build sukses
  (route `/dashboard/token-saver/headroom` terdaftar).

### Fix dialog "Open with" di halaman Token Saver (Windows)

- Akar masalah: kandidat binary di-probe lewat `execSync(string)` → cmd.exe,
  yang mengeksekusi via asosiasi ekstensi Windows. File tanpa ekstensi
  dikenal (mis. pyenv shim `#!/bin/sh` + `pyenv exec …`) memicu dialog
  "How do you want to open this file?" saat halaman dibuka
  (`/api/headroom/status` → `findPython310()`).
- Modul baru `src/lib/platform.js`: deteksi eksplisit windows/macos/linux
  (`getOsKind()`), `isExecutablePath()` (Windows: wajib ekstensi PATHEXT;
  macOS/Linux: execute bit), `probeRun()`/`findOnPath()` yang tidak pernah
  lewat shell (kecuali `.bat`/`.cmd` yang selalu terasosiasi).
- `headroom/detect.js`: `findHeadroomBinary()`/`findUvBinary()` kini
  memvalidasi hasil `where`/`which` + probe `--version`;
  `findPython310()` probe via `execFile` tanpa shell, nama telanjang di
  Windows diselesaikan lewat `where` (PATHEXT-aware).
- `headroom/process.js` & `pxpipe/install.js`: spawn `.bat`/`.cmd` via shell
  di Windows (sebelumnya CreateProcess gagal); `findNpm()` divalidasi sama.
- Test baru `tests/unit/platform-detect.test.js` (15 lolos); smoke test:
  pyenv shim `headroom` di PATH kini ditolak (`null`), python asli tetap
  terdeteksi.

### Panduan instalasi di README

- Bagian "Instalasi" baru: cara CLI launcher, dari source, plus
  langkah per OS (Windows, Ubuntu/Linux).

### .gitignore minimal

- Hanya cache & artefak build yang di-ignore (`node_modules`, `.next`,
  `coverage`, `logs`, dsb); `docs/*` dan `.env` kini bisa di-add
  (repo private).

### Repo pindah + versi 1.5.0 (termasuk CLI)

- Git remote `origin` → `https://github.com/ch0c01dxyz/akanesia-router`.
- `package.json`: versi `0.5.91` → `1.5.0`.
- `cli/package.json`: name `9router` → `akanesia-router`, versi → `1.5.0`,
  bin → `akanesia-router`, description + keywords + license (Apache-2.0).
- Branding CLI yang terlihat user → "Akanesia-Gateway" (terminal UI,
  cliTools header, tray tooltip, autostart Name/Comment, pesan startup,
  badge npm di cli/README).
- `UPDATER_CONFIG` → install `npm i -g akanesia-router`.
- Process whitelist CLI mengenali kedua nama (transisi aman).
- SENGAJA tetap: data dir `~/.9router`, APP_NAME, `custom:9Router`,
  `9router-runtime`, has9Router.
- Semua referensi URL repo lama (`decolua/9router`) di kode, landing
  page, dan docs diganti ke `ch0c01dxyz/akanesia-router` (61 file).

### Rename project → akanesia-router / Akanesia-Gateway

- `package.json`: `name` `9router-app` → `akanesia-router`.
- Branding UI: `APP_CONFIG.name` "9Router Proxy" → "Akanesia-Gateway"
  (tampil di sidebar, footer, halaman profile); judul tab browser;
  halaman login; landing page; 34 file i18n literals + sinkronisasi
  ulang call-site `translate()` agar tidak ada key basi; README dan
  dokumentasi.
- Identifier fungsional SENGAJA dipertahankan demi kompatibilitas:
  prefix API key `sk_9router`, header `x-9router-*`, nama koleksi DB,
  localStorage keys, direktori `.9router`, dan nama entry "9Router"
  pada config cli-tools pihak ketiga.
- Verifikasi: ESLint 0 error baru (error react-hooks yang muncul
  pre-existing), production build sukses.

### Pengujian langsung 178 endpoint + perbaikan bug

- Sweep `GET` (+`POST {}` bila 405) ke seluruh route API: **0× 500**,
  auth gating benar (401/403), validasi 400 tepat, 405 tepat.
  Jalur inti: `POST /v1/chat/completions` tanpa key → 401 (30 ms),
  key salah → 401 (20 ms), body rusak → 400 (18 ms). Halaman:
  `/login` 200, `/dashboard` → 307 ke `/login`. Log dev bersih.
- **BUG-2 (fungsional, penting)** — `POST /api/v1/api/chat`
  (kompatibel Ollama): `transformToOllama`
  (`open-sse/utils/ollamaTransform.js`) menyamarkan SEMUA error
  menjadi HTTP 200 `{"message":{"content":""},"done":true}` —
  `flush()` selalu mengirim `done:true` dan status asli dibuang.
  Klien tidak bisa membedakan error dari sukses. Perbaikan: respons
  non-OK diteruskan apa adanya (status + body asli). Terverifikasi:
  tanpa key kini → 401 `{"error":{"message":"Missing API key",...}}`.
- **BUG-1 + PERF-3** — `GET /v1/models/[...model]` membangun SELURUH
  katalog (`buildModelsList`, ~0,5–1 dtk) hanya untuk lookup satu
  model / 404; `/v1/models` juga rebuild tiap request tanpa cache.
  Perbaikan (`src/app/api/v1/models/route.js`): cache module-level
  TTL 30 dtk per kombinasi kindFilter. Terverifikasi: `/v1/models`
  hit1 500 ms → hit2 17 ms; lookup 404 → 27–49 ms (dari ~700 ms).
- Verifikasi: ESLint 0 error pada file yang diubah. Tidak ada
  commit/push.

### Audit performa P8 + P11 — diterapkan
- **P8 — capped reader di jalur error non-SSE**
  (`open-sse/handlers/chatCore/streamingHandler.js`): `await
  providerResponse.text()` yang mem-buffer SELURUH body tanpa batas
  diganti `bacaBodyTerbatas()` — hanya 16 KB pertama yang dibaca, lalu
  stream di-cancel agar upstream berhenti mengirim. Sebelumnya upstream
  jahat/rusak bisa mengirim body "error" tak terbatas → memory
  exhaustion (undici `maxResponseSize` default `-1` = unbounded).
  Perilaku downstream tidak berubah: `<title>` tetap diekstrak,
  fail-open → string kosong. Terukur: body 5 MB dari 441 ms → 8 ms.
- **P11 — Agent keep-alive 60 dtk independen dari toggle warmup**
  (`src/lib/fillFirstWarmup.js`): `pasangDispatcherGlobal()` kini
  dipanggil SELALU di `jalankanWarmup()`, sebelum guard
  `fillFirstWarmupEnabled`. Toggle hanya mengendalikan traffic ping
  warmup, bukan pooling koneksi (jalur chat upstream di `base.js`
  memakai `proxyAwareFetch` tanpa dispatcher eksplisit → memakai
  dispatcher global). Terverifikasi via smoke test: request setelah
  idle 4,5 dtk — dispatcher default reconnect, Agent 60 dtk reuse.
  Efek nyata hanya saat warmup dimatikan + origin tanpa keep-alive
  hint (default warmup ON → perilaku tidak berubah).
- Verifikasi: ESLint 0 error/warning pada kedua file; helper P8 diuji
  langsung (body kecil utuh + title terekstrak, body 2 MB tepat
  16384 char dalam 2 ms, null body → `""`); mekanisme P11 diuji
  (reuse vs reconnect). Test unit `fill-first-warmup.test.js` gagal
  load karena alias `open-sse/` tidak ter-resolve di vitest —
  pre-existing (gagal identik dengan perubahan di-stash), di luar
  cakupan tugas ini. Production build: sukses (`npm run build`
  exit 0, postbuild standalone assets OK).
- Tidak ada commit/push.

### Merge provider OmniRoute — selesai (sisa 4 ID)

- Investigasi: dari 194 ID provider OmniRoute yang dulu belum ada, 190
  ternyata sudah masuk (152 diimpor 2026-09-29 + sisanya sudah ada dengan
  nama sama). Perbandingan nama ID saat ini hanya menyisakan 4:
  `devin`, `gitlab-duo`, `segmind`, `tinycms` — setelah dicek, 2 di
  antaranya false positive: `devin` sudah jadi alias di `devin-cli.js`,
  dan direktori `tinycms/` di OmniRoute sebenarnya ber-ID `tinycms-web`
  (sudah ada di 9router).
- **Baru: `segmind`** (`open-sse/providers/registry/segmind.js` +
  `open-sse/handlers/imageProviders/segmind.js`, terdaftar di
  `imageProviders/index.js`): provider image generation — 6 model
  (FLUX.1 Schnell/Dev/1.1 Pro, SDXL 1.0, SD 3.5 Large, Kandinsky 2.2).
  Wire shape terverifikasi dari sumber resmi 2026-09-30:
  `POST https://api.segmind.com/v1/{model}`, header `x-api-key`, body
  JSON `{prompt, aspect_ratio}`, respons raw image bytes → `b64_json`.
  Guard anti path-traversal pada model ID. Model video (wan/hunyuan/ltx/
  kling) belum diport — butuh verifikasi format async job dulu.
- **`gitlab.js`**: tambah `aliases: ["gitlab-duo", "gld"]` + 2 model dari
  entri `gitlab-duo` OmniRoute (`claude-sonnet-4-6`, `claude-haiku-4-5`).
  Tidak dibuat entri terpisah karena `gitlab` di 9router memang adalah
  layanan GitLab Duo yang sama (display name identik).
- `scripts/generate-registry-index.mjs` dijalankan ulang (320 entri).
- Verifikasi: ESLint 0 error, smoke test runtime (registry load,
  imageConfig, adapter URL/header/body, traversal guard) lolos.
  Tidak ada commit/push.

### Quick wins performa (dari audit 2026-09-30)

- **SSE anti-buffering** (`open-sse/utils/sseConstants.js`):
  `SSE_HEADERS_CORS` kini mengirim `X-Accel-Buffering: no` dan
  `Cache-Control: no-cache, no-transform` — melindungi TTFT/latency
  antar-token bila 9router di balik reverse proxy. Selaras dengan pola
  `SSE_HEADERS_NO_BUFFER` yang sudah ada.
- **Hapus import tak terpakai** (`open-sse/translator/index.js`):
  `AntigravityExecutor` hanya dipakai di komentar — modul + transitifnya
  (~449 ms waktu import) tidak lagi ditarik saat startup. Executor
  antigravity tetap terdaftar via lazy-load manifest.
- Verifikasi: ESLint lolos, `npm run build` sukses. Tidak ada commit/push.

### Batch 2 — lanjutan optimasi performa

- **Buffered async writer** (`open-sse/utils/requestLogger.js`):
  `appendProviderChunk` / `appendOpenAIChunk` / `appendConvertedChunk`
  tidak lagi `fs.appendFileSync` per chunk. Diganti class internal
  `BufferedChunkWriter`: satu `fs.WriteStream` per file log (lazy),
  antrean memori, flush pada ≥64 KB / ≥100 potong / 1 detik (timer
  di-`unref`), stream idle >60 detik ditutup otomatis, flush saat
  `beforeExit`/`SIGINT`/`SIGTERM`, dan fail-open total (logging tidak
  pernah melempar ke hot path). Format baris + nama file tidak berubah.
  Smoke test 1000 chunk: isi byte-identik. Test existing yang gagal
  terkonfirmasi pre-existing (resolusi alias `@/`, gagal juga di kode
  asli). ESLint lolos. Tidak ada commit/push.
- **`getSettings()` sekali per request** (`src/sse/handlers/chat.js`,
  `src/sse/services/auth.js`): settings dibaca 1× di awal `handleChat`,
  diteruskan sebagai parameter ke `handleSingleModelChat` (6 call site +
  2 rekursi combo) dan ke `getProviderCredentials` via
  `options.settings` (kompatibel mundur untuk 13 pemanggil lain).
  Penghematan: dari `2 + 2N` menjadi 1 panggilan per request
  (N = percobaan fallback). Jalur combo kini meneruskan
  `maxFallbacks` dari settings ke plumbing `combo.js` yang sudah ada.
  Koreksi verifikasi: guard batas fallback yang sempat ditambahkan agen
  di loop single-model saya revert — itu perubahan perilaku di luar
  lingkup refactor, bukan bagian instruksi.
- Verifikasi batch 2: ESLint lolos (3 file), `npm run build` sukses.
  Tidak ada commit/push.

### Batch 3 — sisa optimasi performa (2026-09-30)

- **Prefetch gambar paralel** (`open-sse/translator/concerns/prefetch.js`,
  `concerns/image.js`, `config/mediaConfig.js`): `prefetchRemoteImages`
  kini unduh paralel via worker pool (konkurensi 4, config-driven).
  Reuse Agent per hostname unik per sesi (bukan satu Agent global —
  lookup undici di-pin ke IP tervalidasi per hostname anti-TOCTOU, jadi
  satu Agent lintas hostname akan salah routing + melubangi SSRF guard).
  Urutan hasil deterministik, fail-open per gambar, timeout per gambar
  tetap. Smoke test: 4 gambar × 300ms selesai 347ms (vs ±1200ms serial).
  Test `prefetch-images` 7/7 lolos; 3 gagal di codex/image-fetch
  terkonfirmasi pre-existing (sandbox DNS). ESLint lolos.
- **Pool koneksi MITM + hygiene** (`open-sse/utils/proxyFetch.js`,
  `open-sse/config/runtimeConfig.js`): `createBypassRequest` tidak lagi
  buka socket + TLS handshake per request — kini satu undici `Agent`
  singleton dengan `connect.lookup` kustom (logika Google-DNS bypass
  pindah ke lookup, koneksi di-pool per origin dengan keep-alive).
  SNI = hostname asli dan validasi sertifikat tetap aktif (terverifikasi:
  self-signed ditolak). Implementasi lama dipertahankan verbatim sebagai
  fallback. Agent di-`close()` saat eviksi dari cache (batas 20 tetap);
  DNS cache dibatasi 500 entri (LRU, config-driven
  `MEMORY_CONFIG.dnsCacheMaxSize`), expiry tetap dihormati. Smoke test:
  10 request → 2 koneksi TCP (vs 10 handshake sebelumnya).
- **Dua metrik TTFT** (`open-sse/utils/stream.js`,
  `open-sse/handlers/chatCore/streamingHandler.js`): `latency.ttft` tetap
  (byte pertama dari upstream, dashboard kompatibel); baru
  `latency.ttftClient` (payload pertama benar-benar ke klien, diukur via
  pembungkus `enqueueKeKlien` di semua titik enqueue).
  `onStreamComplete` menerima argumen ke-4 opsional (backward compatible).
- **Fast path SSE** (`open-sse/utils/stream.js`): di mode passthrough,
  baris "bersih" (kriteria konservatif: chat chunk OpenAI tanpa
  tool_calls/usage/Azure/type/response, finish_reason null/absen, id
  valid, ada object+created, konten terbukti berharga) diteruskan mentah
  tanpa JSON.parse/re-encode; ragu sedikit pun → jalur lama. `[DONE]`,
  komentar, dan `event:` tetap byte-identik termasuk quirk duplikasi.
  Efek samping direplikasi (akumulasi konten via regex, reqLogger).
  Smoke test byte-identical 16 kasus + 36 test streaming existing lolos.
- **Lazy-load translator** (`open-sse/translator/index.js` + choke points):
  24 modul translator tidak lagi diimpor statis; dimuat on-demand via
  `TRANSLATOR_MANIFEST` (dynamic import + cache + singleflight, pola sama
  seperti lazy-load executor; fail-loud bila import gagal).
  `translateRequest`/`translateResponse` tetap sinkron (hot path per-chunk
  SSE tak tersentuh). Entry point async wajib preload dulu:
  `chatCore.js` (bypass + full pair via pivot), `src/sse/handlers/chat.js`
  (bypass claude-cli), `api/translator/translate/route.js`,
  `executors/github.js`. Audit side-effect: satu-satunya side-effect
  top-level adalah `register()` — aman dari circular-import deadlock.
  4 file yang masih ter-import langsung di tempat lain (rtk/headroom,
  nonStreamingHandler) adalah pre-existing dan aman karena `register()`
  idempotent. Test baru `tests/translator/lazy-load.test.js`: 8/8 lolos.
  Full suite translator: 950 lolos, 14 gagal terkonfirmasi pre-existing
  (uji A/B git stash menghasilkan 14 kegagalan identik dengan index.js
  original — berasal dari pekerjaan paralel lain, bukan perubahan ini).

### Ide #5c — Koreksi kontrak BazaarLink (hasil verifikasi harness lokal)

Verifikasi kontrak via agent harness lokal Egar (MCP browser, 19 item
A1–D19, laporan `laporan-verifikasi-bazaarlink.md`) menemukan 5 asumsi
implementasi yang salah. Diperbaiki via 3 agen paralel:

- **Auth BazaarLink opsional** (`src/app/api/probe/online/route.js`):
  endpoint publik tidak mewajibkan Bearer (7 run diterima tanpa auth);
  Bearer admin hanya untuk bypass rate limit. Blok 400
  "bazaarApiKey wajib diisi" dihapus; header `Authorization` hanya
  dikirim bila key tersedia (env `BAZAARLINK_API_KEY` atau input UI).
- **`upstreamFormat` eksplisit**: dipetakan dari `transport.format`
  registry (`claude` → `anthropic`, selainnya → `openai`).
- **Ownership polling** (`[runId]/route.js` + UI): start-run generate
  `pollToken` (`crypto.randomUUID()`), disimpan server-side, dikembalikan
  ke UI; route polling mewajibkan token via `?token=` / `x-poll-token`
  (403 bila salah, 404 bila runId tidak dikenal). Perbaiki bug
  "Bearer null" — header auth ke BazaarLink hanya bila key ada.
- **Render hasil dari `identityAssessment`** (`ProbeSection.js`):
  outer `status`, `verdict.status` (8 nilai kontrak dipetakan ke label
  Indonesia), `trueFamily`/`trueModel`/`confidence` dari verdict;
  null = "belum diketahui". Fallback defensif bila field tidak ada.
- **Microcopy biaya**: "84–86 request berbayar" → "84 tes standar +
  2 opsional; jumlah request dan biaya upstream bervariasi".
- Rate limit terverifikasi 30 run/IP/jam (per IP egress, key user tidak
  bypass); format 429 `retryAfterSeconds` + header `Retry-After`.
- ESLint lolos untuk ketiga file. Tidak ada commit/push.

## 2026-09-29

### Ide #1 — Lazy-load executor ✅

`getAdapter(id)` / `getExecutor(provider)` kini async; adapter di-load
on-demand via dynamic import, bukan 322 sekaligus saat startup.

- **Loader**: `open-sse/executors/index.js` ditulis ulang —
  `createAdapterLoader({ manifest, toFileUrl, importModule })` dengan cache
  `Map`, singleflight (in-flight dedupe), rejection tidak di-cache,
  fallback `DefaultExecutor` bila adapter spesialis gagal di-load.
- **Manifest**: `open-sse/executors/adapterDefs.js` (45 adapter spesialis) +
  `open-sse/executors/adapters.manifest.js` (322 id, auto-generate via
  `scripts/generate-registry-index.mjs`, di-import eager).
- **Registry**: generator menghormati 3 provider yang SENGAJA dinonaktifkan
  (`trae`, `devin-cli`, `windsurf`) — tidak ikut `registry/index.js`
  maupun manifest (319 aktif).
- **Build**: `next.config.mjs` `outputFileTracingIncludes` memastikan 76
  file executor ada di `.next/standalone` (terverifikasi).
- Semua call site produksi di-`await`; bulk check-models pakai
  `Promise.allSettled`.
- **Perbaikan audit**: `DefaultExecutor` pakai import relatif (alias `@/`
  tidak dikenal dynamic import Node); `probe.js` perbaiki
  `await getExecutor(...).execute(...)`; 4 file test di-`await`.
- Test: `executor-lazy-load.test.js` 7/7.

### Ide #2 — Warming koneksi fill-first ✅

Hilangkan penalti cold-start TLS pada request pertama ke provider aktif.

- **Modul**: `src/lib/fillFirstWarmup.js` — selective lazy warm: hanya
  provider AKTIF (koneksi aktif + muncul di `usageHistory` 7 hari terakhir).
- Ping ringan TANPA auth ke origin provider; concurrency ≤ 4, timeout
  10 dtk/request, deadline total 30 dtk, 1 retry berjitter hanya untuk
  timeout/429/503. Gagal = diam, boot tidak tertunda.
- **Anti-SSRF**: origin hanya dari `baseUrl` koneksi milik user / registry;
  hanya http/https; tidak pernah URL arbitrary.
- Satu undici `Agent` global (`keepAliveTimeout` 60 dtk) via
  `setGlobalDispatcher`, sekali saja, fail-open, hanya bila ON.
- **Toggle**: `fillFirstWarmupEnabled` (default ON) + kartu status di
  halaman Endpoint; OFF = nol traffic. Toggle ON berlaku langsung tanpa
  restart (`triggerFillFirstWarmup()` di `PATCH /api/settings`).
- Status di `/api/health`; singleton `globalThis` (HMR-safe).
- Test: `fill-first-warmup.test.js` 12/12.

### Ide #5c — Tab "Probe LLM" ✅

Cek keaslian LLM provider (asli vs masking) dari halaman detail provider.

- **Offline** (MVP): `open-sse/config/probe.js` + `open-sse/services/probe.js`
  — baterai 13 call (P1 identitas, P2 cutoff, P3 token, P4 streaming,
  P5 password n-gram, P6 satu-token JSD); JSD basis-2 ala
  llm-fingerprint-detector, skor ensemble n-gram ala whorl; verdict
  match/uncertain/mismatch/insufficient_data.
- **Online**: via BazaarLink Probe API — `POST /api/probe/online` +
  polling `[runId]`; 429 diteruskan + countdown UI tanpa auto-retry.
- **Nol-secret**: klien hanya kirim `connectionId`; key diselesaikan
  server-side; field sensitif di-strip rekursif dari hasil polling;
  `pesanAman()` redact pola secret di error; `bazaarApiKey` hanya di
  memori (maks 35 menit).
- **Key BazaarLink**: `BAZAARLINK_API_KEY` di `.env` dibaca server-side
  sebagai default; input manual di UI kini opsional (kosong = pakai key
  server).
- **UI**: `ProbeSection.js` (sub-tab Offline/Online), `SearchableSelect.js`,
  `MetricCard.js`, `ProbeGroupRow.js`, `WarningList.js`; seluruh literal
  ikut `translate()` (54 entri baru `id.json`).
- Fingerprint referensi: struktur + loader siap; fingerprint empiris
  `infoapi/space-bunny-free.json`, `bariska/deepseek-v4.1-flash.json`,
  `bariska/mimo-v2.6-flash.json`, `dahl/MiniMaxAI_MiniMax-M2.7.json`, dan
  `atria/Atria-Dawn-Preview.json` (parsial — 11/13 call gagal), dan
  `tokenharbor/deepseek-v4.1-flash:free.json`, dan
  `aipixel/gpt-5.6-luna.json`, dan `anthropic/claude-sonnet-5-5.json`
  (fingerprint RESMI pertama dari api.anthropic.com) dikumpulkan dari run
  live 2026-09-29 (kalibrasi awal, 3 sampel/cell).
- Live-test 2026-09-29: deepseek-v4.1-flash (13/13 call, billing_anomaly;
  identitas bingung "ChatGPT?", reasoning bocor ke jawaban), mimo-v2.6-flash
  (12/13 call, billing_anomaly + backend_rotation + 1 call gagal; identitas
  bersih "MiMo/Xiaomi", cutoff 2025-01; satu jawaban P6 mengandung teks injeksi
  promosi dengan homoglyph Cyrillic), dahl DeepSeek-V4-Flash-0731 (13/13 gagal
  — HTTP 429 concurrency capacity, akun berbayar didahulukan), dahl
  MiniMax-M2.7 (9/13 call, backend_rotation + 4 call gagal; tag <think>
  bocor ke semua jawaban), atria Atria-Dawn-Preview (2/13 call berhasil,
  11 call gagal — endpoint tidak stabil; identitas "Atria by Shanghai AI Lab"),
  tokenharbor deepseek-v4.1-flash:free (12/13 call, billing_anomaly + 1 call
  gagal; P5 mengembalikan password IDENTIK 3x berturut-turut pada temperature
  1.0 — indikasi kuat temperature diabaikan / response di-cache), aipixel
  gpt-5.6-luna (12/13 call, billing_anomaly + backend_rotation + 1 call gagal;
  P1 mengklaim "OpenAI o3", P2 cutoff 2024-06 — pola masked identity claim),
  anthropic claude-sonnet-5-5 (13/13 call ke endpoint RESMI api.anthropic.com;
  temperature deprecated → 400 bila dikirim; P1 "I'm Claude, made by Anthropic";
  P2 cutoff ~2025-01; thinking menghabiskan budget max_tokens pada P2/P6-angka).
- Test: `probe-*.test.js` 50 passed, 1 skipped.
- **Batasan jujur**: P5/P6 butuh lebih banyak sampel untuk baseline final;
  kontrak BazaarLink belum terverifikasi penuh.

### Ide #7 — Tab "Replay" di Console Log ✅

Ulangi request upstream yang gagal untuk debugging, tanpa membuat ulang
dari klien.

- **Buffer**: `src/lib/requestReplayBuffer.js` — ring buffer in-memory
  singleton (`globalThis`, HMR-safe), tidak di-persist. Kapasitas berbasis
  byte dari setting `replayLogMaxBytes` (default 5 MB), drop-oldest,
  tidak pernah melewati batas. Fail-open: `captureReplayEntry` tidak
  pernah throw.
- **Redaksi saat capture (fail-closed)**: header sensitif
  (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`,
  `proxy-authorization`) → `[REDACTED]`; key JSON sensitif
  (`password`, `secret`, `access_token`, `refresh_token`, `api_key`,
  `apikey`, `client_secret`) rekursif case-insensitive; query param URL
  sensitif di-redact; custom header ide #8 di-redact via
  `redactCustomHeaders`; **nilai secret aktual** dari credentials
  (`apiKey`, token OAuth, value custom header) disapu dari free-text
  body/response/error agar gema upstream tidak bocor. Body truncate
  ~64 KB, response ~8 KB.
- **Capture**: hook di `open-sse/handlers/chatCore.js` — hanya request
  upstream yang GAGAL (status ≥ 400 / network error / exception); abort
  klien (499) tidak di-capture. Body yang disimpan adalah
  `translatedBody` (format provider).
- **API**: `GET /api/replay-log` (daftar + statistik; selaraskan cap dari
  setting), `DELETE /api/replay-log` (clear),
  `POST /api/replay-log/[id]/replay` (body opsional `{ body }` untuk edit
  sebelum kirim; resolve koneksi tersimpan server-side via
  `getProviderCredentials` + `preferredConnectionId`; **409 bila koneksi
  asal tidak tersedia** — tidak pernah fallback diam-diam ke akun lain;
  eksekusi via executor yang sama, non-streaming, timeout 90 dtk).
- **UI**: `ConsoleLogClient.js` jadi container tab config-driven
  (`TABS`: Logs, Replay) ala #5b; `ConsoleLogsTab.js` diekstrak verbatim
  dari kode lama; `ReplayTab.js` baru — tabel entry (waktu,
  provider/model, method+path, badge status, latensi), expand detail
  (header ter-redact, body, response), edit body sebelum replay, tombol
  Replay/Clear (konfirmasi), pengaturan kapasitas MB → `PATCH
  /api/settings`, polling 15 dtk.
- **Penyimpangan sadar**: capture hanya yang gagal (bukan tiap request);
  body replay as-is mengirim `[REDACTED]` bila secret asli sudah
  di-redact (trade-off keamanan yang disengaja).
- **Verifikasi**: test `request-replay-buffer` 24/24 (termasuk uji
  adversarial: tidak ada secret di entry mana pun), ESLint bersih,
  regresi chatCore 20/20, full `npm run build` lulus. Tiga temuan
  verifikasi diperbaiki: custom header ide #8 belum ter-redact di buffer,
  secret free-text lolos redaksi, URL relatif ber-query tidak ter-redact.

### Ide #6 — Check Models terjadwal ("Auto Sync") ✅

Check Models berjalan otomatis berkala untuk provider yang di-ON-kan user.

- **Scheduler**: `src/lib/checkModelsAutoSync.js` — recursive `setTimeout`
  (self-scheduling; jadwal berikutnya dipasang setelah tick selesai, tanpa
  overlap by construction) + flag anti-overlap lapis 2. Singleton
  `globalThis` agar HMR tidak menggandakan. Timer `unref()`, clamp delay
  1 dtk – 2³¹−1 ms (anti overflow). Tiap tick baca settings fresh
  (`autoSyncProviderIds`, `checkModelsTtlSeconds`); tidak ada provider ON
  atau TTL ≤ 0 → skip run tapi tetap jadwalkan ulang. Concurrency
  antar-provider 3 (`Promise.allSettled` per batch), try/catch
  sekeliling tick — fail-open. Tick pertama 60 dtk setelah start.
- **Reuse**: route `check-models` mengekspor `checkProviderModels()` —
  dipakai route POST dan scheduler (tanpa duplikasi logika
  fetch/timeout). Scheduler memanggil dengan `forceRefresh: true`;
  hasil ditulis ke cache ide #3 (satu sumber data).
- **Boot**: `startAutoSync()` dipanggil di `initializeApp()` →
  `runHeavyStartup()` (server-side only; dynamic import + catch).
- **UI**: radiobox "Auto Sync" ON/OFF di kanan header section "Available
  Models" (halaman detail provider). Toggle PATCH `/api/settings`
  (`autoSyncProviderIds`); scheduler membaca settings fresh tiap tick
  jadi tidak perlu restart.
- **Setting**: `autoSyncProviderIds: []` (default) di settingsRepo.
- **Verifikasi**: test `check-models-autosync` 13/13, regresi
  `check-models-cache` 9/9, ESLint bersih, full `npm run build` lulus.
  Kriteria terima terpenuhi: ON → refresh berkala tanpa duplikasi run;
  OFF → tidak ada timer; HMR → singleton.

### Ide #5b — Tab "Compare" di Playground ✅

Bandingkan 2–3 model provider dalam satu prompt, side-by-side.

- **Struktur**: `PlaygroundSection.js` ditulis ulang jadi container tab
  config-driven (`TABS`: Test, Compare) — tab "Probe LLM" (ide #5c)
  tinggal tambah entri. Props ke `page.js` tidak berubah.
- **Baru**: `playgroundUtils.js` (helper bersama: `buildAvailableModels`,
  `hasActiveConnection`, `formatMs`, `parseSsePayload`,
  `streamChatCompletion` — satu pipeline SSE untuk kedua tab),
  `usePlaygroundApiKey.js` (auto-load + auto-provision key),
  `PlaygroundTestTab.js` (ekstrak dari kode lama; perilaku 100% sama),
  `PlaygroundCompareTab.js`.
- **Compare**: 3 select model (2 wajib + 1 opsional, maks 3, duplikat
  dicegah), satu prompt (Ctrl+Enter), fan-out paralel
  (`Promise.allSettled`, AbortController per kolom), kolom responsif
  side-by-side, statistik TTFT/latensi/token per kolom + tabel
  ringkasan. Token dari server sudah termasuk buffer internal —
  ditampilkan apa adanya. Berhenti → status kolom "Stopped".
- **Verifikasi**: test `playground-utils` 15/15, ESLint bersih,
  full `npm run build` lulus. Satu temuan verifikasi (kolom di-stop
  tampil "Done") diperbaiki.

### Ide #4 — Fill-first sadar kuota ✅

Visibilitas kegagalan kuota/error per koneksi+model di dashboard — **tanpa
pemblokiran/cooldown** (lokal & intranet). Setiap request tetap mencoba
koneksi sesuai urutan strategy; threshold hanya mengatur kapan insiden
muncul di dashboard.

- **Klasifikasi**: `open-sse/config/quotaErrorClasses.js` (baru) —
  `classifyQuotaError(status, errorText)` pure & config-driven:
  `rate_limited` (429/503/504), `overloaded` (529), `quota_exhausted`
  (402 / 429 ber-body quota), `auth_error` (401/403 kredensial),
  `policy_refusal` (403 content-policy / safety — tidak dihitung),
  `server_error` (500/502), `payload_error` (400/404/… — tidak dihitung),
  `ignored` (499). Nuansa OpenRouter `limit_source` didukung.
- **Counter**: `src/sse/services/quotaIncidents.js` (baru) — in-memory per
  `connectionId|model`, HMR-safe, fail-open. Hook di baris pertama
  `markAccountUnavailable`/`clearAccountError` (`src/sse/services/auth.js`)
  — choke point semua handler. Sukses sekali → counter reset + entri
  dashboard terhapus (request biasa, agent harness, test provider).
- **Guard dalam-request**: cycle guard (satu koneksi/model tidak dicoba 2×
  per request) + batas kedalaman fallback `quotaMaxFallbacks` (default 5)
  di `open-sse/services/combo.js` dan loop `while(true)`
  `src/sse/handlers/chat.js`. Perilaku retry/fallback existing tidak diubah.
- **Dashboard**: card "Insiden Kuota & Error" di bawah card API keys
  (`EndpointPageClient.js`) — tabel provider–model–error terakhir (×N)–
  tanggal/waktu + legenda warna (🟡 429/503/529, 🔴 401/403/402,
  🟠 500/502/504, 🟣 kuota habis). API `GET /api/quota-incidents`.
- **Persistensi**: tabel `quota_incidents` (SQLite, `SCHEMA_VERSION` 1→2,
  migrasi additive) — tahan restart. Setting baru `quotaFailureThreshold`
  (default 3, rentang 1–10) dan `quotaMaxFallbacks` (default 5).
- **Test**: `quota-error-classes` 21/21, `quota-incidents-repo` 5/5
  (SQL asli via node:sqlite), `combo-routing` 5/5; regresi
  `auth-status`, `fetch-success-clears-account`, `combo-fusion` lulus.
- **Diperbaiki saat verifikasi**: 4 test bogus (impor fungsi yang tidak ada
  di `combo.js`) diganti 1 test valid; inkonsistensi model-null
  (counter naik tapi dashboard tidak persist) dinormalisasi ke `""`.
- **Diketahui**: `server_error` ikut menaikkan counter (penyimpangan sadar —
  tanpanya legenda oranye mati); 2 gagal di
  `combo-autoswitch.test.js` adalah pre-existing (terverifikasi via stash).
- **Tambahan 2026-09-29**: jalur Antigravity quota kini masuk dashboard —
  `handleAntigravityQuotaError()` memanggil `recordFailure`
  (`quota_exhausted`, langsung tampil) saat strike ke-3 (blokir 15 mnt)
  maupun upstream exhausted (`resetAt`). Test
  `antigravity-quota-incidents` 3/3.

### Ide #8 — Advanced Option provider custom ✅

Custom header per provider OpenAI/Anthropic-compatible (`x-api-key`,
`Authorization`, dsb.) dengan placeholder `{{key}}` → API key koneksi.

- **UI**: `CustomHeadersEditor.js` (baru) — section "Advanced Option",
  collapsed default, editor key-value + preset
  (`Authorization: Bearer {{key}}`, `x-api-key`, `X-API-Key`, `xi-api-key`).
  Dipakai di `AddCompatibleModal` dan `EditCompatibleNodeModal`;
  tombol Check ikut memakai custom headers.
- **Util**: `src/shared/utils/customHeaders.js` (baru) — validasi nama
  header (RFC 7230 token, maks 20 header), `applyCustomHeaders`
  (custom menang atas header default, resolve `{{key}}`),
  `redactCustomHeaders`.
- **Simpan**: `customHeaders` di `providerNodes.data` → snapshot ke
  `connection.providerSpecificData.customHeaders` (create, update,
  propagasi PUT). Tanpa migrasi schema.
- **Runtime**: `DefaultExecutor.buildHeaders()` menerapkan custom header
  paling akhir (choke point — semua compatible provider mewarisi).
- **Log**: value custom header di-redact di request log
  (`4_req_target.json`) dan DB log — tidak bocor ke file log.
- **Test**: `tests/unit/custom-headers.test.js` 6/6 lulus; 17 assertion
  util lulus.

### Ide #3 — Cache hasil Check Models ✅

Hasil `GET /models` per provider di-cache (TTL + SWR-lite) agar tidak
fetch berulang.

- **Cache**: `src/lib/checkModelsCache.js` (baru) — in-memory Map HMR-safe
  (`globalThis` singleton). Fresh (umur < TTL) → langsung dari cache;
  stale → data basi + background refresh (singleflight); miss → fetch
  singleflight (request konkuren = 1 fetch upstream). TTL efektif =
  setting ± jitter 60 dtk (min 1 dtk). TTL 0 = bypass total.
  Hanya hasil `ok:true` yang di-cache.
- **Setting**: `checkModelsTtlSeconds` (detik, default 3600, 0 = mati)
  di `settingsRepo`.
- **API**: `POST /api/providers/check-models` — lapisan
  `checkProviderWithCache`; hasil dari cache ditandai `cached: true`
  (aditif, UI lama kompatibel); body `forceRefresh: true` = invalidate
  lalu fetch segar (hasil ikut tersimpan). Timeout 15 dtk & concurrency 5
  tidak berubah.
- **UI**: tombol Check per provider mengirim `forceRefresh: true`
  (obat data basi selain TTL); tombol Check-all memakai cache
  (klik ulang dalam TTL tanpa hit network).
- **Test**: `tests/unit/check-models-cache.test.js` 9/9 lulus.

### Hasil verifikasi gabungan

- `node --check`: semua file baru/ubah OK.
- ESLint: file baru 0 problem; error yang tersisa pre-existing
  (pola `set-state-in-effect` yang disengaja, konvensi AGENTS.md #10).
- Vitest: 15/15 lulus (`custom-headers` + `check-models-cache`).
- 1 test gagal pre-existing & tidak terkait
  (`claude-header-forwarding` — timeout network, gagal juga di tree bersih).
