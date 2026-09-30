# AGENTS.md — Panduan Kerja Agen di Repo akanesia-router

> Dibuat dari eksplorasi langsung repo (v1.5.0). Untuk arsitektur penuh baca `docs/ARCHITECTURE.md`,
> untuk mesin routing baca `open-sse/AGENTS.md`, untuk perintah dasar baca `CLAUDE.md`.

## Apa ini

Akanesia-Gateway (`9router-app`) — AI routing gateway lokal + dashboard Next.js. Satu endpoint
kompatibel OpenAI (`/v1/*`) yang me-routing request ke 300+ provider upstream dengan
translasi format, combo fallback, multi-account fallback, OAuth/API-key management,
token refresh, quota tracking, dan token saver (RTK/Headroom/Caveman/Ponytail).

## Perintah penting

```bash
cp .env.example .env && npm install
npm run dev          # dev server (port 20127 via script; prod default 20128)
npm run build        # production build (webpack)
npm start            # production via custom-server.js
npx eslint .         # lint
```

Test (paket vitest terpisah di `tests/`, bukan `npm test` di root):

```bash
cd tests && npm install
npx vitest run --config tests/vitest.config.js "tests/translator/"   # offline
npx vitest run --config tests/vitest.config.js "tests/unit/<file>"    # satu file
node --check <file.js>   # cek syntax cepat untuk satu file
```

Regenerasi registry (WAJIB setelah tambah/ubah `open-sse/providers/registry/*.js`):

```bash
node scripts/generate-registry-index.mjs
```

## Peta direktori

| Direktori | Peran |
|---|---|
| `src/app/` | Next.js App Router: `(dashboard)/` UI, `api/` route API |
| `src/app/api/v1/*` | API kompatibel OpenAI/Claude/Gemini (`/v1/*` di-rewrite ke `/api/v1/*`) |
| `src/sse/` | Glue entry: parse request, combo expansion, account-selection loop |
| `open-sse/` | Mesin routing/translation provider-agnostic (chat, image, embedding, tts, stt, search, video) |
| `open-sse/providers/registry/` | Satu file per provider — **single source of truth** konfigurasi provider |
| `open-sse/executors/` | Adapter per-provider upstream; `default.js` untuk OpenAI-compatible |
| `open-sse/translator/` | Konversi format client ↔ provider (pivot via OpenAI) |
| `open-sse/services/` | combo, accountFallback, model parse, tokenRefresh, oauthCredentialManager |
| `open-sse/rtk/` | RTK token saver (kompres tool_result, fail-open) |
| `src/lib/db/` | Lapisan SQLite (adapter fallback chain), repo per-entity di `repos/` |
| `src/shared/` | UI kit dashboard (components, constants, hooks, utils) |
| `src/store/` | State frontend (zustand) |
| `cli/` | Paket launcher npm `akanesia-router` (terpisah, versi independen) |
| `tests/` | Vitest (paket independen) |
| `skills/` | Skill agen untuk memakai gateway via REST |

## Konvensi kritis (wajib dipatuhi)

1. **Registry adalah single source of truth.** Tambah provider = copy
   `open-sse/providers/REGISTRY_TEMPLATE.js` → `open-sse/providers/registry/{id}.js`,
   lalu jalankan `scripts/generate-registry-index.mjs`. **JANGAN edit
   `open-sse/providers/registry/index.js` manual** (auto-generated).
2. **Translator lazy-load.** File translator baru WAJIB didaftarkan di
   `TRANSLATOR_MANIFEST` (`open-sse/translator/index.js`), bukan via static
   import — modul di-load on-demand lewat `ensureTranslatorsFor*`.
3. **Executor hanya untuk upstream non-standar.** Provider OpenAI-compatible cukup
   pakai `DefaultExecutor` — jangan buat executor tanpa alasan.
4. **Auth descriptor standar:** `transport.auth = { combined: true, header, scheme }`.
   Tanpa `combined: true`, `applyAuth` mengira descriptor split apiKey/oauth dan akan crash.
5. **Config-driven, DRY.** Jangan hardcode nama model, role/block string, URL, atau
   konstanta — taruh di `open-sse/config/` atau `open-sse/translator/schema/`.
6. **RTK/token saver = fail-open.** Jangan pernah `throw` dari `open-sse/rtk/*`;
   error harus return null dan biarkan body utuh.
7. **Plain JavaScript ESM**, tanpa TypeScript. Alias `@/*` → `src/*`
   (`jsconfig.json`). Style: camelCase, Conventional Commits.
8. **Jangan commit** tanpa arahan eksplisit user.
9. **Jangan ubah** `custom-server.js` (proteksi IP spoofing) dan `src/proxy.js`
   tanpa memahami implikasi keamanan.
10. **Pola fetch-on-open di useEffect adalah disengaja — jangan di-refactor.**
    `ModelSelectModal.js` (fetchCombos/fetchProviderNodes/fetchCustomModels/
    fetchDisabledModels/fetch modal data saat modal dibuka) dan
    `dashboard/combos/page.js` (fetchData saat mount, sinkronisasi selectedIds)
    memang memanggil setState di dalam useEffect. Rule
    `react-hooks/set-state-in-effect` dimatikan per-baris dengan alasan
    ("disengaja ... jangan di-refactor"). Jangan "memperbaiki" pola ini dengan
    memindah fetch ke handler atau menambah library data-fetching.

## Menambah kapabilitas (pola baku)

| Tugas | Pola |
|---|---|
| Provider API-key baru | File registry → regen index → tambah model ke `config/providerModels.js` |
| Provider OAuth/protokol khusus | Registry + executor (`BaseExecutor`) + daftar di `open-sse/executors/index.js` |
| Format baru | `translator/request|response/<from>-to-<to>.js` + `register()` + entri di `TRANSLATOR_MANIFEST` (`translator/index.js`) + konstanta di `formats.js` bila perlu |
| Strategi routing combo baru | `open-sse/services/combo.js` (+ state per-combo, cleanup di `resetComboRotation()`) |
| Halaman dashboard baru | `src/app/(dashboard)/dashboard/<nama>/page.js` + komponen di `src/shared/components/` |
| API dashboard baru | `src/app/api/<domain>/route.js` (Next route handler) |

## Verifikasi sebelum selesai

- `node --check` untuk setiap file JS yang diubah.
- Regen registry index bila menyentuh `providers/registry/`.
- Jalankan test terkait via vitest; untuk perubahan registry/alias jalankan
  `tests/__baseline__/verify-no-regression.mjs`.
- Cek `git status`/`git diff` — pastikan hanya file yang dimaksud yang berubah.

## Keamanan (prioritas utama)

Security-first saat review/buat PR: audit auth, penyimpanan kredensial/token,
kebocoran header, `X-Forwarded-For`, dan risiko SSRF sebelum logika fungsional.
Detail: `docs/SECURITY.md`. Env sensitif: `JWT_SECRET`, `INITIAL_PASSWORD`
(default `123456` — wajib diganti), `API_KEY_SECRET`, `MACHINE_ID_SALT`.
