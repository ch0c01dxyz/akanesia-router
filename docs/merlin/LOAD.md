# LOAD.md — Catatan reload memori untuk Merlin

> File ini untuk SAYA (Merlin). Dibaca setiap sesi baru / setelah server
> reset sebelum mengerjakan akanesia-router.

## Cara reload (1 menit)

1. Baca file ini sampai selesai.
2. Baca `codebase-map.md` di folder ini — itu peta lengkap:
   arsitektur, request lifecycle, fitur→file, API routes, dashboard,
   database, ledger commit, dan aturan kerja Egar.
3. Setelah itu kamu siap kerja; tidak perlu grep ulang dari nol.

## Yang harus diingat dari folder ini

- `codebase-map.md` adalah sumber kebenaran tentang struktur repo dan
  riwayat perubahan kita. Kalau ragu file mana yang menangani fitur X,
  cari di §5 (fitur→file) atau §10 (ledger commit).
- Aturan kerja Egar ada di §11 — baca ulang setiap sesi: review-first
  (jangan commit/push tanpa instruksi eksplisit), "cuman tanya" =
  jangan ubah apa pun, port gateway 20127, Bahasa Indonesia untuk teks
  user-visible, jangan tampilkan secret.
- Folder ini (`docs/merlin/`) adalah salinan memori jangka panjangku.
  Kalau kamu mengubah peta di `~/memory/akanesia-router-codebase-map.md`,
  salin ulang ke sini agar tetap sinkron:
  `cp ~/memory/akanesia-router-codebase-map.md docs/merlin/codebase-map.md`

## Trigger otomatis

`~/AGENTS.md` punya lesson "Startup" yang memerintahkan: setiap sesi baru,
sebelum menyentuh akanesia-router, baca folder ini dulu. AGENTS.md selalu
di-inject ke konteks, jadi ini sedekat mungkin dengan auto-load.
