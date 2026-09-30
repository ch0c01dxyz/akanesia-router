# DESIGN — Akanesia-Gateway (Overview)

> Detail pola & konvensi: `docs/DESIGN.md`.

## Prinsip desain

1. **Config-driven, bukan hardcode.** Nilai, URL, nama model, string role/block —
   semua hidup di `open-sse/config/` dan `open-sse/translator/schema/`.
2. **Single source of truth per concern.**
   - Definisi provider → `open-sse/providers/registry/{id}.js`
   - State persisten → `src/lib/db/` (repo per entity)
   - State UI → zustand stores di `src/store/`
3. **Fail-open untuk optimisasi.** RTK, headroom, caveman/ponytail boleh gagal
   diam-diam; request tidak boleh gagal karena mereka.
4. **Pivot format OpenAI.** Translator mengubah `sumber → OpenAI → target`,
   kecuali *direct route* untuk pasangan yang rapuh.
5. **Self-registration.** Translator (`register(from,to)`) dan executor
   terdaftar lewat import side-effect — file baru wajib di-import di file index.
6. **Separation of concerns:** `src/sse/` = glue (Next + DB lokal),
   `open-sse/` = engine murni provider-agnostic. Lintasi batas ini secara sadar.

## Pola utama

| Pola | Implementasi |
|---|---|
| Registry | Satu file per provider; index auto-generated |
| Executor | `BaseExecutor` + override; `DefaultExecutor` fallback |
| Translator | `register(from, to, reqFn, resFn)`; direct route vs pivot |
| Combo routing | Strategi `fallback` / `round-robin` / `fill-first` di `open-sse/services/combo.js` |
| Account fallback | `ERROR_RULES` di `config/errorConfig.js`; 429 → backoff eksponensial |
| Token refresh | `refreshCredentials()` + `refreshWithRetry(fn, 3)`; dedup via lock |
| Persistence | Repo per-entity (`src/lib/db/repos/*`), migrasi di `migrations/` |
| UI | Komponen di `src/shared/components/`, halaman tipis di `src/app/(dashboard)/` |

## Konvensi penamaan

- Provider id: **kebab-case** (`openai-compatible`, `claude-code`).
- Model reference: `provider/model` (mis. `kr/claude-sonnet-4.5`).
- File translator: `<from>-to-<to>.js` di `request/` dan `response/`.
- File executor: `{provider-id}.js`, subclass `BaseExecutor`.
- Route API: `src/app/api/<domain>/route.js` (Next App Router).
- Komponen React: PascalCase; halaman: `page.js`.
- Commit: Conventional Commits (`feat(translator): …`, `fix(combo): …`).

## Pola UI dashboard

- Halaman di `src/app/(dashboard)/dashboard/*/` tipis: fetch data + komposisi komponen.
- Komponen reusable di `src/shared/components/` (`Card`, `Modal`, `Button`, `Toggle`, …).
- Konstanta tampilan provider di `src/shared/constants/providers.js`.
- i18n via `translate()` dari `src/i18n/runtime.js`.
