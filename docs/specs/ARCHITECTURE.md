# ARCHITECTURE — Akanesia-Gateway (Overview)

> Versi detail: `docs/ARCHITECTURE.md`. Versi mesin routing: `open-sse/AGENTS.md`.

## Gambaran tingkat tinggi

```
CLI Tools (Claude Code, Codex, Cursor, Cline, ...)
        │  http://localhost:20128/v1   (rewrite → /api/v1/*)
        ▼
┌───────────────────────────────────────────────────┐
│ Akanesia-Gateway (Next.js 16 + open-sse engine)             │
│                                                   │
│  src/app/api/v1/* ──→ src/sse/handlers/* (glue)   │
│                           │                       │
│                           ▼                       │
│                    open-sse engine                 │
│   ┌──────────┐  ┌────────────┐  ┌──────────────┐   │
│   │ RTK/token│  │ Translator │  │  Executors   │   │
│   │  savers  │→ │ OAI↔Claude │→ │ per-provider │   │
│   └──────────┘  │ ↔Gemini... │  │  upstream    │   │
│                 └────────────┘  └──────────────┘   │
│  Combo fallback → Account fallback → Token refresh │
└───────────────────────┬───────────────────────────┘
                        ▼
        Upstream providers (300+): OAuth / API key / Free
```

## Lapisan utama

| Lapisan | Lokasi | Tanggung jawab |
|---|---|---|
| Compatibility API | `src/app/api/v1/*`, `v1beta/*` | Endpoint OpenAI/Claude/Gemini-compatible untuk klien |
| Entry glue | `src/sse/handlers/*` | Parse request, combo expansion, account-selection loop |
| Routing core | `open-sse/handlers/chatCore.js` | Deteksi format → translasi → dispatch executor → streaming |
| Translation | `open-sse/translator/*` | Konversi format, pivot via OpenAI, direct route untuk pasangan rapuh |
| Execution | `open-sse/executors/*` | Panggilan upstream; `DefaultExecutor` untuk OpenAI-compatible |
| Provider config | `open-sse/providers/registry/*` | Single source of truth (319 file provider) |
| Routing policy | `open-sse/services/*` | combo (fallback/round-robin/fill-first), accountFallback, tokenRefresh |
| Token savers | `open-sse/rtk/*` | Kompres tool_result (fail-open) |
| Dashboard | `src/app/(dashboard)/dashboard/*` | UI manajemen (React 19 + Tailwind 4) |
| Management API | `src/app/api/*` | CRUD provider, combos, keys, usage, settings |
| Persistence | `src/lib/db/*` | SQLite dengan 4-driver fallback chain |

## Alir request chat (ringkas)

1. `POST /v1/chat/completions` → rewrite → `src/app/api/v1/chat/completions/route.js`
   → `src/sse/handlers/chat.js`.
2. Parse model (`provider/model` atau nama combo) → combo expansion bila perlu.
3. Account-selection loop: pilih kredensial akun yang sehat (`src/sse/services/auth.js`).
4. `open-sse/handlers/chatCore.js`: deteksi format sumber → RTK (pre-translate khusus
   cursor) → `translateRequest` → token savers (fail-open) → `getExecutor(provider)`.
5. Executor panggil upstream; 401/403 → `refreshCredentials` + retry sekali.
6. `translateResponse` → SSE ke klien; usage diekstrak ke `usageDb`.

## Keputusan arsitektur kunci

- **Pivot OpenAI:** semua translasi melewati format OpenAI sebagai intermediate;
  pasangan rapuh (thinking blocks, tool id) memakai *direct route*.
- **Config-driven:** seluruh definisi provider di registry; `open-sse/config/` hanya derivasi.
- **Fail-open token savers:** error di RTK/headroom/caveman tidak boleh menggagalkan request.
- **Fallback berlapis:** combo model → akun lain → refresh token → error.
- **SQLite multi-driver:** `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js`
  agar install tidak pernah gagal di platform mana pun.

## Status operasional yang perlu diketahui

- `open-sse/providers/registry/index.js` adalah file auto-generated — regen via
  `node scripts/generate-registry-index.mjs` setiap kali registry berubah.
  (Per Sep 2026: 25 entry baru belum masuk index — perlu regen.)
- `custom-server.js` memproteksi IP klien dari spoofing `X-Forwarded-For`.
- Test suite vitest di `tests/` adalah paket independen; ada daftar known-fails
  (`tests/__baseline__/known-fails.txt`) — regresi dinilai via script baseline,
  bukan run mentah.
