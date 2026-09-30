# TESTING — Akanesia-Gateway

## Framework & lokasi

- **Vitest 4.0.0**, paket independen di `tests/` (`9router-tests`) — bukan `npm test` root.
- Config: `tests/vitest.config.js` — `environment: node`, `globals: true`,
  `include: **/*.test.js`, `maxConcurrency: 60`.
- Alias path: `open-sse/…` → `../open-sse`, `@/…` → `../src`.

## Cara run yang benar

```bash
cd tests && npm install          # sekali saja (vitest)
# dari root repo:
npx vitest run --config tests/vitest.config.js "tests/translator/"      # offline/no-cred
npx vitest run --config tests/vitest.config.js "tests/unit/<file>"      # satu file
RUN_REAL=1 npx vitest run --config tests/vitest.config.js "tests/translator/real/"  # live
```

> Script `test` di `tests/package.json` memakai `NODE_PATH` hardcoded (workaround
> upstream) — abaikan, pakai bentuk `npx vitest` di atas.

## Struktur test

| Direktori | Isi |
|---|---|
| `tests/unit/` | ±250 file: provider, translator, OAuth, DB, security, combo, custom-server, … |
| `tests/translator/` | Golden/roundtrip/coverage test translator (+ `matrix.js`, `registerAll.js`, `AGENTS.md`) |
| `tests/translator/real/` | Live provider test — butuh kredensial, skip bila tidak ada |
| `tests/auth/` | `saml.test.js` |
| `tests/__baseline__/` | Snapshot + script verifikasi non-regression |

## Aturan penting

- Test translator yang memakai `translateRequest`/`translateResponse` **wajib**
  `import "./registerAll.js"` (side-effect registry) — tanpanya test false-pass.
- `tests/translator/real/*.real.test.js` membaca kredensial dari
  `~/.9router/db/data.sqlite`; error 401/402/403/429 = masalah kredensial → skip, bukan fail.

## Known fails & baseline

- Suite **tidak diharapkan hijau semua** pada checkout polos (±938 lolos, ±64 gagal).
- `tests/__baseline__/known-fails.txt` — katalog kegagalan yang diketahui
  (rtk, oauth-cursor-auto-import, translator-request-normalization, …).
- Regresi dinilai via `tests/__baseline__/verify-no-regression.mjs`, bukan run mentah.
- Script `snapshot-*.mjs` / `verify-*.mjs` membandingkan snapshot registry, alias, OAuth URLs —
  jalankan setelah menyentuh provider registry / logika alias.

## Cek cepat non-vitest

- `node --check <file.js>` — validasi syntax satu file (cepat, tanpa dependency).
- Script ad-hoc di `/tmp` untuk simulasi logika (mis. auth descriptor, combo state).

## Cakupan saat ini (ringkas)

- Combo routing: `tests/unit/combo-routing.test.js` (round-robin, fill-first).
- Translator: golden + roundtrip + matrix coverage per pasangan format.
- Security: test custom-server (IP spoofing), auth, SSRF guard.
- DB: repo & migrasi SQLite.
