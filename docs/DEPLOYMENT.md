# DEPLOYMENT — Akanesia-Gateway

## Menjalankan dari source

```bash
cp .env.example .env     # isi JWT_SECRET, INITIAL_PASSWORD, dst.
npm install
npm run dev              # dev, port 20127 (lihat package.json)
npm run build && npm start   # production via custom-server.js
```

Varian Bun: `npm run dev:bun` / `build:bun` / `start:bun`.
Port production default: **20128** (Docker, `custom-server.js`, dokumentasi).
Script npm dev/start memakai **20127** — perhatikan perbedaan ini.

Setelah jalan:

- Dashboard: `http://localhost:<port>/dashboard`
- API: `http://localhost:<port>/v1` (rewrite ke `/api/v1/*`)
- Health: `GET /api/health` → `{"ok":true}`

## Environment variables

Kontrak lengkap di `.env.example`. Yang wajib:

| Var | Peran |
|---|---|
| `JWT_SECRET` | Secret signing JWT sesi dashboard |
| `INITIAL_PASSWORD` | Password awal dashboard (default contoh `123456` — WAJIB diganti) |
| `DATA_DIR` | Direktori data (`<DATA_DIR>/db/data.sqlite`) |

Opsional penting:

| Var | Peran |
|---|---|
| `PORT` / `HOSTNAME` / `NODE_ENV` | Runtime server |
| `API_KEY_SECRET` | HMAC untuk API key lokal |
| `MACHINE_ID_SALT` | Salt fingerprint mesin |
| `REQUIRE_API_KEY` | Wajibkan API key untuk `/v1/*` |
| `AUTH_COOKIE_SECURE` | Cookie secure flag |
| `ENABLE_REQUEST_LOGS` | Log request/response penuh (sensitif!) |
| `OBSERVABILITY_ENABLED` | Observability |
| `BASE_URL` / `CLOUD_URL` / `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_CLOUD_URL` | URL instance & cloud sync |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` (+ lowercase) | Outbound proxy untuk upstream |
| `SEARXNG_URL` | Endpoint SearXNG untuk web-search bawaan |

## Docker

`Dockerfile` multi-stage (base → builder → runner), base `node:22-alpine`:

- Build args: `ALPINE_MIRROR`, `NPM_REGISTRY` (bisa dioverride untuk mirror regional).
- Runner: `NODE_ENV=production`, `PORT=20128`, `HOSTNAME=0.0.0.0`, `DATA_DIR=/app/data`;
  hanya salin hasil build Next standalone + `public`, `custom-server.js`, `open-sse`,
  `src/mitm`, dan node_modules yang lolos tracing.
- Entrypoint `/entrypoint.sh` (chown data dir → `su-exec node`); CMD `node custom-server.js`.
- Berjalan sebagai user non-root `node`. `EXPOSE 20128`.

```bash
docker build -t akanesia-router .
docker run -d --name akanesia-router -p 20128:20128 --env-file .env -v 9router-data:/app/data akanesia-router
# atau via script:
./start.sh
```

`docker-compose.yml` — dua service:

- `akanesia-router` (image `ch0c01dxyz/akanesia-router:latest`, volume `9router-data` → `/app/data`,
  `env_file: .env`, `HEADROOM_URL: http://headroom:8787`)
- `headroom` (sidecar token saver, `ghcr.io/chopratejas/headroom:latest`, port 8787)

Data persisten: `$DATA_DIR/db/data.sqlite` (di container: `/app/data/db/data.sqlite`).

## CI/CD (GitHub Actions)

`.github/workflows/`:

| Workflow | Trigger | Fungsi |
|---|---|---|
| `docker-publish.yml` | push tag `v*` / manual | Build multi-platform (amd64+arm64) + health-check `/api/health` → publish ke `ghcr.io/ch0c01dxyz/akanesia-router` dan `ch0c01dxyz/akanesia-router` (`:X.Y.Z` + `:latest`) |
| `gitbook-pages.yml` | — | Deploy GitBook ke `9router.github.io` |
| `tray-binaries.yml` | manual | Build tray binary macOS arm64 |

Tidak ada workflow CI untuk menjalankan test otomatis.

## CapRover

`captain-definition` (schemaVersion 2) hanya menunjuk `dockerfilePath: ./Dockerfile`.

## CLI launcher

Paket npm `akanesia-router` (`cli/`) — launcher yang menginstal/memulai server:

```bash
npm install -g akanesia-router
akanesia-router
```

Native deps (systray) tidak dibundle; diinstal lazy ke
`~/.9router/runtime/node_modules` oleh `hooks/postinstall.js`.

## Checklist verifikasi deployment

- [ ] `GET /api/health` → ok
- [ ] `GET /api/settings` → ok (butuh login bila `requireLogin`)
- [ ] `GET /api/v1/models` → daftar model
- [ ] `JWT_SECRET` dan `INITIAL_PASSWORD` diganti dari default
- [ ] Volume data ter-mount persisten (Docker)
- [ ] `ENABLE_REQUEST_LOGS=false` di production
