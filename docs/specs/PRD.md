# PRD — Akanesia-Gateway

> Ringkasan produk. PRD detail per area fitur: `docs/PRD.md`.

## 1. Apa itu Akanesia-Gateway

Akanesia-Gateway adalah **AI routing gateway lokal + dashboard web** yang menyediakan satu
endpoint kompatibel OpenAI (`/v1/*`) dan me-routing request ke 300+ provider AI
upstream. Positioning (dari README): *"FREE AI Router & Token Saver — Never stop
coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models."*

## 2. Masalah yang diselesaikan

- Kuota subscription AI terbuang tiap bulan; rate limit menghentikan kerja di tengah jalan.
- Output tool (git diff, grep, ls) membakar token dengan cepat.
- API mahal ($20–50/bulan per provider); switching provider manual merepotkan.

## 3. Pengguna target

Developer yang memakai CLI coding tools: **Claude Code, Codex, Cursor, Cline,
OpenCode, Antigravity, OpenClaw, Gemini CLI, Copilot** — dan ingin satu endpoint
lokal dengan fallback otomatis antar provider/akun.

## 4. Fitur utama

| Fitur | Deskripsi |
|---|---|
| Smart 3-Tier Fallback | Routing otomatis: Subscription → Murah → Gratis |
| Model Combos | Urutan model custom dengan strategi `fallback`, `round-robin`, `fill-first` |
| Multi-Account | Banyak akun per provider, round-robin + fallback |
| Format Translation | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex, dst. |
| RTK Token Saver | Kompres `tool_result` otomatis, hemat 20–40% token input |
| Headroom / Caveman / Ponytail | Token saver tambahan (opsional) |
| OAuth + API Key Management | Koneksi provider, auto token refresh |
| Quota Tracking | Hitung token live + countdown reset |
| Usage Analytics | Token, biaya, tren |
| Check Models | Verifikasi endpoint `/models` per provider / semua provider |
| Media Providers | Image, video, TTS, STT, embedding via endpoint `/v1/*` |
| CLI Tools Integration | Kartu konfigurasi ±17 CLI tools |
| Cloud Sync | Sinkronisasi konfigurasi antar device (opsional) |
| MITM Proxy | Intercept trafik HTTPS CLI tools untuk observabilitas |
| Multi-bahasa | UI + README dalam 10+ bahasa |

## 5. Cara pakai (ringkas)

1. Install & jalankan → dashboard di `http://localhost:20128`.
2. Hubungkan provider (gratis: Kiro AI, OpenCode Free; atau OAuth/API key).
3. Arahkan CLI tool ke `http://localhost:20128/v1` dengan API key dari dashboard,
   model format `provider/model` (mis. `kr/claude-sonnet-4.5`) atau nama combo.

## 6. Ruang lingkup / non-goals

- **In scope:** gateway lokal, dashboard manajemen, auth provider, translasi format,
  SSE streaming, persistensi lokal, usage tracking, cloud sync orchestration.
- **Out of scope:** implementasi cloud service di balik `CLOUD_URL`, SLA provider
  upstream, binary CLI tools itu sendiri.

## 7. Metrik sukses

- Request berhasil di-routing dengan fallback tanpa downtime yang dirasakan user.
- Penghematan token terukur via RTK (klaim 20–40%).
- Latency overhead gateway minimal vs direct call.
- 300+ provider terdaftar dan tervalidasi di registry.
