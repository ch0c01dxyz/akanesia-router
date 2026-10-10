# SECURITY — Akanesia-Gateway

> Prinsip repo: **security-first pada PR** — audit auth, penyimpanan kredensial/token,
> kebocoran header, `X-Forwarded-For`, dan SSRF sebelum logika fungsional.

## 1. Secret & env (dari `.env.example` — nilai tidak ditampilkan di sini)

| Secret | Peran | Risiko bila bocor/default |
|---|---|---|
| `JWT_SECRET` | Signing/verifikasi cookie sesi dashboard | Session forgery |
| `INITIAL_PASSWORD` | Password awal dashboard (contoh default `123456`) | **Wajib diganti** di deployment nyata |
| `API_KEY_SECRET` | HMAC untuk format API key lokal | Pemalsuan API key |
| `MACHINE_ID_SALT` | Salt fingerprint mesin | Korelasi instance |

Aturan:

- File `.env`, varian `.env.*`, dan backup `.env.backup` diabaikan Git dan Docker,
  termasuk di subdirektori. Hanya template `.env.example` tanpa kredensial nyata
  yang boleh dilacak. `.npmignore` tetap mengecualikan file env dari paket npm.
- Sebelum memperbarui checkout lama, backup `.env` lalu restore sesudah pull;
  lihat [panduan migrasi F-01](DEPLOYMENT.md#memperbarui-checkout-lama-f-01).
- Menghapus `.env` dari tracking tidak menghapusnya dari riwayat commit lama.
  Perubahan ini tidak menulis ulang riwayat Git atau merotasi kredensial.
  Bila kredensial pernah terekspos, rotasi kredensial terkait secara terpisah.
- Jangan hardcode secret di kode; jangan tampilkan nilai secret di log/laporan.
- File `jwt-secret` di DATA_DIR dibuat dengan mode `0o600`.

## 2. Auth surfaces

- **Dashboard:** cookie httpOnly + JWT (`jose`); password di-hash `bcryptjs`;
  `loginLimiter.js` melawan brute force; OIDC/SAML tersedia (`src/app/api/auth/*`).
- **Gateway `/v1/*`:** API key lokal bila `REQUIRE_API_KEY=true`; verifikasi HMAC
  di `src/shared/utils/apiKey.js`.
- **CLI token:** `x-9r-cli-token` di `src/proxy.js` (middleware).

## 3. Anti IP-spoofing (`custom-server.js`)

- IP klien diturunkan dari TCP socket (`remoteAddress`), bukan dari header.
- Header kiriman klien (`x-9r-real-ip`, `x-forwarded-for`, `x-real-ip`,
  `x-9r-peer-token`) dihapus.
- `X-Forwarded-For`/`X-Real-IP` hanya dipercaya dari loopback reverse proxy;
  hasilnya disimpan di `x-9r-real-ip` untuk rate limiting + token `NINEROUTER_PEER_TOKEN`.
- Jangan ubah logika ini tanpa analisis keamanan.

## 4. Penyimpanan kredensial

- Provider secrets (API keys, access/refresh tokens, OAuth data) tersimpan di
  SQLite (`providerConnections`) — **lindungi di level filesystem** (permission
  file, volume Docker).
- `usage.json`/`log.txt` berisi metadata request — perlakukan sebagai sensitif.
- `ENABLE_REQUEST_LOGS=true` menulis **header/body penuh** ke `<repo>/logs/` —
  jangan aktifkan di production tanpa alasan; direktori log = sensitif.

## 5. SSRF & outbound

- `src/shared/utils/ssrfGuard.js` — guard untuk URL yang dimasukkan user.
- Outbound proxy via env (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`);
  `proxyAwareFetch` mem-patch global fetch — pahami sebelum mengubah perilaku fetch.

## 6. OAuth & token

- Token refresh terdedup via lock (`tokenRefresh/dedup.js`, `oauthCredentialManager.js`).
- Jangan log token mentah; `applyAuth` memakai descriptor dari registry —
  pastikan `transport.auth` benar agar token tidak terkirim ke header yang salah.

## 7. Hal yang diaudit tiap PR

- [ ] Auth & session handling
- [ ] Penyimpanan & kebocoran kredensial/token (kode, log, response, error message)
- [ ] Manipulasi header (`X-Forwarded-For`, auth headers)
- [ ] Risiko SSRF pada input URL
- [ ] Permission file secret & direktori data
