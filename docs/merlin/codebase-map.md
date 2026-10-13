# Peta Codebase akanesia-router — Memori Jangka Panjang Merlin

> Dibuat 2026-10-13 atas instruksi Egar. Tujuan: pencarian cepat file
> berdasarkan fitur/mekanisme, plus catatan perubahan & perbaikan penting.
> Repo: `~/workspace/akanesia-router` (branch master, origin
> `git@github.com:ch0c01dxyz/akanesia-router.git`). Versi lokal 1.5.0.
> Bahasa UI: Indonesia. Sistem Egar: Windows 11 (perintah PowerShell/CMD).
>
> **Indeks cepat:** arsitektur §1 · request lifecycle §2 · provider §3 ·
> database §4 · fitur→file §5 · API routes §6 · dashboard §7 ·
> nama provider §8 · auto-disable suspend §9 · ledger commit §10 ·
> aturan kerja §11 · log/debug §12.

## 1. Arsitektur Tingkat Tinggi

```
Browser/Dashboard (Next.js App Router, src/app/)
        │  API routes: src/app/api/*
        ▼
Gateway inference:
  src/sse/handlers/chat.js  →  open-sse/handlers/chatCore.js
        │  (SSE engine: open-sse/)
        ▼  upstream LLM providers
DB: SQLite via src/lib/db/ (driver.js + repos/* + schema.js)
```

- **`open-sse/`** — SSE engine provider-agnostic: 1 request gaya OpenAI →
  provider mana pun. Punya AGENTS.md sendiri (baca sebelum ubah).
- **`src/app/`** — Next.js: dashboard (`(dashboard)/`) + API routes (`api/`).
- **`src/lib/`** — util server: DB, buffer, RTK helpers, dsb.
- **`src/sse/`** — service layer gateway (auth, quota, token refresh).
- **`src/shared/`** — kode shared client/server (constants, components, utils).
- **`cli/`** — CLI `akanesia-router` (terpisah, package sendiri).
- **`custom-server.js`** — wrapper `http.createServer` di atas Next standalone.

## 2. Request Lifecycle (chat)

`src/sse/handlers/chat.js` → `open-sse/handlers/chatCore.js`:
1. `services/model.js parseModel` — resolve `provider/model`
2. RTK untuk `cursor` (harus SEBELUM translate — translator-nya rewrite shape)
3. `translator/index.js translateRequest` (format klien → format provider;
   pivot via OpenAI; direct route bila pasangan terdaftar)
4. Post-translate savers: `rtk/` compress, `rtk/headroom.js`, `caveman.js`,
   `ponytail.js` (semua fail-open)
5. `executors/index.js getExecutor(provider)` → `executor.execute()`
6. `translateResponse` → SSE ke klien

File kunci: `open-sse/handlers/chatCore.js` (~600 baris, pusat logika +
log terminal), `open-sse/handlers/chatCore/streamingHandler.js`,
`nonStreamingHandler.js`, `sseToJsonHandler.js`, `requestDetail.js`.

## 3. Sistem Provider

- **Registry**: `open-sse/providers/registry/` — 330 file `.js` (satu per
  provider) + `index.js` (auto-generated, JANGAN edit manual).
  Tiap entry: `transport` (baseUrl, validateUrl, authHeader, authType),
  model list, pricing.
- **Eksekutor**: `open-sse/executors/` — `base.js` (BaseExecutor) + per-provider
  khusus; `index.js` map; `getExecutor` fallback ke `DefaultExecutor`.
  `adapters.manifest.js` auto-generated (ide #1 lazy-load).
- **Translator**: `open-sse/translator/` — `request/<from>-to-<to>.js`,
  `response/<from>-to-<to>.js`, `schema/` (enum), `concerns/` (shared).
  Self-register via `register()`; file BARU wajib daftar di
  `TRANSLATOR_MANIFEST` di `translator/index.js` (lazy, bukan static import).
- **Provider kompatibel dinamis**: `openai-compatible-*` /
  `anthropic-compatible-*` + UUID (dibuat user via dashboard). TIDAK punya
  entry registry → butuh penanganan khusus di banyak tempat (lihat §8).
- **Constants**: `src/shared/constants/providers.js` — `AI_PROVIDERS`,
  `OPENAI_COMPATIBLE_PREFIX`, helper `isOpenAICompatibleProvider()` /
  `isAnthropicCompatibleProvider()`.

## 4. Database (SQLite)

Schema: `src/lib/db/schema.js`. Repo: `src/lib/db/repos/*Repo.js`.
Diekspos via `src/lib/db/index.js` → `src/lib/localDb.js` → `src/models/index.js`.

| Tabel | Repo | Isi |
|---|---|---|
| `providerConnections` | connectionsRepo.js | Koneksi/API key per provider (id, provider, authType, name, isActive, priority, data JSON: apiKey, baseUrl, ...) |
| `providerNodes` | nodesRepo.js | Node provider kompatibel custom |
| `proxyPools` | proxyPoolsRepo.js | Pool proxy |
| `apiKeys` | apiKeysRepo.js | API key gateway (`sk_9router_*`) + access control |
| `combos` | combosRepo.js | Combo model |
| `settings` | settingsRepo.js | Settings (defaults di `DEFAULT_SETTINGS`; baca via `getSettings()` = merge defaults) |
| `usageHistory` / `usageDaily` | usageRepo.js | Riwayat pemakaian |
| `requestDetails` | requestDetailsRepo.js | Detail request |
| `quota_incidents` | quotaIncidentsRepo.js | Insiden kuota/error ide #4 (key: connectionId+model) |
| `kv` | — | Key-value umum |

## 5. Fitur (Ide Egar) → File

| Ide | File utama |
|---|---|
| #1 lazy-load executor | `open-sse/executors/adapters.manifest.js` (auto-gen), `getExecutor` async + singleflight |
| #2 fill-first warming | `src/lib/fillFirstWarmup.js`, toggle `fillFirstWarmupEnabled` |
| #3 Check Models cache | `src/lib/checkModelsCache.js`, route `src/app/api/providers/check-models/route.js` |
| #4 quota-aware fill-first | `src/sse/services/quotaIncidents.js`, `open-sse/config/quotaErrorClasses.js`, tabel `quota_incidents`, UI di `EndpointPageClient.js` |
| #5b Playground Compare | `providers/[id]/PlaygroundCompareTab.js` |
| #5c Probe LLM / fingerprint | baterai offline P1–P6, via BazaarLink; `BAZAARLINK_API_KEY` di server .env |
| #6 Check Models Auto Sync | `src/lib/checkModelsAutoSync.js` (recursive-setTimeout, HMR-safe), `autoSyncProviderIds` |
| #7 Replay request | `src/lib/requestReplayBuffer.js` (ring buffer in-memory, redaction fail-closed), API `src/app/api/replay-log/`, UI `console-log/ReplayTab.js` |
| #8 custom provider headers | `src/shared/utils/customHeaders.js`, node-level menang atas provider-level |
| Token Saver / RTK | `open-sse/rtk/` (`index.js`, `caveman.js`, `ponytail.js`, `headroom.js`, `pxpipe.js`) |
| Headroom dashboard | `dashboard/token-saver/headroom`, `src/lib/headroom/` |
| Hermes per-profile | API/Dashboard/CLI (port upstream v0.5.99) |
| Access control per-API-key | `accessRestricted`/`accessAllow`, enforcement 9 handler SSE + migrasi DB (port v0.5.99) |

## 6. API Routes Penting

| Route | Fungsi |
|---|---|
| `POST /api/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/embeddings`, `/v1/images/*`, `/v1/audio/*` | Inference gateway |
| `GET /api/v1/models` | Daftar model gabungan (live resolvers per provider) |
| `GET /api/providers` | Daftar koneksi (nama enriched utk compatible) |
| `GET /api/providers/[id]/models` | Import models per koneksi (dipakai tombol "Import from /models") |
| `POST /api/providers/check-models` | Check Models (mode all/provider; cache ide #3; auto-disable opsional) |
| `GET /api/quota-incidents` | Insiden kuota & error (+`providerName` enriched) |
| `GET/DELETE /api/replay-log` | Buffer replay ide #7 (+`providerName`) |
| `GET /api/pxpipe/stats` | Statistik pxpipe (+`providerName`) |
| `GET /api/settings`, `PATCH` via store | Settings (`src/store/settingsStore.js` → `patchSettings`) |
| `GET /api/translator/console-logs[/stream]` | Console log buffer (SSE) |

## 7. Dashboard Pages → Komponen Kunci

| Halaman | File kunci |
|---|---|
| Endpoint & Key | `(dashboard)/dashboard/endpoint/EndpointPageClient.js` — API keys, insiden kuota & error, warming, tunnel, settings toggles |
| Providers > detail | `providers/[id]/page.js`, `ConnectionRow.js`, `CompatibleModelsSection.js` (search + tab All/Premium/Free + Check Models), `PlaygroundSection.js` |
| Console Log | `console-log/ConsoleLogClient.js` → `ConsoleLogsTab.js` (raw lines), `ReplayTab.js` |
| Usage | `usage/components/ProviderLimits/index.js` |
| Basic Chat | `basic-chat/BasicChatPageClient.js` (`getProviderLabel`) |
| Token Saver / PxPipe | `pxpipe/PxpipeClient.js`, `token-saver/` |
| Translator Debug | `translator/page.js` (MetaBadge) |
| CLI Tools | `cli-tools/[toolId]/ToolDetailClient.js` + `components/*ToolCard.js` |
| Model picker shared | `src/shared/components/ModelSelectModal.js` |

## 8. Pola "Nama Provider Terbaca" (dibangun 2026-10-13)

Provider custom `openai-compatible-chat-<uuid>` tidak punya nama di
`AI_PROVIDERS` → selalu pakai hierarki **nama koneksi > nama AI_PROVIDERS >
id mentah**:

- `src/lib/providerDisplayName.js` — `providerDisplayName()`,
  `enrichWithProviderName()` (untuk API routes: quota-incidents, replay-log,
  pxpipe/stats).
- `open-sse/utils/providerLogLabel.js` — untuk log terminal server
  (dipakai chatCore.js 13 situs + streamingHandler.js).
- Client-side: fetch `/api/providers` → map provider→name (ConsoleLogsTab,
  translator page).

## 9. Auto-Disable Akun Suspend (2026-10-13)

- Detektor: `open-sse/utils/accountSuspension.js` — `isSuspensionSignal()`
  (HANYA 403/423 + /suspend/i; 401 dikecualikan).
- Aksi: `autoDisableSuspendedAccount()` — set `isActive=false` (fail-open),
  catat insiden, log `⛔ AKUN DI-SUSPEND`.
- Kelas error baru `suspended` di `open-sse/config/quotaErrorClasses.js`
  (didahulukan sebelum auth_error); masuk IMMEDIATE + NON_RETRYABLE di
  `src/sse/services/quotaIncidents.js`.
- Hook: error path `chatCore.js` (selalu aktif), `kiroModels.js`
  ListAvailableModels (selalu aktif), `check-models` POST (opsional via
  settings `suspendAutoDisableOnCheck`, **default OFF**).
- UI: toggle di Endpoint > Insiden Kuota & Error; badge "suspended" di
  ConnectionRow; peringatan di hasil Check Models.
- Re-enable: manual via toggle koneksi di dashboard.

## 10. Ledger Commit Kita (analisis dari `git log`)

Format: `hash` — subjek — file kunci — catatan.

### 2026-10-13

- **`eb775de7`** — Poin 1-3 (permintaan Egar). 11 file.
  - `EndpointPageClient.js`: state + handler + Toggle `suspendAutoDisableOnCheck`
    di kartu Insiden Kuota & Error (default OFF).
  - `check-models/route.js`: `httpStatus`/`errorBody` di hasil error;
    auto-disable bila toggle ON + `isSuspensionSignal()` → flag `autoDisabled`.
  - `CompatibleModelsSection.js`: peringatan UI bila `autoDisabled`.
  - `settingsRepo.js`: default `suspendAutoDisableOnCheck: false`
    (mergeWithDefaults → backward compatible).
  - `translator/page.js` + MetaBadge: nama koneksi (tooltip id mentah).
  - `providers/[id]/page.js` + `ConnectionRow.js`: badge "suspended"
    dari `/api/quota-incidents`.
- **`d06c458e`** — Fix Check Models + nama provider custom + auto-disable
  suspend + cascade hapus insiden (laporan Egar). 24 file, 366+/46-.
  - `check-models/route.js`: `checkViaConnectionBaseUrl()` — provider
    `openai-/anthropic-compatible-*` dicek via `{baseUrl}/models` dengan
    API key koneksi; warning kuning bila key kosong.
  - `src/lib/providerDisplayName.js` (baru): hierarki nama koneksi >
    AI_PROVIDERS > id mentah.
  - `open-sse/utils/providerLogLabel.js` (baru): label log terminal.
  - `open-sse/utils/accountSuspension.js` (baru): detektor + aksi
    auto-disable (fail-open).
  - `quotaErrorClasses.js`: kelas `suspended` (403/423 + "suspend",
    sebelum auth_error).
  - `src/sse/services/quotaIncidents.js`: suspended → IMMEDIATE +
    NON_RETRYABLE.
  - Hook: `chatCore.js` (jalur chat), `kiroModels.js` (ListAvailableModels).
  - `connectionsRepo.js`: `deleteProviderConnection` /
    `deleteProviderConnectionsByProvider` cascade hapus insiden
    (`quotaIncidentsRepo.removeIncidentsByConnection`, baru).
- **`d77c9157`** — Input pencarian daftar model detail provider
  (`CompatibleModelsSection.js` saja): filter case-insensitive by id model,
  digabung tab All/Premium/Free, counter "Menampilkan X dari Y".
  Permintaan Egar 2026-10-11.

### 2026-10-10

- **`59d29715`** — Port upstream v0.5.95→v0.5.99 (27 commit, 137 file).
  Provider baru: AWS Bedrock, MiniMax Code (+fix OAuth model list #4676),
  Token Harbor, Muse (`muse-spark-1.3-contributor`),
  4 agregator OpenAI-compatible (dahl, atria, agnes, bai),
  openrouter models 10-09/10-10/10-11. Hermes per-profile
  (API/Dashboard/CLI). Access control per-API-key (`accessRestricted`/
  `accessAllow`, 9 handler SSE + migrasi). #4659 dikecualikan. Versi tetap 1.5.0.

### 2026-10-03 → 2026-10-06

- **`99eaa100`** — Bersihkan instrumentasi measurement RTK & Ponytail
  (hapus `rtk/meter.js`, debug route, skrip ukur). KEPUTUSAN Egar:
  jangan ubah/tawarkan RTK/Ponytail lagi (workload multi-model).
- **`efbba793`** — Retensi `logs/` 10MB (data terbaru dipertahankan) via
  `requestLogger.js`; header `x-9router-ponytail`.
- **`f714fc52`** — Fail-fast connect timeout (`executors/base.js`); filter
  + export Replay tab; detail asal error; meter RTK.
- **`569ed746`** — Fix `ReferenceError: recordFailure is not defined`
  (laporan Egar) di `src/sse/services/auth.js` + regression test.

### 2026-10-02

- **`175dfbf1`** — Port upstream v0.5.91→v0.5.95 (39/41 commit). Provider Meta
  Muse (alias "muse-code" upstream DIBUANG — bentrok provider lokal, dikunci
  regression test). CLI `connect` (`AKANESIA_GATEWAY_PASSWORD`).
  Bug upstream `existingProvider` undefined diperbaiki (tidak di-port mentah).

### 2026-09-30 (batch rename & branding)

- **`77792a3f`** — Rename 9router → akanesia-router / Akanesia-Gateway v1.5.0
  (730 file). Disengaja TIDAK diubah: `sk_9router`, `x-9router-*`, nama DB,
  localStorage keys, `~/.9router`, `.9router`.
- **`5b2edd67`** — Logo (A putih di merah) + favicon.
- **`d3022591`** — Fix dialog "Open with" Token Saver Windows: probe binary
  tanpa shell (`src/lib/platform.js` baru).
- **`3f76a9d6`** — Fix EBADF double-close setelah Stop Headroom.
- **`43f91f0d`** — Buka Headroom dashboard di tab baru dari modal Setup.
- **`9dd84566`** — Dashboard Headroom Token Saver.

### Pola commit Egar

- Semua commit atas instruksi eksplisit ("oke commit + push sekarang",
  "oke lakukan commit dan push"). Pesan commit Bahasa Indonesia.
- Upstream di-port via `git fetch` + cherry-pick manual ke branch lokal,
  TIDAK merge. Working tree OmniRoute/upstream tidak pernah disentuh.

## 11. Konvensi & Aturan Kerja (jangan dilanggar)

- **Review-first**: jangan commit/push tanpa instruksi eksplisit Egar
  ("oke commit + push sekarang", "oke, commit dan push kalau begitu").
- "Cuman tanya" → jangan ubah/instal/tawarkan kerjaan.
- "Analisa dulu, untuk perubahan tunggu konfirmasi saya" → diagnosis saja.
- Port gateway Egar: **20127** (dev server 20127 jangan dinyalakan).
- Teks user-visible: Bahasa Indonesia. Jangan tampilkan secret/API key.
- `node --check` RUSAK untuk ESM di Node v24 (selalu exit 0) → pakai ESLint/build.
- Vitest: `npx vitest run --config tests/vitest.config.js <file>`.
- Fetch-on-open di useEffect disengaja (AGENTS.md #10) → eslint-disable, jangan refactor.
- OmniRoute (`~/workspace/OmniRoute-sparse`): HANYA acuan provider/model;
  `git fetch` + baca `origin/release/v3.8.51`; JANGAN merge/pull/reset.
- Upstream 9router (`~/workspace/9router-upstream`): sumber diff port manual.
- Jangan samakan "9router" (upstream decolua) dengan "akanesia-router" (milik Egar).
- Test: 344 file di `tests/unit/`; build: `npm run build` (~40-70 dtk).

## 12. Lokasi Log & Debug

- Log terminal server: stdout proses (PowerShell/CMD) — baris `▶ POST`,
  `[PROXY]`, `📊 DONE`, `⛔ AKUN DI-SUSPEND`.
- `logs/` — dibatasi 10MB otomatis (data terbaru dipertahankan).
- Console Log dashboard: `src/lib/consoleLogBuffer.js` (SSE stream).
- Replay buffer: `src/lib/requestReplayBuffer.js` (in-memory, tidak persist).
