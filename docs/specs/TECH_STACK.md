# TECH_STACK — Akanesia-Gateway

> Versi package: `akanesia-router` **1.5.0** (root) dan `akanesia-router` **1.5.0** (`cli/`).
> Sumber versi dependency: `package.json` (root).

## Runtime & framework

| Komponen | Teknologi | Versi |
|---|---|---|
| Runtime | Node.js | 20+ (Docker: `node:22-alpine`) |
| Framework server | Next.js | 16.1.6 (App Router, `output: standalone`) |
| UI | React | 19.2.4 |
| Styling | Tailwind CSS | 4 (+ `@tailwindcss/postcss`) |
| Bahasa | JavaScript ESM | tanpa TypeScript |
| Custom server | `custom-server.js` | wrap Next standalone (proteksi IP spoofing) |

## Data & state

| Komponen | Teknologi | Keterangan |
|---|---|---|
| Database | SQLite | 3-driver fallback: `bun:sqlite` → `node:sqlite` (≥24, built-in) → `sql.js` (pure JS) |
| Lokasi DB | `~/.9router/db/data.sqlite` | via `DATA_DIR` env atau default per-OS |
| Usage/log | `usage.json` + `log.txt` | di `~/.9router`, tidak ikut `DATA_DIR` |
| State frontend | zustand | 5.0.10 (`src/store/`) |
| Migrasi | `src/lib/db/migrations/` | `001-initial.js` + runner |

## Protokol & streaming

- **SSE** (Server-Sent Events) untuk semua streaming chat/completion.
- **http-proxy-middleware** 3.0.5, **undici** 7.19.2, **socks-proxy-agent** 8.0.5
  (outbound proxy), `proxyAwareFetch` mem-patch global fetch.
- **express** 5.2.1 (dipakai di area tertentu, mis. MITM/tooling).

## Auth & keamanan

| Komponen | Teknologi |
|---|---|
| Session dashboard | JWT via **jose** 6.1.3, cookie httpOnly |
| Password | **bcryptjs** 3.0.3 |
| SSO enterprise | **@node-saml/node-saml** 5.1.0 (SAML), OIDC |
| API key lokal | HMAC (`API_KEY_SECRET`) |
| TLS/MITM | **node-forge** 1.3.3, **selfsigned** 5.5.0 |

## UI libraries

| Library | Versi | Pakai untuk |
|---|---|---|
| `@dnd-kit/*` | 6.x–10.x | drag & drop |
| `@xyflow/react` | 12.10.1 | graph/flow UI |
| `@monaco-editor/react` | 4.7.0 | editor kode |
| `recharts` | 3.7.0 | grafik usage |
| `material-symbols` | 0.44.6 | ikon |
| `marked` | 18.0.1 | render markdown |
| `prop-types` | 15.8.1 | validasi props |

## Utilitas penting

| Library | Versi | Pakai untuk |
|---|---|---|
| `uuid` | 13.0.0 | id unik |
| `chalk` / `ora` | 5.6.2 / 9.1.0 | CLI output |
| `confbox` | 0.2.4 | config |
| `node-machine-id` | 1.1.12 | fingerprint mesin |
| `open` | 11.0.0 | buka browser dari CLI |

## Testing & kualitas

| Komponen | Teknologi |
|---|---|
| Test framework | **vitest** 4.0.0 (paket independen di `tests/`) |
| Lint | **eslint** 9 + `eslint-config-next` |
| CSS build | PostCSS 8.5.6 |

## i18n

- Runtime: `src/i18n/` (20+ locale: en, id, vi, zh-CN, zh-TW, ja, pt-BR, ko, es, de, fr, …).
- README diterjemahkan ke 10 bahasa di `i18n/` (dibuat via `scripts/translate-readme.js`).

## Deployment

- **Docker**: multi-stage (`node:22-alpine`), user non-root `node`, port `20128`,
  volume `/app/data`, sidecar opsional Headroom (`docker-compose.yml`).
- **CI**: GitHub Actions — `docker-publish.yml` (multi-platform amd64+arm64 ke
  GHCR + Docker Hub), `gitbook-pages.yml`, `tray-binaries.yml`.
- **CapRover**: `captain-definition` menunjuk Dockerfile.
- **CLI launcher**: paket npm `akanesia-router` (`cli/`), lazy-install native deps ke
  `~/.9router/runtime/node_modules`.
