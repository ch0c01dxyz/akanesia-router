# PRD Detail per Area — Akanesia-Gateway

> Ringkasan produk: `PRD.md` di root.

## A. Gateway Routing (`/v1/*`)

**Tujuan:** Satu endpoint kompatibel OpenAI untuk semua CLI tool.
**Cakupan:**

- `POST /v1/chat/completions`, `/v1/messages` (Claude), `/v1/responses` (Codex),
  `/v1/models`, `/v1/embeddings`, `/v1/images/*`, `/v1/videos/*`,
  `/v1/audio/*` (TTS/STT), `/v1/search`, `/v1/web/fetch`, `/v1beta/models`.
- Rewrite Next: `/v1/:path*` → `/api/v1/:path*` (+ alias `/codex/*`, `/responses`).
- Model reference `provider/model` atau nama combo/alias.
- Auth klien: `Authorization: Bearer <api-key lokal>` (bila `REQUIRE_API_KEY`).

## B. Provider Management

**Tujuan:** Kelola 300+ koneksi provider dari dashboard.
**Cakupan:**

- Kategori: OAuth, API key, free tier, custom compatible nodes.
- Multi-account per provider (round-robin + fallback).
- Test koneksi, test batch, validasi kredensial.
- **Check Models** (`POST /api/providers/check-models`): mode `all` / `provider`;
  timeout 15s, concurrency 5; hasil: ok/failed/skipped + latency + daftar model.
- Suggested models, import dari `/models`, custom models, model aliases.
- Halaman: `/dashboard/providers`, `/dashboard/providers/[id]`.

## C. Model Combos

**Tujuan:** Urutan model dengan fallback otomatis sesuai kebutuhan user.
**Cakupan:**

- Strategi: `fallback` (urutan), `round-robin` (rotasi + sticky limit),
  `fill-first` (menetap di model yang sukses sampai gagal).
- Combo presets; CRUD via `/api/combos`.
- Halaman: `/dashboard/combos`.

## D. Format Translation

**Tujuan:** Klien apapun bisa memakai provider apapun.
**Cakupan:**

- 14 format (`formats.js`): openai, openai-responses, claude, gemini, gemini-cli,
  vertex, codex, antigravity, kiro, cursor, ollama, commandcode, clova, …
- Pivot via OpenAI; direct route untuk pasangan rapuh (thinking, tool id).
- Halaman debug: `/dashboard/translator`.

## E. Token Savers

**Tujuan:** Hemat token input/output.
**Cakupan:**

- **RTK**: kompres `tool_result` otomatis (default ON; opt-out via header
  `x-9router-token-saver: off`).
- **Headroom**: proxy kompresi eksternal (opsional, sidecar Docker).
- **Caveman/Ponytail**: injeksi system prompt untuk output lebih ringkas.
- Halaman: `/dashboard/token-saver`.

## F. Media Providers

**Tujuan:** Image/video/TTS/STT/embedding lewat endpoint `/v1/*` yang seragam.
**Cakupan:**

- Adapter per-provider di `open-sse/handlers/{imageProviders,videoProviders,ttsProviders,…}/`.
- Config-driven via `PROVIDER_MEDIA` (`ttsConfig`, `sttConfig`, `embeddingConfig`, …).
- Halaman: `/dashboard/media-providers`.

## G. Usage & Quota

**Tujuan:** Visibilitas biaya dan pemakaian.
**Cakupan:**

- Tracking token per request (ekstraksi usage + estimasi fallback).
- Quota tracking per provider (parser di `open-sse/services/usage/`).
- Grafik, riwayat, request details, log.
- Halaman: `/dashboard/usage`, `/dashboard/quota`.

## H. CLI Tools Integration

**Tujuan:** Konfigurasi satu-klik untuk ±17 CLI tools.
**Cakupan:**

- Kartu per tool (Claude, Codex, Kilo, Antigravity, OpenCode, …) menulis config lokal.
- Endpoint helpers: `/api/cli-tools/*`.
- Halaman: `/dashboard/cli-tools`.

## I. Cloud Sync (opsional)

**Tujuan:** Konfigurasi sama di semua device.
**Cakupan:**

- Enable/sync/disable via `/api/sync/cloud`; scheduler periodik.
- Sync providers/aliases/combos/keys per `machineId`.

## J. MITM Proxy (advanced)

**Tujuan:** Observabilitas trafik HTTPS CLI tools.
**Cakupan:**

- Server mandiri di `src/mitm/` (intercept 443, sertifikat per-domain).
- Halaman: `/dashboard/mitm`.

## K. Dashboard & Settings

- Home, basic-chat (playground), profile, endpoint settings, proxy-pools,
  pxpipe, console-log, skills marketplace, i18n (20+ locale).
- Settings: database, require-login, pricing overrides, tags.
