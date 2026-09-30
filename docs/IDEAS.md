# Bank Ide akanesia-router — Spesifikasi Teroptimasi

> Setiap ide di bawah ditulis ulang sebagai spesifikasi siap-implementasi:
> tujuan → konteks → spesifikasi detail (hasil riset + revisi Egar) →
> titik integrasi kode → aturan repo yang relevan → kriteria terima.
> Bahasa: Indonesia. Status: 💡 mentah · 🔄 revisi/diskusi · ❌ dibuang · ✅ selesai
> >
> Terakhir diperbarui: 2026-09-29 (hasil riset web + diskusi Egar).
> Status 📝 = DRAFT (diparkir, perlu diskusi lanjut sebelum diimplementasi).

---

## 1. Lazy-load executor ✅

**Implementasi 2026-09-29 (selesai, terverifikasi):**

- `open-sse/executors/index.js` ditulis ulang: `getAdapter(id)` dan
  `getExecutor(provider)` kini **async** (cache `Map` + singleflight
  in-flight + fallback `DefaultExecutor` bila adapter spesialis gagal).
- Baru: `adapterDefs.js` (definisi 45 adapter spesialis),
  `adapters.manifest.js` (322 id → file, auto-generate).
- Generator `scripts/generate-registry-index.mjs` diperluas; menghormati
  3 provider yang SENGAJA dinonaktifkan (trae, devin-cli, windsurf) —
  tidak ikut registry maupun manifest.
- Semua call site produksi di-`await`; bulk check-models memakai
  `Promise.allSettled`.
- Perbaikan audit: `DefaultExecutor` memakai import relatif (alias `@/`
  tidak dikenal dynamic import Node); `open-sse/services/probe.js`
  perbaiki `await getExecutor(...).execute(...)` yang salah.
- Test: `executor-lazy-load.test.js` 7/7; build lulus; 76 file executor
  terkonfirmasi ada di `.next/standalone`.

**Tujuan:** Potong waktu startup dan pemakaian memori dengan hanya me-load
executor provider yang benar-benar dipakai, bukan 322 sekaligus.

**Konteks (hasil riset):**

- Pola tervalidasi: **manifest statis + metadata ringan eager + executor lazy**
  via `import()` ter-cache dengan *in-flight dedupe* (singleflight — banyak
  request konkuren ke adapter yang sama berbagi satu Promise; rejection tidak
  di-cache agar bisa retry).
- Prior art (ExpressoTS): startup 2500 ms → 1200 ms (−52%), memori 450 MB →
  280 MB (−38%); biaya first-request hanya +50–200 ms sekali per modul.
  Estimasi kasar untuk 322 adapter: \~1,5–3 detik startup (perlu diukur di
  mesin target sebelum diklaim).

**Spesifikasi:**

- Script `generate-registry-index.mjs` diperluas menghasilkan
  `adapters.manifest.js`: peta `id → path file` + metadata ringan untuk UI
  (di-import eager).
- Akses executor lewat `getAdapter(id)`: cache `Map` + dedupe promise
  in-flight + `try/catch` per-adapter (satu adapter gagal ≠ registry mati).
- Adapter **tetap di disk, di luar bundle**: pakai escape hatch
  `/* turbopackIgnore: true */` / `/* webpackIgnore: true */` pada dynamic
  import agar Turbopack/webpack tidak mem-bundle 322 file (server akanesia-router
  lokal long-running, bukan serverless — load native oleh Node aman).
- Dynamic import memakai **file URL** (`pathToFileURL`), bukan path mentah;
  ekstensi wajib ditulis.
- Larangan: **top-level await di adapter** (siklus + TLA = deadlock,
  Node 22+ exit code 13). Jaga adapter sebagai *leaf module* (cek
  `madge --circular`).
- Jalur bulk ("Check all model") memakai `Promise.allSettled`, bukan
  `Promise.all`.

**Titik integrasi:**

- `open-sse/executors/index.js` (pendaftaran executor — RULES: wajib daftar
  di sini)
- `scripts/generate-registry-index.mjs` (perluas output manifest)
- `open-sse/providers/registry/` (sumber manifest; JANGAN edit
  `registry/index.js` manual)

**Aturan relevan:** AGENTS.md § "Menambah kapabilitas" (pola executor);
RULES.md (regen index, `node --check`, test baseline bila menyentuh
registry/alias).

**Kriteria terima:** startup terukur lebih cepat di mesin target; request
pertama ke provider yang belum di-load berhasil dengan penalti < 500 ms;
satu adapter corrupt tidak mematikan server.

---

## 2. Warming koneksi fill-first ✅

**Implementasi 2026-09-29 (selesai, terverifikasi):**

- Baru: `src/lib/fillFirstWarmup.js` — selective lazy warm: hanya provider
  AKTIF (koneksi aktif + terlihat di `usageHistory` 7 hari terakhir).
- Ping ringan TANPA auth ke origin provider (GET origin, bukan path);
  concurrency ≤ 4, timeout 10 dtk/request, deadline total 30 dtk,
  1 retry berjitter hanya untuk timeout/429/503. Gagal = diam.
- Anti-SSRF: origin hanya dari `baseUrl` koneksi milik user / registry;
  hanya skema http/https.
- Satu undici `Agent` global (`keepAliveTimeout` 60 dtk) via
  `setGlobalDispatcher`, dipasang sekali, fail-open, hanya bila ON.
- Toggle `fillFirstWarmupEnabled` (default ON) di pengaturan + kartu
  status di halaman Endpoint; OFF = nol traffic warmup.
- Toggle ON berlaku langsung tanpa restart (via `triggerFillFirstWarmup()`
  di `PATCH /api/settings`).
- Status terekspos di `/api/health`; singleton `globalThis` (HMR-safe).
- Test: `fill-first-warmup.test.js` 12/12.

**Tujuan:** Hilangkan penalti cold-start (DNS + TCP + TLS ≈ 4 RTT, \~30–360 ms)
pada request pertama ke provider aktif.

**Konteks (hasil riset):**

- Node 19+: `https.globalAgent` sudah `keepAlive: true` default; `fetch`
  bawaan (undici) punya `keepAliveTimeout` default 4000 ms.
- Request kedua di koneksi keep-alive yang sama bisa \~3× lebih cepat
  daripada koneksi fresh.
- Jebakan: *thundering herd* (warming 322 provider serentak), *retry storm*,
  warming menghabiskan kuota rate-limit provider, soket idle tidak di-reap
  (undici HTTP/2), warmup gagal tidak boleh memblokir boot.

**Spesifikasi (revisi Egar: ON/OFF di pengaturan):**

- Strategi: **selective lazy warm, bukan blanket pre-warm** — hanya provider
  **aktif** (ditandai default/aktif + terlihat dipakai N hari terakhir dari
  log SQLite), bukan 322 koneksi.
- Warmup = 1 ping ringan (`GET /models` atau endpoint termurah) *setelah*
  server listen, non-blocking: concurrency ≤ 4, timeout 10 dtk/request,
  deadline total 30 dtk, maks 1 retry berjitter hanya untuk transient
  (timeout/429/503). Gagal = `.catch()` diam-diam, boot tetap lanjut.
- Token refresh hanya jika token dekat expired (proaktif di \~80% umur token),
  bukan membabi buta saat boot.
- Satu undici `Agent` global via `setGlobalDispatcher` dengan
  `keepAliveTimeout` \~60 dtk (cocok untuk pola single-user dengan jeda
  antar-request bermenit-menit).
- Pengaturan: toggle **ON/OFF** (default ON; scope "provider aktif" membuat
  biaya nyaris nol). Status warming terekspos di endpoint health internal.

**Titik integrasi:**

- `src/lib/db/repos/settingsRepo.js` (tambah key setting, ikut pola
  `DEFAULT_SETTINGS`)
- `src/shared/services/initializeApp.js` / `bootstrap.js` (jadwal warmup
  setelah listen)
- `src/sse/services/auth.js` (pemilihan koneksi fill-first yang di-warm)

**Aturan relevan:** RULES.md (jangan ubah `custom-server.js`/`src/proxy.js`
tanpa analisis keamanan — warmup hanya ke origin provider yang sudah
terdaftar user, bukan URL arbitrary = anti-SSRF).

**Kriteria terima:** dengan toggle ON, request pertama ke provider aktif
tidak membayar penalti TLS penuh; toggle OFF = tidak ada traffic warmup
sama sekali; boot tidak pernah tertunda oleh warmup yang gagal.

---

## 3. Cache hasil Check Models ✅

**Tujuan:** Hasil `GET /models` provider tidak di-fetch berulang; UI responsif
tanpa menunggu network setiap buka halaman.

**Konteks (hasil riset):**

- Strategi: **TTL polos + SWR-lite** — `fresh` (age < TTL) jawab langsung;
  `stale` jawab data basi sambil trigger background refresh (singleflight).
  Penalti latensi kecil karena request datang dari server sendiri.
- Penyimpanan: **in-memory Map/LRU primer** (lookup mikrodetik, \~30 baris
  kode); SQLite tahap 2 hanya bila warm-start antar-restart terbukti
  dibutuhkan. Payload daftar model kecil (KB).
- Anti-overlap dua lapis: flag `isSyncing` (skip-if-running, `finally` wajib)
- promise singleflight per `providerId` (cegah cache stampede).
- **TTL jitter ±60 dtk** agar expiry antar-provider tidak serentak.
- Jebakan Next.js dev: timer level modul terduplikasi saat HMR → simpan
  scheduler di `globalThis` singleton. Timer pakai `unref()` agar tidak
  menahan proses exit (test/CLI).

**Spesifikasi (revisi Egar: TTL dalam detik, default 3600):**

- Pengaturan `checkModelsTtlSeconds` (detik, default **3600**).
- Jika `checkModelsTtlSeconds&#32;**0**&#32;maka fitur ini dinyatakan mati atau dinonaktifkan.`
- Entry cache: `{ providerId, models, fetchedAt, latencyMs, status }`.
- Tombol refresh manual per provider + invalidasi per provider tetap ada
  (obat data basi selain TTL).

**Titik integrasi:**

- `src/app/api/providers/check-models/route.js` (tambah lapisan cache di
  mode `all`/`provider`; timeout 15 dtk & concurrency 5 tetap)
- `src/lib/db/repos/settingsRepo.js` (key TTL baru)

**Kriteria terima:** buka halaman provider 2× beruntun → request kedua tanpa
hit network (selama TTL); request konkuren saat cache expired hanya memicu
1 fetch upstream; HMR tidak menggandakan timer.

---


**Status implementasi (2026-09-29):** selesai, belum dikomit.

- `src/lib/checkModelsCache.js` (baru): in-memory Map HMR-safe
  (`globalThis` singleton), strategi SWR-lite (fresh → langsung; stale →
  data basi + background refresh singleflight; miss → fetch singleflight),
  TTL efektif = setting ± jitter 60 dtk (clamp min 1 dtk), TTL 0 = bypass.
  Hanya `ok:true` yang di-cache.
- `src/lib/db/repos/settingsRepo.js`: `checkModelsTtlSeconds` default 3600.
- `src/app/api/providers/check-models/route.js`: lapisan
  `checkProviderWithCache`; hasil cache ditandai `cached: true` (aditif);
  body `forceRefresh: true` = invalidate lalu fetch segar (ikut tersimpan).
  Timeout 15 dtk & concurrency 5 tidak berubah.
- UI: tombol Check per provider mengirim `forceRefresh: true` (obat data
  basi); tombol Check-all memakai cache (klik ulang dalam TTL tanpa network).
- Test: `tests/unit/check-models-cache.test.js` 9/9 lulus.

---

## 4. Fill-first sadar kuota ✅

> **SELESAI (2026-09-29)** — hasil diskusi dengan Egar, dikerjakan via orchestration + verifikasi mendalam Merlin.
> Keputusan final: **tanpa pemblokiran/cooldown koneksi** — berjalan lokal & intranet, cukup visibilitas dashboard + fallback dalam-request. ✅

**Tujuan:** Fill-first pindah akun *sebelum* request gagal berulang karena kuota — tanpa bergantung pada satu format sinyal provider, dan tanpa false-positive dari kegagalan sesekali. Sistem tidak memblokir koneksi apa pun; ia hanya mencatat dan menampilkan.

### 4.1. Konteks riset

**Sinyal tiap provider berbeda-beda:**

| Provider | Status | Sinyal |
| --- | --- | --- |
| OpenAI | 429 | `x-ratelimit-remaining-*`, `retry-after-ms` (hanya saat 429); **kuota billing habis = `insufficient_quota` (tetap 429!)** |
| Anthropic | 429 / **529** (overloaded) | `retry-after`, `x-ratelimit-*` / `anthropic-ratelimit-*`; 529 = kapasitas platform, 429 = kuota organisasi |
| Gemini | 429 | umumnya **tanpa header**; body `RESOURCE_EXHAUSTED`; kadang `RetryInfo.retryDelay` di body |
| OpenAI-compatible generik | 429 | bervariasi; banyak **tanpa header sama sekali** |
| OpenRouter | 429 / **402** (saldo) / 503 | 402 dibedah via `error.metadata.limit_source`; 403 bisa berarti guardrail/moderation, bukan cuma auth |

**Temuan kunci riset (2026-09-29) dan statusnya di desain ini:**

| # | Temuan | Status |
| --- | --- | --- |
| 1 | Threshold 3 selaras praktik: LiteLLM `allowed_fails` default **3**, komunitas 3–5, contoh Fowler **5**, Polly **5** | ✅ Dipakai — default threshold = 3 |
| 2 | 429 OpenAI ada 3 rasa: `rate_limit_reached` (tunggu) vs `insufficient_quota` / `credit_balance_exhausted` (**saldo habis — failover, bukan tunggu**) | ✅ Dipakai — bedah body 429 sebelum klasifikasi |
| 3 | 403 wajib dipecah (OpenRouter): `permission_denied` (auth) vs `content_policy_violation` / `refusal` (**safety → bukan kegagalan koneksi**) | ✅ Dipakai — kelas `policy_refusal` |
| 4 | Vertex AI default retry **tidak mencakup 499** (client closed) | ✅ Dipakai — 499 diabaikan |
| 5 | Guard ganda LiteLLM: `max_fallbacks = 5` + shared attempted-targets set (cycle guard) | ✅ Dipakai — sebagai proteksi loop dalam-request |
| 6 | Backoff linear / jitter / `Retry-After` / cooldown panjang untuk kuota harian | ➖ Tidak dipakai — disederhanakan: tanpa blokir/cooldown (lokal & intranet) |

Sumber: AWS Architecture Blog (backoff + jitter), Martin Fowler (circuit breaker), dokumentasi routing LiteLLM, OpenRouter errors API reference, panduan resmi OpenAI / Anthropic / Vertex AI.

### 4.2. Keputusan diskusi Egar (final)

1. **Threshold kegagalan (anti false-positive).** Koneksi **ditandai bermasalah** (masuk daftar dashboard) setelah gagal **N kali berturut-turut** — bukan 1× langsung, karena user sering me-retry berkala dan blip sesekali bukan sinyal kuota. Default **N=3**, **dapat dikustomisasi via pengaturan** (rentang usulan 1–10). Counter **reset saat ada 1 request sukses** (pola Fowler). Scope counter: **per koneksi + model** — selaras dengan key `connectionId|model` pada strike-breaker yang sudah ada di `src/sse/services/antigravityQuota.js`, dan cocok dengan kolom model di tabel dashboard.
2. **Tanpa pemblokiran / tanpa cooldown.** Berjalan lokal & intranet — tidak perlu mekanisme blokir koneksi. Threshold hanya mengatur **visibilitas** (kapan masuk dashboard), bukan kapan koneksi di-skip. Setiap request selalu mencoba koneksi sesuai urutan strategy; tidak ada `cooldownUntil`, tidak ada backoff, tidak ada half-open probe.
3. **Dashboard error (visibilitas).** Card sendiri di dashboard **Endpoint & Key, di bawah card API keys**. Isi: tabel **provider – model – error terakhir – tanggal/waktu error**, **berwarna sesuai status-code errornya** (legenda warna di §4.5). Hanya menampilkan model yang error/limit (tidak ada daftar "sehat"). Saat user test model itu lagi (agent harness / detail provider) dan **sukses → otomatis hilang dari daftar**. Kapan kuota reset → user cek sendiri (kasus provider lokal "unlimited" semu: biasanya reset 1–3 hari).
4. **Quota Tracker: biarkan apa adanya.** Hasil perbandingan 2026-09-29: milik akanesia-router lebih baik & lengkap (menu `/dashboard/quota`, ~24 provider, endpoint resmi, auto-ping, strike-breaker) dibanding OmniRoute (fokus ke alokasi biaya/burn-rate, bukan pantau kuota). Tidak ada yang diport.
5. **Provider-level (non-combo): ikuti strategy setting yang sudah ada.** Tidak ada semantik baru — quota-aware hanya menjadi **lapisan klasifikasi + counter** di bawah strategy: fallback (try in order), round-robin (rotate), fill-first (exhaust in order, **mentok bawah → balik ke atas**, lalu berurutan lagi), fusion (panel+judge). Strategy mengatur urutan coba; klasifikasi mengatur pencatatan. Berlaku di lapisan combo maupun provider-level dengan modul klasifikasi yang sama.

### 4.3. Klasifikasi error (config-driven)

Acuan: tabel status code LLM lampiran Egar (`workspace/user/files/llm_api_status_codes.svg`) + temuan riset. Mapping wajib di `open-sse/config/` (config-driven, DRY — jangan hardcode di executor; selaras `ERROR_RULES` di `open-sse/config/errorConfig.js`).

| Kelas internal | Status / sinyal | Perilaku |
|---|---|---|
| `rate_limited` (sementara) | 429 murni (`rate_limit_exceeded` / `slow_down`), 503, 504 | naikkan counter → threshold → masuk dashboard; fallback dalam-request tetap jalan |
| `overloaded` (sementara) | 529 (Anthropic), 429-upstream | sama seperti `rate_limited` |
| `quota_exhausted` (permanen) | 402 (saldo habis — bukan `in_flight_budget`), 429 yang bodynya mengandung `quota` / `insufficient_quota` / `credit_balance_exhausted` | langsung masuk dashboard (tanpa tunggu threshold); koneksi **tetap dicoba** tiap request sesuai urutan |
| `auth_error` | 401, 403 `permission_denied` / entitlement | langsung masuk dashboard, **jangan retry, jangan hitung counter** |
| `policy_refusal` (hasil riset) | 403 `content_policy_violation` / `refusal`, safety block (mis. Gemini `SAFETY`) | no-retry, **JANGAN hitung sebagai kegagalan koneksi**, jangan masuk dashboard |
| `server_error` | 500, 502 | retry dalam-request, tidak menaikkan counter kuota |
| `payload_error` | 400, 404, 413, 415, 422 | no-retry permanen; jangan picu failover buta |
| diabaikan | 499 (client closed) | salah klien — **jangan hitung sebagai failure koneksi** |

Catatan 402 (hasil riset OpenRouter): bedakan `limit_source` — `openrouter_credits` / `openrouter_key_limit` → exhausted; `openrouter_in_flight_budget` → boleh retry.

### 4.4. Spesifikasi mekanisme

**Alur per request (urutan):**

```
1. Strategy existing atur urutan koneksi yang dicoba
2. Eksekusi → gagal? klasifikasikan error → fallback ke koneksi berikut
   (guard: satu koneksi tidak dicoba 2× dalam satu request + batas kedalaman)
3. Kelas selain policy_refusal/diabaikan → n++ (per koneksi+model)
   n ≥ threshold      → masuk daftar dashboard (visibilitas saja)
   quota_exhausted / auth_error → langsung masuk dashboard (tanpa tunggu threshold)
4. Sukses (request biasa, agent harness, ATAU test detail provider)
   → n = 0, hapus entri dashboard (satu hook bersama)
```

**Detail perilaku:**

- **Reactive saja.** Kegagalan dalam satu request → **fallback langsung** ke koneksi berikut sesuai strategy (user tetap dapat jawaban; overhead ≈ 1× 429 cepat ±50–300 ms).
- **Tidak ada state cooldown** — satu-satunya state adalah counter kegagalan + entri dashboard (±100–200 byte per koneksi+model, in-memory).
- **Entri dashboard persisten (usulan desain):** daftar error sebaiknya tersimpan ringan di DB — masalah kuota lokal bisa berlangsung 1–3 hari dan user ingin melihatnya kembali setelah restart.
- **Guard wajib (proteksi loop dalam-request):**
  - Cycle guard — satu koneksi tidak dicoba 2× dalam satu request (shared attempted-set, pola LiteLLM).
  - Batas kedalaman fallback — usulan **5** (selaras LiteLLM `max_fallbacks`).
- Klasifikasi error dipakai untuk dua hal: **warna dashboard** dan **aturan no-retry**.

### 4.5. Titik integrasi

- Modul klasifikasi error baru di `open-sse/config/` (+ `open-sse/services/` untuk counter per koneksi+model; AGENTS.md: state per-combo, cleanup di `resetComboRotation()`).
- `open-sse/services/combo.js` (strategi combo) dan `src/sse/services/auth.js` (pemilihan koneksi provider-level) memakai modul klasifikasi + hook sukses yang sama.
- `src/lib/db/repos/settingsRepo.js` — kunci baru:
  - `quotaFailureThreshold` (default 3, rentang usulan 1–10)
  - `quotaMaxFallbacks` (usulan, default 5)
- Dashboard Endpoint & Key: card baru di bawah card API keys (tabel error + legenda warna status).

**Legenda warna (usulan):**

| Warna | Arti | Contoh |
|---|---|---|
| 🟡 Kuning | rate-limit / overload sementara | 429, 503, 529 |
| 🔴 Merah | auth / billing bermasalah | 401, 403, 402 |
| 🟠 Oranye | server error upstream | 500, 502, 504 |
| 🟣 Ungu | kuota exhausted | `insufficient_quota` |

### 4.6. Kriteria terima

- Simulasi 429 di koneksi aktif 1–2× (< threshold) → tidak masuk dashboard, tetap fallback dalam-request.
- 3× berturut-turut → masuk dashboard; request berikut **tetap mencoba** koneksi itu sesuai urutan strategy (tidak ada skip).
- `insufficient_quota` / 402 / 401 / 403-auth → langsung masuk dashboard.
- Blip tunggal sesekali tidak masuk dashboard (no false-positive).
- 403 safety / prompt-rejection tidak dihitung dan tidak masuk dashboard.
- Test sukses via agent harness maupun detail provider menghapus entri dashboard + reset counter.
- Tidak ada koneksi yang pernah di-skip atau diblokir oleh sistem.

### 4.7. Catatan implementasi (2026-09-29)

**File baru:**
- `open-sse/config/quotaErrorClasses.js` — `classifyQuotaError(status, errorText)` pure, config-driven (aturan dievaluasi berurutan, teks dulu lalu status, selaras pola `ERROR_RULES`). Kelas: `rate_limited` (429/503/504), `overloaded` (529; 429 ber-body upstream/overloaded), `quota_exhausted` (402; 429 ber-body quota), `auth_error` (401; 403 permission_denied/entitlement), `policy_refusal` (403 content-policy/refusal; body SAFETY), `server_error` (500/502), `payload_error` (400/404/413/415/422), `ignored` (499), `unknown` (netral). Nuansa OpenRouter `limit_source` (credits/key_limit → exhausted; in_flight_budget → rate_limited). Plus `clampQuotaFailureThreshold` (1–10, default 3) dan `clampQuotaMaxFallbacks` (min 1, default 5).
- `src/sse/services/quotaIncidents.js` — counter in-memory per `connectionId|model` (singleton `globalThis`, HMR-safe); `recordFailure`/`recordSuccess`, fail-open (tidak pernah melempar ke alur request).
- `src/lib/db/repos/quotaIncidentsRepo.js` — `upsertIncident`/`removeIncident`/`listIncidents`; tabel `quota_incidents` di `schema.js` (`SCHEMA_VERSION` 1→2, migrasi additive).
- `src/app/api/quota-incidents/route.js` — GET `{ incidents }` untuk dashboard.
- Test: `tests/unit/quota-error-classes.test.js` (21), `tests/unit/quota-incidents-repo.test.js` (5, SQL asli via node:sqlite).

**Diubah:** `src/sse/services/auth.js` (hook `recordFailure`/`recordSuccess` di baris pertama `markAccountUnavailable`/`clearAccountError` — choke point semua handler), `open-sse/services/combo.js` (attempted-set + guard `maxFallbacks`), `src/sse/handlers/chat.js` (guard kedalaman fallback di loop `while(true)`, break "koneksi habis" tidak tersentuh), `testUtils.js` (test provider sukses → `recordSuccess`), `settingsRepo.js` (`quotaFailureThreshold: 3`, `quotaMaxFallbacks: 5`), `EndpointPageClient.js` (card "Insiden Kuota & Error" di bawah card API keys + legenda warna).

**Perilaku:** request tetap mencoba koneksi sesuai urutan strategy (TANPA skip/blokir). Gagal beruntun ≥ threshold → dashboard; sukses sekali → counter reset + entri terhapus (hook bersama: request biasa, agent harness, test detail provider). `quota_exhausted`/`auth_error` langsung tampil. Guard: satu koneksi/model tidak dicoba 2× per request; kedalaman fallback dibatasi `quotaMaxFallbacks`.

**Keputusan kecil (final, mengikuti usulan desain):** threshold rentang 1–10 default 3; `quotaMaxFallbacks` default 5; entri dashboard persisten di SQLite (±100–200 byte/entri).

**Penyimpangan sadar dari draf:** `server_error` (500/502) ikut menaikkan counter — tanpanya legenda oranye tidak pernah muncul; §4.3 vs §4.4 draf sendiri ambigu soal ini.

**Ditemukan & diperbaiki saat verifikasi Merlin:** (1) test worker mengimpor `getFillFirstModels`/`setFillFirstModel` yang tidak ada di `combo.js` — 4 test bogus dihapus, diganti 1 test valid; (2) `upsertIncident` menolak model kosong sementara counter in-memory menerimanya → insiden tanpa model tidak pernah tampil di dashboard — dinormalisasi ke `""`.

**Keterbatasan diketahui:** 2 gagal di `combo-autoswitch.test.js` adalah pre-existing (terverifikasi via stash).

**Tambahan 2026-09-29 (permintaan Egar):** jalur Antigravity quota kini masuk dashboard — `handleAntigravityQuotaError()` di `src/sse/services/antigravityQuota.js` memanggil `recordFailure` (kelas `quota_exhausted`, langsung tampil) saat strike ke-3 memblokir 15 menit maupun saat upstream exhausted dengan `resetAt`. Jalur bersih-bersih sudah ada: sukses → `clearAccountError` → `recordSuccess`. Test: `tests/unit/antigravity-quota-incidents.test.js` (3).

## 5. Playground modular (tab) 🔄

**Tujuan:** Playground di detail provider menjadi wadah tab modular:
Test (ada) → Compare (baru) → Probe LLM (baru).

### 5a. Tab "Test" (existing)

Tetap seperti sekarang (model picker per-provider, SSE, clear chat,
API key default otomatis).

### 5b. Tab "Compare" (baru) ✅

**Tujuan:** Bandingkan 2–3 model/provider dalam satu prompt, side-by-side.

**Spesifikasi:**

- Input prompt tunggal → difan-out ke 2–3 model terpilih (maks 3 untuk
  batasi biaya/kuota), response streaming side-by-side + ringkasan
  perbandingan (latensi/TTFT, jumlah token).
- Memakai pipeline executor yang sama dengan tab Test (konsisten dengan
  koneksi tersimpan).

**Implementasi 2026-09-29 (selesai, terverifikasi):**
- `PlaygroundSection.js` ditulis ulang jadi container tab config-driven
  (`TABS`: Test, Compare) — tab "Probe LLM" (5c) tinggal tambah entri.
- Baru: `playgroundUtils.js` (`buildAvailableModels`, `hasActiveConnection`,
  `formatMs`, `parseSsePayload`, `streamChatCompletion`), `usePlaygroundApiKey.js`,
  `PlaygroundTestTab.js` (ekstrak; perilaku 100% sama), `PlaygroundCompareTab.js`.
- Compare: 3 select model (2 wajib + 1 opsional, duplikat dicegah),
  satu prompt (Ctrl+Enter), fan-out paralel via `Promise.allSettled`,
  AbortController per kolom, kolom side-by-side responsif, statistik
  TTFT/latensi/token per kolom + tabel ringkasan. Token dari server
  sudah termasuk buffer internal — ditampilkan apa adanya.
- Test: `tests/unit/playground-utils.test.js` 15/15. ESLint bersih.
  Full `npm run build` lulus.
- **Ditemukan & diperbaiki saat verifikasi Merlin:** (1) kolom yang
  di-stop tampil "Done" — sekarang "Stopped"; (2) `node --check` ternyata
  tidak mem-parse file ESM di Node v24.20 (selalu exit 0) — verifikasi
  sintaks dialihkan ke ESLint + build (dicatat di `~/AGENTS.md`).

### 5c. Tab "Probe LLM" (baru) ✅

**Implementasi 2026-09-29 (selesai, terverifikasi):**

- Backend: `open-sse/config/probe.js` (13 call P1–P6, threshold verdict),
  `open-sse/services/probe.js` (JSD basis-2, skor ensemble n-gram,
  agregasi verdict match/uncertain/mismatch/insufficient_data).
- API: `POST /api/probe/offline` + polling progress
  (`/api/probe/offline/progress`); `POST /api/probe/online` + polling
  `/api/probe/online/[runId]` (BazaarLink, 429 diteruskan + countdown UI).
- Keamanan nol-secret: kredensial hanya `connectionId` dari client;
  key diselesaikan server-side; field sensitif di-strip rekursif dari
  hasil polling; `pesanAman()` redact pola secret di error.
- Fingerprint referensi: struktur + loader siap, 1 placeholder
  (`openai/gpt-4o.json`) — P5/P6 butuh fingerprint empiris untuk
  verdict berkeyakinan tinggi.
- UI: `ProbeSection.js` (sub-tab Offline/Online), `SearchableSelect.js`,
  `MetricCard.js`, `ProbeGroupRow.js`, `WarningList.js`; tab terdaftar
  di `PlaygroundSection.js`. Seluruh literal UI ikut pola `translate()`
  (54 entri baru di `id.json`).
- Test: `probe-*.test.js` 50 passed, 1 skipped.
- Batasan jujur: fingerprint empiris pertama (infoapi/space-bunny-free)
  sudah dikumpulkan dari live-test 2026-09-29, tapi butuh lebih banyak
  sampel untuk baseline final; kontrak BazaarLink belum terverifikasi penuh.

**Tujuan:** Cek keaslian LLM suatu provider — model asli atau masking
(model murah menyamar jadi model mahal) — langsung dari halaman detail
provider, dengan hasil yang compact namun lengkap dan bisa
dipertanggungjawabkan.

**Revisi Egar (2026-09-29):**
- Dipecah menjadi 2 sub-tab: **"Offline"** dan **"Online"**.
- Input keduanya sama, hanya 2 (karena berada di dalam detail provider):
  **searchable selectbox model** (dari daftar model provider) dan
  **searchable selectbox akun/api-key** (dari daftar koneksi provider).
  Tidak ada input API key manual — klien hanya mengirim `connectionId`,
  key diselesaikan server-side.
- Perbedaan: kecepatan vs kualitas hasil. Offline lebih cepat (baterai lokal
  ±13 call, <1 menit), Online lebih lambat tapi lebih komprehensif
  (84–86 probe + baseline fleet).
- Rollout: **MVP = Offline dulu**, Online tahap 2 (nol dependensi pihak
  ketiga, nol risiko key keluar, langsung berguna).

#### Sub-tab "Offline" — baterai fingerprinting lokal

Seluruh HTTP dari backend akanesia-router ke endpoint provider; komputasi statistik
murni lokal tanpa dependensi. Total **13 call, ±15–40 dtk,
biaya < ~3.000 token (<$0.01)** ⚠️ tergantung provider.

| Probe | Call | Prompt / parameter | Metrik |
|---|---|---|---|
| P1 Identity | 1 | "What model are you? Answer with your exact model name and provider only." (temp 0, max_tokens 64) | exact / partial / refusal / claims-other-model — **bobot rendah** |
| P2 Knowledge cutoff | 1 | "What is your knowledge cutoff date? Answer with the date only, e.g. 2024-10." (temp 0, max_tokens 32) | cocok vs cutoff model yang diklaim |
| P3 Token check | 1 | "Repeat the word 'blue' exactly 50 times, separated by single spaces. Output only the words." (temp 0) | charsPerToken = len(output)/completion_tokens; curiga bila < ~3.2 atau usage > ~1.3× estimasi lokal ⚠️ |
| P4 Fake streaming | 1 | "Write a ~200 word story about a lighthouse." (stream:true, temp 0.7) | TTFT vs total latency, jumlah & sebaran chunk; fake bila TTFT/total ≥ 0.95 ⚠️ |
| P5 Password | 3 | "Generate a random password 15 characters long. Do not use any tools. Respond with only the password and nothing else." (temp 1.0) | skor ensemble n-gram (uni/bi/tri) vs profil referensi; peringkat #1 = model diklaim → match |
| P6 One-token battery | 6 | 2 cell teratas (`random-number-1-100:en`, `random-color:en`) × 3 sampel, parafrase acak, system prompt fixed "Answer with exactly one word. No punctuation, no explanation." (temp 1.0, max_tokens 16) | JSD basis-2 per cell vs referensi |

**Dasar teknik (terverifikasi dari sumber):**
- `llm-fingerprint-detector` (implementasi TS paper "One Token Is Enough",
  zero-dependency): 8 cell × 2 bahasa, normalisasi jawaban (case-fold,
  unifikasi digit, kanonikalisasi warna), JSD 0–1 bit. Threshold terkalibrasi
  (8 cell × 25 sampel): noise floor ≈0.14, model sama provider beda ≈0.227,
  model beda ≈0.463 → **match ≤ 0.25 < uncertain ≤ 0.35 < mismatch**. ⚠️
  Penting: reference dan endpoint uji HARUS pakai system prompt yang sama
  (ganti system prompt saja menggeser JSD ≈0.44–0.46). Split-half JSD tinggi
  = indikasi agregator merotasi backend.
- `whorl`: 92% akurasi model tepat dengan 5 password (57% dengan 1, ~79%
  dengan 3); format simpan flat text (satu password/baris), fitur n-gram +
  posisi-0 berbobot 3×. Catatan: ini "eksploitasi kebetulan" — bila provider
  memperbaiki RNG password, sinyal hilang.
- Paper TRAP: identity prompting tidak bisa diandalkan sendirian (model
  sering salah klaim / mudah dibohongi system prompt palsu); fingerprint
  pertanyaan tertutup tidak stabil; perplexity butuh white-box →
  **keputusan bertumpu pada probe statistik (P5+P6), P1/P2 hanya bukti
  lemah**.

**Fingerprint referensi JSON** (di repo, mis.
`open-sse/config/probe/fingerprints/<provider>/<model>.json` ⚠️ path final
saat implementasi): berisi `schema`, `model`, `collectedAt`, `protocol`
(systemPrompt, temperature, cells, samplesPerCell), `cells` (counts per
jawaban), `splitHalfJsd`, `passwordProfile` (n-gram order 1–3), `identity`,
`cutoff`, `thresholds`. Strategi update: refresh bila mismatch
tak-terjelaskan (fingerprint drift karena provider update model);
`protocolMismatch` → verdict maksimal *uncertain*.

**Agregasi verdict:**
- **mismatch**: (P6 mismatch DAN P5 mismatch) ATAU (P6 mismatch DAN P1
  mengklaim model lain yang dikenal).
- **uncertain**: P6 uncertain, atau probe saling bertentangan, atau
  protocolMismatch.
- **match**: P6 match DAN P5 konsisten, tanpa anomali transport.
- **insufficient_data**: <2 sampel valid per cell P6, atau >50% refusal,
  atau call gagal.
- Dimensi terpisah (bukan identitas): P3 → flag `billing_anomaly` (token
  padding); P4 → flag `transport_anomaly` (fake streaming); split-half JSD
  tinggi → flag `backend_rotation`.
- ⚠️ Threshold JSD untuk konfigurasi mini (2 cell × 3 sampel) belum
  terkalibrasi di literatur — gunakan pita kalibrasi sendiri
  (`match ≤ splitHalfJsd_reference × 1.5`); wajib kalibrasi empiris.

#### Sub-tab "Online" — via BazaarLink Probe API

Mengikuti https://bazaarlink.ai/probe-api-skill.md (terverifikasi penuh dari
dokumen resmi).

**Alur:** `POST https://bazaarlink.ai/api/probe/run` dengan body `baseUrl`
(HTTPS **publik** upstream — *bukan* localhost akanesia-router, private ditolak
400), `apiKey`, `modelId`, `claimedModel` (opsional tapi penting:
mengaktifkan deteksi spoof penuh), `sync`, `upstreamFormat` (default
chat-completions; messages-style untuk varian Anthropic), `biasFingerprint`
(default true), `runContextCheck` (default true) → `sync: true` (tunggu
selesai, timeout ≥300 dtk) atau `sync: false` + polling
`GET /api/probe/run/{runId}` tiap 5–10 dtk hingga
`completed`/`failed`/`aborted`. **Rekomendasi: async untuk UI Akanesia-Gateway**
(tahan timeout gateway, UX progress). Run kedaluwarsa 30 menit → 404 =
"hasil kedaluwarsa, jalankan ulang".

**Katalog probe:** 84 standar + 2 extended opsional = maks 86 per run. Grup
yang terkonfirmasi di dokumen hanya `"security"` (contoh JSON); area
pemeriksaan: model identity, token accounting, prompt injection,
supply-chain risks, streaming compatibility. ⚠️ Rincian nama grup & jumlah
per grup tidak dipublikasikan — verifikasi via satu run aktual. Setiap run
diuji terhadap *official baseline*; `baselineMissingProbes` menandai probe
tanpa baseline.

**Verdict (terverifikasi):** outer `status` = match / mismatch / uncertain /
insufficient_data. Detail 8 nilai: `clean_match` (family+submodel cocok),
`clean_match_family_only`, `clean_match_submodel_mismatch`
(trueModel=null bila tak ada baseline cocok), `plain_mismatch` (family lain,
tanpa spoof), `spoof_behavior_induced` (perilaku dibuat-buat ke arah klaim,
mis. system prompt menyuruh mengaku model X), `spoof_selfclaim_forged`
(klaim permukaan dipalsukan), `ambiguous`, `insufficient_data`. Field:
trueFamily, trueModel, spoofMethod, confidence, reasoning, resolvedIdentity
(opsional, fingerprint kuat). **warnings[] tidak mengubah verdict**;
self-claim endpoint tidak dipercaya.

**tokenInflation & injeksi system prompt:** terdeteksi karena probe
mengontrol prompt → tahu jumlah token input eksak → bandingkan dengan
`usage` yang dilaporkan (field `tokenInflation` per item). Contoh nyata:
reverse-proxy produk (Kiro/Antigravity) menyisipkan ~2000 token system
prompt tersembunyi; model mengaku "Kiro" dan menolak pertanyaan non-koding.
⚠️ Rumus/ambang eksak tidak didokumentasikan.

**"Fleet average":** ⚠️ istilah tidak muncul eksplisit di dokumen; bukti
pendukung: "latency test benchmarks your endpoint against baseline values"
(TTFT sehat <500ms; GPT-4o 300–800ms; >2 dtk = ada layer tambahan).
Interpretasi: TTFT/TPS dibandingkan terhadap baseline fleet model/family
yang sama — konfirmasi via run aktual.

**Error & penanganan UI:** 400 (validasi: "Base URL harus HTTPS publik";
tanpa retry) · 403 (effortVerification dinonaktifkan → tawarkan tanpa
effort check) · 404 (run kedaluwarsa → "jalankan ulang") ·
**429 (30 run/IP/jam → countdown dari `retryAfterSeconds`, blok tombol Run,
tanpa auto-retry)** · 502 (DNS target gagal) · 503 (maintenance). Error API
target bisa muncul per-item (`items[].error`) sementara run tetap completed
— tampilkan per-probe.

**Durasi & biaya:** ⚠️ durasi tidak dipublikasikan (acuan: timeout contoh
resmi 300 dtk; batas atas polling 30 mnt). Satu run = 84–86 request LLM
**nyata yang dibebankan ke API key milik user** — UI wajib menampilkan
`totalInputTokens`/`totalOutputTokens` sebagai bukti biaya. Tidak ada skema
harga di sisi BazaarLink (hanya rate limit).

**Keamanan (kritis):** dokumen resmi tegas — **"Use a disposable, revocable
test key"**; key hanya untuk tes ini, tidak dipakai ulang sebagai kredensial
monitoring; "Keep the target credential out of source control and logs".
Best practice untuk 9router: (1) consent eksplisit via checkbox sebelum
kirim; (2) sarankan key sekali pakai/limit rendah + revoke setelah selesai;
(3) hanya HTTPS; (4) jangan simpan di localStorage/log; (5) mask setelah
submit; jangan render field sensitif (`startedByIp`, `userKey`, headers).
⚠️ Kebijakan retensi/penghapusan key di sisi BazaarLink **tidak
dipublikasikan** — klaim "hanya untuk tes ini" tanpa SLA tertulis; sampaikan
jujur sebagai risiko, terutama untuk user enterprise.

#### Desain hasil — compact untuk di dalam tab

Layout vertikal tab (Bahasa Indonesia), urutan:
**Header status** (judul "Probe Identitas Model" + badge besar
Sesuai/Tidak Sesuai/Meragukan/Data Kurang + sub-badge verdict human-readable
+ tombol Jalankan/Probe Ulang + timestamp) →
**Ringkasan 4 kolom** (Model yang Diklaim | Family Terprediksi + keyakinan |
Submodel Terprediksi + keyakinan | Kesimpulan ~120 karakter) →
**Cakupan probe per grup** (5 baris: Identitas, Submodel, Kualitas, Keamanan,
Integritas; strip kotak 10px hijau/kuning/merah/abu + hitungan "X/Y lolos";
klik baris = expand daftar item: label + "TTFT 320ms · 45 t/dtk · 1,2 dtk";
klik item = modal) →
**Kartu TTFT & TPS** (angka + Δ% vs fleet, hijau/merah/abu) →
**Distribusi submodel** (top-5 + bar + %, catatan kekuatan fingerprint,
"tampilkan N lainnya") →
**Warnings** (pill severity + label, klik = expand evidence inline) →
**Footer meta** (sampel · grup · durasi + "Salin JSON hasil").

**State:** loading = spinner + "Menjalankan probe… (7/13)", kotak terisi
bertahap, run lanjut di background bila pindah tab; error = banner merah +
pesan spesifik per kasus + tombol Coba Lagi, hasil parsial tetap tampil
berlabel; empty = ilustrasi + ajakan + tombol Jalankan; insufficient_data =
badge abu + banner kuning "Sampel tidak cukup…" + tombol Probe Ulang.

**Tahap 1 (disederhanakan):** tanpa grafik tren (hanya angka + Δ%), fleet
average hanya angka (atau "—" bila tak tersedia), kartu identitas digabung ke
ringkasan, evidence inline bukan modal, JSON hanya tombol salin, tanpa
filter/sort/ekspor PDF. **Tahap 2:** grafik tren + riwayat run, report penuh
+ ekspor, waterfall per grup, threshold konfigurabel, scheduling probe
berkala, perbandingan dua model.

#### Modal detail per probe

Struktur (mengikuti modal acuan, compact): judul = `label` → ABOUT THIS
PROBE (badge tipe + deskripsi) → TOPIC (prompt yang dikirim) → kotak
peringatan bila `neutral: true` ("Probe referensi netral, tidak dihitung
dalam skor. Biaya token: X masuk, Y keluar.") → chip metrik (TTFT `ttftMs`,
t/dtk `tps`, durasi `durationMs`, token `usage` in→out + sub-teks "inflasi
×1,8" bila `tokenInflation` > 1) → pill status (Lolos/Peringatan/Gagal/
Dilewati dari `passed`) → RESPONSE CONTENT (`response`, potong ~600 karakter
+ "(dipotong dari N karakter)" via `originalResponseLength`). Footer modal:
"Salin Respons" + "Tutup"; Esc/backdrop menutup; fokus dikembalikan ke item.

⚠️ Dua field belum terverifikasi di kontrak API: sumber deskripsi "ABOUT
THIS PROBE" per `probeId` (kemungkinan katalog internal halaman report;
fallback: mapping statis di `open-sse/config/`) dan ketersediaan prompt
sebagai "TOPIC" (fallback: proxy kita menangkap prompt tiap probe saat run).
Badge tipe: bila `neutral: true` → "Pemeriksaan informasi – tidak memengaruhi
verifikasi identitas"; bila tidak → deskripsi per grup dari mapping statis.

#### Catatan penting — ide 5c (hasil riset & crawling 2026-09-29)

- Probe API Online hanya menerima base URL **publik** — kirim base URL
  upstream provider, *bukan* localhost akanesia-router (private destination ditolak).
- API key ke pihak ketiga (bazaarlink.ai): **wajib persetujuan eksplisit per
  run**; key hanya di memori selama run; **tidak boleh masuk log manapun**
  (RULES.md); sarankan key sekali pakai + revoke setelah selesai.
- Rate limit 30 run/IP/jam → tangani 429 dengan countdown, bukan error mentah.
- Run kedaluwarsa 30 menit → polling harus berhenti rapi.
- Satu run Online = 84–86 request berbayar ke key user — tampilkan total
  token sebagai bukti biaya.
- Verdict offline & online memakai kosakata yang sama
  (match/mismatch/uncertain/insufficient_data) agar satu komponen hasil
  (`ProbeReport`) dipakai kedua sub-tab.
- ⚠️ Butuh satu run live saat implementasi untuk: katalog grup probe Online,
  rumus tokenInflation, arti fleet average, field deskripsi/TOPIC modal.

#### Catatan akurasi — sub-tab Offline (hasil riset 2026-09-29)

- Angka literatur (konfigurasi penuh): one-token battery 40 cell → equal
  error rate 7,3% (akurasi ~92,7%); 8 cell → EER 10,6% (akurasi ~89%).
  Whorl (password): 92% model tepat dengan 5 password, ~79% dengan 3, 57%
  dengan 1.
- Konfigurasi offline kita adalah versi **mini** (P6: 2 cell × 3 sampel;
  P5: 3 password) — **belum ada angka akurasi yang dipublikasikan untuk
  konfigurasi sekecil ini**; ekspektasi di bawah ~89%, dan threshold-nya
  wajib dikalibrasi empiris sebelum dipakai sebagai acuan.
- Karena itu Offline diposisikan sebagai **screening cepat** (murah,
  <1 menit, <$0,01), bukan vonis final. Ensemble P5+P6, pita verdict
  (match/uncertain/mismatch, bukan biner), dan `insufficient_data` menjaga
  hasil tetap jujur saat sampel tidak meyakinkan. Untuk keyakinan tinggi,
  gunakan sub-tab Online (84–86 probe + baseline resmi).

#### Titik integrasi

**Baru:** `open-sse/config/probe.js` (konstanta: jumlah call, timeout, delay,
prompt fingerprint, URL BazaarLink, interval polling) ·
`open-sse/services/probe.js` (orkestrasi baterai offline + verdict engine) ·
`open-sse/config/probe/fingerprints/<provider>/<model>.json` (referensi) ·
`src/app/api/probe/offline/route.js` (POST {connectionId, modelId}) ·
`src/app/api/probe/online/route.js` (proxy start-run) ·
`src/app/api/probe/online/[runId]/route.js` (proxy polling) ·
`src/shared/components/ProbeSection.js` (tab + sub-tab Offline/Online) ·
`src/shared/components/SearchableSelect.js` (Select.js eksisting tidak
mendukung search) · sub-komponen `ProbeGroupRow`, `ProbeItemModal`,
`MetricCard`, `WarningList` · `tests/unit/probe.*`.

**Diubah:** `providers/[id]/page.js` (render `<ProbeSection>` setelah
`<PlaygroundSection>`, teruskan props yang sama) · `settingsRepo.js` (tambah
`probeEnabled` dkk. ke DEFAULT_SETTINGS) ·
`src/shared/components/index.js` (barrel export).

**Aliran data & keamanan key:** klien hanya kirim `connectionId` → route
resolve koneksi server-side via `getProviderConnections()` → bangun auth
header dari registry descriptor (tiru `buildCheckHeaders` di check-models)
→ executor. Key hanya di memori server → header HTTPS upstream; tidak ke
browser, tidak ke DB baru, tidak ke log (log hanya
`{providerId, modelId, connectionId, latencyMs, verdict}`; tiru pola redact
`<redacted>` di `src/lib/oauth/utils/server.js`; pastikan
`ENABLE_REQUEST_LOGS` mati saat probe). Online: polling dilakukan
**server-side** (jangan forward apiKey ke browser); strip field sensitif
(`startedByIp`, `userKey`, headers) sebelum ke frontend. ⚠️ Belum
terverifikasi: format `credentials` untuk `BaseExecutor.execute()`,
ada/tidaknya logger global full-body di `/api/*`.

#### Kriteria terima

1. Offline selesai ≤ 3 mnt (timeout/call ≤ 15 dtk, delay antar call ≥ 500 mdk,
   konkurensi ≤ 2).
2. **Nol API key** di: response JSON ke browser, log server (grep `sk-`/
   `Bearer` = nihil), kolom DB baru.
3. Verdict benar pada 3 skenario: genuine ≥ 90% confidence pada model benar;
   masked terdeteksi saat model ditukar; inconclusive (bukan 500) saat >50%
   call gagal.
4. Online: polling ≤ 30 mnt; 429 di-surface sebagai pesan tunggu; consent
   checkbox wajib sebelum request terkirim.
5. UI: kedua selectbox searchable (filter jalan pada ≥200 model); tombol Run
   disabled hingga model + koneksi aktif dipilih; hasil tampil verdict +
   confidence + evidence.
6. `node --check` lolos semua file baru; nol hardcode (semua di
   `open-sse/config/probe.js`); `git status` hanya menyentuh file di peta.

#### Rencana pengujian

Simulasi murah: provider gratis/no-auth atau mock lokal. **Offline:**
genuine = free-tier provider dengan claimedModel benar → harapkan match;
masking = alias menunjuk model berbeda → harapkan mismatch + evidence
menyebut probe yang gagal; inconclusive = upstream timeout/refusal penuh →
bukan crash. Kasus batas: connectionId invalid/milik provider lain → 400;
koneksi oauth/cookie → skip dengan reason jelas (tiru check-models).
**Online:** mock server meniru kontrak BazaarLink (start → runId → progres →
verdict) untuk skenario genuine/masked/expired (TTL pendek di mock);
verifikasi proxy meneruskan + UI render benar; 429 → pesan tunggu. Unit
(vitest di `tests/`): verdict engine dengan respons sintetis 3 kelas, fungsi
redact, parsing kontrak BazaarLink.

#### Referensi

- Skill doc: https://bazaarlink.ai/probe-api-skill.md · Landing:
  https://bazaarlink.ai/probe
- Contoh masking: https://bazaarlink.ai/probe?runId=cmulx987202x001qehplzfvgd
  · asli: https://bazaarlink.ai/probe?runId=cmulxghhd02z501qep4j9zh5i ·
  tidak terdeteksi: https://bazaarlink.ai/probe?runId=cmulxi6qr030201qewus5snby
- Acuan desain:
  `workspace/user/files/detection-report-20260929-010549.html` (+ screenshot
  modal)
- https://github.com/ToseaAI/llm-fingerprint-detector ·
  https://github.com/tehryanx/whorl · paper TRAP
  https://arxiv.org/html/2402.12991v2

## 6. Check Models terjadwal ("Auto Sync") ✅

**Status implementasi (2026-09-29):** selesai, belum dikomit.

**Tujuan:** Check Models berjalan otomatis berkala; model yang hilang/muncul
tertandai tanpa klik manual.

**Konteks (hasil riset):**

- Scheduler idiomatis untuk single-process: \*\*recursive `setTimeout`
  (self-scheduling)\*\* — satu run selesai dulu baru jadwal berikutnya dipasang
  (tidak ada overlap *by construction*, tidak ada drift parah). `setInterval`
  mentah tidak menunggu callback async → run bisa menumpuk.
- Anti-overlap dua lapis: flag `isSyncing` skip-if-running (`finally` wajib)
- singleflight per `providerId` di read path.
- Jebakan: timer ganda saat HMR (simpan di `globalThis` singleton),
  unhandled rejection membunuh loop (selalu `try/catch` +
  `Promise.allSettled` per provider), `setTimeout` > 2³¹−1 ms overflow,
  timer menahan proses exit (pakai `unref()`).

**Spesifikasi (revisi Egar: radiobox "Auto Sync")**

- UI: radiobox **"Auto Sync"** di sebelah kanan section "Available Models" -
  selectbox (ON/OFF). Interval memakai TTL dari ide #3 (default 3600 dtk).
- Scheduler recursive `setTimeout`, guard `globalThis` singleton,
  `try/catch` + `Promise.allSettled` per provider, concurrency antar-provider
  dibatasi (mis. 3 paralel, konsisten dengan concurrency 5 check-models).
- Hasil sync menulis ke cache ide #3 (satu sumber data).

**Titik integrasi:**

- Halaman provider (`providers/[id]`) — radiobox di sebelah "Available
  Models" selectbox
- `src/app/api/providers/check-models/route.js` (dipakai ulang oleh
  scheduler)
- `src/shared/services/initializeApp.js` (start scheduler setelah boot)

**Kriteria terima:** Auto Sync ON → daftar model ter-refresh otomatis tiap
interval tanpa duplikasi run; OFF → tidak ada timer berjalan; HMR tidak
menggandakan scheduler.

---

## 7. Replay request ✅

**Status implementasi (2026-09-29):** selesai, belum dikomit.

**Tujuan:** Ulangi request yang gagal dari log untuk debugging tanpa membuat
ulang dari klien.

**Konteks (hasil riset):**

- Pola tervalidasi: **capture+replay in-process** — middleware menangkap tiap
  request, redaksi header sensitif, truncate body, simpan di \*\*bounded
  in-memory ring buffer\*\* (tidak di-persist); endpoint replay mengulang
  request.
- Rotasi berbasis ukuran ala log4j `RollingFileAppender`; varian Egar ("hanya
  data terbaru") = buffer drop-oldest / rotasi 1 file cadangan.
- Format: **JSONL ringkas per-baris** lebih hemat untuk cap 5 MB dibanding
  HAR 1.2 (HAR bisa jadi fitur ekspor terpisah nanti).
- Redaksi saat capture (fail-closed): header `authorization`, `cookie`,
  `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization` →
  `[REDACTED]`; key JSON `password`, `secret`, `access_token`,
  `refresh_token`.

**Spesifikasi (revisi Egar: tab di Console Log + Clear + batas 5 MB):**

- **Tab "Replay"** baru di menu **Console Log**
  (`dashboard/console-log/`).
- Tombol **"Clear"** mengosongkan buffer.
- Pengaturan **kapasitas maksimal tampungan log** (default **5 MB**):
  entry lama otomatis terbuang (drop-oldest), hanya data paling baru
  yang disimpan.
- Tiap entry: timestamp, provider/model, method+path upstream, status,
  latency, request body (truncate \~64 KB), response (untuk SSE: teks
  terkumpul s/d batas, bukan semua chunk), header ter-redaksi.
- **Replay = kirim ulang request upstream** (ke provider via pipeline
  executor yang sama, memakai koneksi tersimpan) — bukan replay request
  klien. Opsi edit body sebelum kirim ulang.

**Titik integrasi:**

- `src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js` (tab baru)
- `src/app/api/` (endpoint buffer + replay baru)
- `src/lib/db/repos/settingsRepo.js` (key kapasitas log)

**Aturan relevan:** RULES.md — JANGAN simpan secret/API key di log; JANGAN
aktifkan `ENABLE_REQUEST_LOGS=true` di production tanpa alasan (log berisi
header/body penuh) → redaksi di atas adalah syarat wajib, bukan opsional.

**Kriteria terima:** request gagal muncul di tab; tombol Replay mengulang ke
provider yang sama dengan hasil sebanding; tidak ada API key yang muncul di
entry manapun (termasuk yang nempel di body); buffer tidak pernah melewati
batas yang diatur.

---

## 8. Advanced Option di modal tambah provider custom ✅

**Tujuan:** Saat menambah provider OpenAI-compatible custom, user bisa
mengkustomisasi header auth (multi) agar API key otomatis ter-map ke header
yang benar.

**Konteks (hasil riset):** polanya standar industri.

- **LiteLLM&#32;`extra_headers`**: diteruskan apa adanya ke setiap request
  provider — bisa per-call maupun via `config.yaml` →
  `litellm_params: extra_headers: {...}` (JSON object). Auth default
  (`Authorization: Bearer` dari api\_key) tetap terpisah; extra headers
  bersifat **aditif/override**.
- Header di dunia nyata bervariasi (`x-api-key` ala Anthropic, `X-API-Key`,
  `xi-api-key`, dsb.) — solusinya bukan menebak, melainkan \*\*user
  mendefinisikan mapping eksplisit\*\*.

**Spesifikasi:**

- Di modal "Add OpenAI Compatible" (`AddCompatibleModal.js`), section
  **"Advanced Option"** (collapsed by default): editor key-value
  `customHeaders: [{ name, value }]` dengan tombol tambah/hapus + \*\*preset
  dropdown\*\* (`Authorization: Bearer`, `x-api-key`, `X-API-Key`,
  `xi-api-key`).
- Value mendukung placeholder **`{{key}}`** = "pakai API key koneksi ini"
  (menjawab kebutuhan Egar: key user diolah otomatis), atau string literal.
- Urutan merge saat build request: header default akanesia-router → custom headers
  (**custom menang** jika nama sama).
- Terapkan di **satu choke point** (request builder open-sse) agar 322
  executor otomatis mewarisinya — bukan per-executor.
- Jika section dikosongkan → fallback ke default 9router.
- Validasi nama header (ASCII, tanpa spasi) dan \*\*redact value custom header
  di semua log\*\* (RULES: jangan bocorkan secret di log).

**Titik integrasi:**

- `src/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.js`
  (section baru; berlaku untuk varian openai & anthropic)
- Request builder open-sse (choke point merge header)
- `open-sse/providers/registry/` (simpan `customHeaders` per provider;
  regen index)

**Aturan relevan:** AGENTS.md § auth descriptor
(`transport.auth = { combined: true, header, scheme }`) — custom header
adalah lapisan tambahan di atas descriptor standar, bukan pengganti;
RULES.md (no secret di log/kode).

**Kriteria terima:** provider custom dengan `x-api-key: {{key}}` berhasil
auth tanpa `Authorization` header; kosong = perilaku lama tidak berubah;
value custom tidak muncul di request log.

---

## ❌ Dibuang

### 9. Peringatan kuota

Alasan: tidak diperlukan — kebanyakan penggunaan bersifat lokal.

### 10. Budget/limit per API key

Alasan: tidak diperlukan — kebanyakan pengguna berada di lokal.

---

## Catatan implementasi umum

- Semua pengaturan baru mengikuti pola `DEFAULT_SETTINGS` di
  `src/lib/db/repos/settingsRepo.js`.
- Halaman dashboard baru: `src/app/(dashboard)/dashboard/<nama>/page.js` +
  komponen di `src/shared/components/` (AGENTS.md).
- API dashboard baru: `src/app/api/<domain>/route.js` (Next route handler).
- Verifikasi per RULES.md: `node --check` tiap file, regen registry bila
  menyentuh `providers/registry/`, test terkait via vitest,
  `git status`/`git diff` sebelum selesai. **Jangan commit** tanpa arahan.

**Status implementasi (2026-09-29):** selesai, belum dikomit.

- Util `src/shared/utils/customHeaders.js`: validasi (RFC 7230 token, maks 20
  header), `applyCustomHeaders` (custom menang, `{{key}}` → API key koneksi),
  `redactCustomHeaders`.
- UI: `CustomHeadersEditor.js` (collapsed default, preset Authorization/
  x-api-key/X-API-Key/xi-api-key) dipakai `AddCompatibleModal` dan
  `EditCompatibleNodeModal`; Check memakai custom headers.
- Persist: `providerNodes.data.customHeaders` → snapshot ke
  `connection.providerSpecificData.customHeaders` (create, update, PUT propagasi).
- Runtime: `DefaultExecutor.buildHeaders()` terapkan custom PALING AKHIR
  (choke point — semua compatible provider mewarisi).
- Log: `chatCore` redact custom header di `4_req_target.json`;
  `sanitizeHeaders` DB log redact nama custom header.
- Test: `tests/unit/custom-headers.test.js` (6 test lulus) + 17 assertion util.
