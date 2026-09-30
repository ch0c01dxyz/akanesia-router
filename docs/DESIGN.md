# DESIGN — Akanesia-Gateway (Detail Pola & Konvensi)

> Overview: `DESIGN.md` di root. Mesin routing: `open-sse/AGENTS.md`.

## 1. Pola Registry Provider

Satu file per provider di `open-sse/providers/registry/{id}.js`:

```js
export default {
  id: "agentrouter",            // kebab-case, unik
  priority: 120,
  alias: "agentrouter",
  display: { name, icon, color, textIcon },
  category: "freeTier",         // apikey | oauth | freeTier | ...
  authType: "apikey",
  transport: {
    baseUrl: "https://...",
    format: "claude",           // target format upstream
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
    // bearer → { combined: true, header: "Authorization", scheme: "bearer" }
  },
  passthroughModels: true,
  models: [{ id, name, supportsReasoning, ... }],
};
```

- `open-sse/providers/index.js` membangun `PROVIDERS`, `PROVIDER_MODELS`,
  `PROVIDER_OAUTH`, `PROVIDER_MEDIA` dari registry.
- `registry/index.js` = static import list **auto-generated** — regen via
  `node scripts/generate-registry-index.mjs`, jangan edit manual.
- `config/providerModels.js` = derivasi (alias→models matrix).

## 2. Pola Executor

```js
import { BaseExecutor } from "./base.js";
class MyExecutor extends BaseExecutor {
  getBaseUrls() { ... }
  buildHeaders(credentials) { ... }
  buildUrl(model, stream, urlIndex, credentials) { ... }
  async execute(...) { ... }        // override bila protokol khusus
}
```

- Override point: `getBaseUrls`, `buildHeaders`, `buildUrl`, `transformRequest`,
  `shouldRetry` (default hanya 429), `refreshCredentials`, `parseError`.
- Daftarkan di map `open-sse/executors/index.js`; `getExecutor()` fallback ke
  `DefaultExecutor` bila tidak ada.
- Protokol biner (kiro EventStream, cursor protobuf, commandcode NDJSON) ditangani
  di dalam executor — tidak round-trip via translator.

## 3. Pola Translator

```js
// open-sse/translator/request/openai-to-claude.js
import { register } from "../index.js";
register("openai", "claude", translateRequestFn, null);
```

- Request dan response translator terpisah (`request/` dan `response/`).
- **Wajib** di-import di `open-sse/translator/index.js` (registrasi via side-effect).
- Pivot: `sumber → openai → target`, kecuali direct route (`claude:kiro`).
- Jangan hardcode role/block string — pakai `translator/schema/` dan `open-sse/config/`.
- Tambah format baru di `translator/formats.js` bila perlu.

## 4. Pola Combo Routing (`open-sse/services/combo.js`)

- Strategi: `fallback` | `round-robin` | `fill-first`.
- State per-combo terpisah (`comboRotationState`, `comboFillState`); bersihkan via
  `resetComboRotation()`.
- `round-robin`: `{ index, consecutiveUseCount }` + `stickyLimit`.
- `fill-first`: pointer string model, tidak maju per request.

## 5. Pola Account Fallback (`open-sse/services/accountFallback.js`)

- `checkFallbackError(status, errorText, backoffLevel)` — cocokkan `ERROR_RULES`
  (`config/errorConfig.js`): teks dulu, lalu status.
- 429 → backoff eksponensial (1s, 2s, 4s, … maks 4 menit).
- 4xx non-401/402/403/429 tidak trigger fallback (kesalahan request itu sendiri).

## 6. Pola Token Saver (RTK dkk.)

- Kompres in-place `tool_result`; **fail-open**: try/catch → return null, body utuh.
- RTK jalan pre-translate khusus cursor (translator-nya menulis ulang `tool_result`),
  post-translate untuk provider lain.
- Opt-out per request via header `x-9router-token-saver: off`.

## 7. Pola Persistence (`src/lib/db/`)

- Satu repo per entity: `src/lib/db/repos/{connections,combos,aliases,apiKeys,...}Repo.js`.
- Barrel: `src/lib/db/index.js`. Shim lama: `src/lib/localDb.js`, `src/lib/usageDb.js`.
- Migrasi: `src/lib/db/migrations/` + `migrate.js`.
- Kode baru import dari `@/lib/db/index.js`, bukan dari shim.

## 8. Pola API Route (Next.js)

- `src/app/api/<domain>/route.js` — export `GET`/`POST`/… handler.
- Route kompatibilitas (`/api/v1/*`) tipis: parse → delegasi ke `src/sse/handlers/*`.
- Validasi input di route; logika bisnis di `src/sse/` atau `open-sse/`.

## 9. Pola UI Dashboard

- Halaman: `src/app/(dashboard)/dashboard/<nama>/page.js` — tipis, komposisi komponen.
- Komponen reusable: `src/shared/components/` (`Card`, `Modal`, `Button`, `Toggle`, …).
- State: zustand stores di `src/store/` (`providerStore`, `userStore`, `settingsStore`, …).
- Konstanta tampilan: `src/shared/constants/providers.js`.
- i18n: `translate()` dari `src/i18n/runtime.js`; jangan hardcode string UI tanpa translate
  bila pola file sudah menggunakannya.
- Ikon: `material-symbols`.

## 10. Konvensi penamaan

| Hal | Konvensi | Contoh |
|---|---|---|
| Provider id | kebab-case | `openai-compatible`, `claude-code` |
| Model ref | `provider/model` | `kr/claude-sonnet-4.5` |
| File translator | `<from>-to-<to>.js` | `openai-to-claude.js` |
| File executor | `{provider-id}.js` | `clova-studio.js` |
| File registry | `{provider-id}.js` | `agentrouter.js` |
| Route API | `<domain>/route.js` | `src/app/api/combos/route.js` |
| Komponen React | PascalCase | `ProviderCard` |
| Halaman | `page.js` | — |
| Variabel/fungsi | camelCase | `getProviderCredentials` |
| Konstanta | UPPER_SNAKE | `STREAM_STALL_TIMEOUT_MS` |
| Commit | Conventional Commits | `feat(translator): …`, `fix(combo): …` |

## 11. Pola Testing

- Vitest, paket independen di `tests/`; alias `open-sse/…` → `../open-sse`, `@/…` → `../src`.
- Test translator yang memakai `translateRequest/Response` wajib
  `import "./registerAll.js"` (side-effect registry).
- Golden/roundtrip test di `tests/translator/`; unit di `tests/unit/`.
- Detail: `docs/TESTING.md`.
