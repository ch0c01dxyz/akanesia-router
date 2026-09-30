# TASK_INSTRUCTION — Instruksi Standar Mengerjakan Task di Akanesia-Gateway

## 1. Pahami task

- Baca permintaan user apa adanya; jangan lebarkan scope.
- Bila ambigu, kerjakan bagian yang jelas dulu, tandai asumsi di laporan.

## 2. Baca memori sebelum koding

- `AGENTS.md` (root) — panduan kerja & larangan.
- `docs/ARCHITECTURE.md` — bila menyentuh alur request/routing.
- `open-sse/AGENTS.md` — wajib bila menyentuh `open-sse/`.
- `docs/SECURITY.md` — bila menyentuh auth/kredensial/network.

## 3. Eksplorasi

- Temukan pola existing terdekat (provider/translator/executor/halaman mirip).
- Verifikasi dengan membaca file, bukan menebak.
- Untuk bug: reproduksi dulu (test ad-hoc / baca kode) sebelum memperbaiki.

## 4. Implementasi

- Ikuti template `docs/implementation_plan.md`.
- Ikuti pola baku repo (registry → executor → translator → UI → API).
- Config-driven; jangan hardcode; fail-open untuk optimisasi.
- Jangan menyentuh file di luar lingkup task.

## 5. Verifikasi (wajib)

1. `node --check` untuk setiap file JS yang diubah.
2. Bila ubah `open-sse/providers/registry/`: `node scripts/generate-registry-index.mjs`
   + cek duplicate id.
3. Test ad-hoc: script `/tmp` atau curl ke endpoint lokal bila relevan.
4. Vitest terkait:
   `npx vitest run --config tests/vitest.config.js <path-test>`
5. Bila sentuh registry/alias/OAuth: `tests/__baseline__/verify-no-regression.mjs`.
6. `git status` + `git diff` — pastikan hanya file yang dimaksud berubah.

## 6. Laporan

- Apa yang diubah (file + ringkas).
- Hasil verifikasi (lolos/gagal + detail).
- Caveat / hal yang belum selesai / follow-up yang disarankan.
- Jangan klaim selesai bila verifikasi belum lolos.

## 7. Definisi selesai (Definition of Done)

- [ ] Kode mengikuti pola & konvensi repo
- [ ] Semua langkah verifikasi §5 lolos (atau kegagalan dijelaskan)
- [ ] Tidak ada file di luar lingkup yang berubah
- [ ] Tidak ada commit tanpa arahan eksplisit
- [ ] Laporan lengkap ke user/parent agent
