# RULES — Aturan Main Repo Akanesia-Gateway

> Aturan operasional. Panduan kerja lengkap: `AGENTS.md`. Keamanan: `docs/SECURITY.md`.

## WAJIB (DO)

- [ ] Baca `open-sse/AGENTS.md` sebelum menyentuh apapun di `open-sse/`.
- [ ] Baca `docs/ARCHITECTURE.md` sebelum mengubah alur request/routing.
- [ ] Jalankan `node scripts/generate-registry-index.mjs` setelah menambah/mengubah
      file di `open-sse/providers/registry/`.
- [ ] Import file translator baru di `open-sse/translator/index.js`.
- [ ] Daftarkan executor khusus di `open-sse/executors/index.js`.
- [ ] Pakai auth descriptor standar: `transport.auth = { combined: true, header, scheme }`.
- [ ] Taruh konstanta di `open-sse/config/` / `translator/schema/` — jangan hardcode.
- [ ] Buat RTK/token saver **fail-open** (catch semua error, return null).
- [ ] Jalankan `node --check` untuk tiap file yang diubah.
- [ ] Jalankan test terkait (vitest) + script baseline bila menyentuh registry/alias.
- [ ] Cek `git status`/`git diff` sebelum selesai — hanya file yang dimaksud yang berubah.
- [ ] Tulis pesan commit gaya Conventional Commits bila diminta commit.

## DILARANG (DON'T)

- [ ] **JANGAN** edit manual `open-sse/providers/registry/index.js` (auto-generated).
- [ ] **JANGAN** hardcode nama model, role/block string, URL, atau secret di kode.
- [ ] **JANGAN** `throw` dari dalam `open-sse/rtk/*` atau token saver lain.
- [ ] **JANGAN** membuat executor baru untuk provider yang OpenAI-compatible
      (pakai `DefaultExecutor`).
- [ ] **JANGAN** mengubah `custom-server.js` / `src/proxy.js` tanpa analisis keamanan
      (risiko IP spoofing / auth bypass).
- [ ] **JANGAN** menyimpan secret/API key di kode, log, atau file yang di-commit.
- [ ] **JANGAN** mengaktifkan `ENABLE_REQUEST_LOGS=true` di production tanpa alasan
      (log berisi header/body penuh).
- [ ] **JANGAN** commit tanpa arahan eksplisit user.
- [ ] **JANGAN** mengubah/menghapus file di luar lingkup task.
- [ ] **JANGAN** menganggap test suite harus hijau semua — ada known-fails yang
      dikatalogkan (`tests/__baseline__/known-fails.txt`); nilai regresi via script baseline.
- [ ] **JANGAN** percaya `X-Forwarded-For` dari klien langsung — hanya dari loopback
      reverse proxy (lihat `custom-server.js`).
- [ ] **JANGAN** retry otomatis pembuatan video job (risiko tagih ganda) — lihat `videoCore.js`.
