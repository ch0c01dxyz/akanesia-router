# Akanesia-Gateway (`akanesia-router`)

Gateway routing AI lokal + dashboard web. Satu endpoint kompatibel OpenAI (`/v1/*`)
yang me-routing request ke 300+ provider upstream — dengan translasi format,
combo fallback, multi-account, quota tracking, dan token saver.

> Nama paket: `akanesia-router` · Versi: `1.5.0` · Sebelumnya dikenal sebagai 9Router.

## Fitur Utama

- **Smart routing** — round-robin & fill-first antar akun/koneksi per provider
- **Combo fallback** — berantai otomatis: langganan → murah → gratis, tanpa downtime
- **RTK Token Saver** — kompres otomatis `tool_result`, hemat 20–40% token
- **Quota tracking** — pantau pemakaian & sisa kuota tiap koneksi dari dashboard
- **Translasi format** — OpenAI ↔ Claude ↔ Gemini, satu endpoint untuk semua
- **Universal** — kompatibel dengan Claude Code, Cursor, Cline, Codex, OpenCode, dan CLI tools lainnya
- **Local-first** — berjalan lokal/intranet, data tetap di mesin sendiri

## Mulai Cepat

```bash
cp .env.example .env && npm install
npm run dev      # dev server, port 20127
```

```bash
npm run build    # production build
npm start        # production server (default port 20128)
```

Arahkan CLI tool favoritmu ke `http://localhost:20128/v1` dan mulai pakai.

Perintah lain: `npx eslint .` untuk lint. Test ada di paket terpisah `tests/`
(vitest) — lihat `docs/TESTING.md`.

## Dokumentasi

- `docs/specs/` — dokumen struktur proyek: `AGENTS.md`, `ARCHITECTURE.md`,
  `CLAUDE.md`, `DESIGN.md`, `PRD.md`, `RULES.md`, `TECH_STACK.md`
  (panduan wajib dibaca sebelum mengubah repo ini)
- `docs/` — panduan deployment, keamanan, testing, changelog, dan ide pengembangan
- `open-sse/` — mesin routing & translasi provider (lihat `open-sse/AGENTS.md`
  bila menyentuh area ini)

## Lisensi

Apache License 2.0 — lihat file `LICENSE`.
