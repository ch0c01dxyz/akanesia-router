# implementation_plan.md — Template Rencana Implementasi Fitur

> Pakai template ini setiap mengerjakan fitur baru di akanesia-router agar mengikuti pola repo.
> Salin checklist ke task, centang yang relevan.

## 1. Definisi

- **Nama fitur:**
- **Tujuan (1–2 kalimat):**
- **Area yang tersentuh:** [ ] `open-sse` [ ] `src/sse` [ ] `src/app/api` [ ] dashboard UI [ ] DB [ ] docs

## 2. Eksplorasi (wajib sebelum koding)

- [ ] Baca `docs/ARCHITECTURE.md` bagian yang relevan
- [ ] Baca `open-sse/AGENTS.md` bila menyentuh `open-sse/`
- [ ] Identifikasi file existing yang polanya bisa diikuti (contoh: provider mirip,
      translator pasangan mirip, halaman dashboard mirip)
- [ ] Cek apakah pola baku sudah mencakup kebutuhan (lihat tabel "Menambah kapabilitas"
      di `AGENTS.md`)

## 3. Desain perubahan

- [ ] Tentukan: file baru apa, file existing apa yang diubah
- [ ] Untuk provider baru: isi `REGISTRY_TEMPLATE.js`, tentukan `transport.auth`
      (`{ combined: true, header, scheme }`), format target, daftar model
- [ ] Untuk translator baru: tentukan pasangan `from:to`, direct route atau via pivot OpenAI
- [ ] Untuk executor baru: tentukan method `BaseExecutor` mana yang di-override
- [ ] Untuk strategi combo baru: tentukan bentuk state per-combo + cleanup
- [ ] Untuk API baru: tentukan method, path, shape request/response
- [ ] Untuk UI baru: tentukan halaman/komponen, pakai komponen `src/shared/components/`

## 4. Implementasi

- [ ] Tulis kode mengikuti pola existing (config-driven, camelCase, ESM)
- [ ] Jangan hardcode nilai — taruh di `open-sse/config/` / `translator/schema/`
- [ ] Token saver / hook: fail-open (try/catch, jangan throw)
- [ ] Translator baru: `register()` + import di `translator/index.js`
- [ ] Executor baru: daftar di `executors/index.js`
- [ ] Provider baru: regen `node scripts/generate-registry-index.mjs`
- [ ] UI: pakai `translate()` untuk string user-facing

## 5. Verifikasi

- [ ] `node --check` tiap file yang diubah
- [ ] Regen registry index bila perlu; cek tidak ada duplicate id
- [ ] Test ad-hoc (script `/tmp` atau curl ke endpoint lokal)
- [ ] Vitest terkait: `npx vitest run --config tests/vitest.config.js <path>`
- [ ] Bila sentuh registry/alias: `tests/__baseline__/verify-no-regression.mjs`
- [ ] `git status` / `git diff` — hanya file yang dimaksud

## 6. Dokumentasi

- [ ] Perbarui `docs/` yang relevan bila perilaku berubah
- [ ] Tambah contoh pemakaian bila fitur user-facing (README/wiki bila diminta)

## 7. Definisi selesai

Fitur selesai bila: kode mengikuti pola repo, semua verifikasi di §5 lolos,
tidak ada file di luar lingkup yang berubah, dan tidak ada commit tanpa arahan.
