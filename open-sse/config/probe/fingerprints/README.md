# Fingerprint Referensi — Probe LLM (ide #5c, sub-tab "Offline")

Folder ini menyimpan fingerprint referensi per `providerId/modelId` yang dipakai
probe P5 (password, n-gram) dan P6 (baterai satu-token, JSD) sebagai pembanding.
Tanpa file referensi, verdict P5/P6 menjadi `uncertain` — bukan gagal, tapi jujur:
tidak ada acuan yang bisa dipercaya.

## Protokol pengumpulan yang valid

Fingerprint hanya sah bila dikumpulkan dengan protokol **persis sama** dengan
yang dipakai saat pengujian, karena JSD sangat sensitif terhadap perubahan
protokol (mengganti system prompt saja menggeser JSD ≈ 0.44–0.46):

1. Kumpulkan dari **endpoint resmi / model asli** yang sudah terverifikasi
   (bukan dari agregator pihak ketiga yang belum jelas backend-nya).
2. **System prompt SAMA** dengan `PROBE.offline.probes.p6.systemPrompt`
   (`"Answer with exactly one word. No punctuation, no explanation."`).
3. **Temperatur 1.0** untuk P5 dan P6 (P1–P4 memakai temp 0, tidak masuk fingerprint).
4. **2 cell × N sampel**: cell `random-number-1-100:en` dan `random-color:en`,
   masing-masing minimal 25 sampel (mengikuti kalibrasi literatur
   llm-fingerprint-detector: 8 cell × 25 sampel). Mini-config (2 cell × 3 sampel)
   hanya untuk screening cepat, bukan untuk membangun referensi.
5. Password P5: prompt persis `PROBE.offline.probes.p5.prompt`, temp 1.0,
   minimal 25 password; simpan sebagai profil n-gram order 1–3 + distribusi
   posisi-0 (format `passwordProfile` di bawah).
6. Catat `splitHalfJsd` per cell — dipakai sebagai baseline deteksi
   `backend_rotation` (ambang = nilai ini × `PROBE.verdict.splitHalfJsd.factor`).

## Format file

`<providerId>/<modelId>.json` mengikuti `open-sse/config/probe/fingerprints/_schema.json`.
Contoh field penting:

- `protocol`: systemPrompt, temperature, cells, samplesPerCell — WAJIB cocok
  dengan `PROBE.offline.probes.p6`, atau loader menandai `protocolMismatch`
  dan verdict maksimal `uncertain`.
- `cells.<cellId>.counts`: distribusi jawaban ternormalisasi
  (`normalizeAnswer`), mis. `{ "42": 5, "7": 3 }`.
- `passwordProfile`: `{ orders: { "1": {...}, "2": {...}, "3": {...} }, pos0: {...} }`
  — hasil `ngramProfile(passwordReferensi)`; `pos0` = distribusi karakter
  pertama password (dipakai dengan bobot 3× ala whorl).
- `identity`: `{ model, family, provider }` — hasil P1 saat pengumpulan.
- `cutoff`: tanggal cutoff saat pengumpulan (hasil P2).
- `thresholds`: ambang yang dipakai saat kalibrasi (opsional, dokumentatif).
- `placeholder: true`: file contoh/belum ada data — **loader menganggapnya
  "tanpa referensi"** (return null, bukan error).

## ⚠️ Peringatan jujur

- **Threshold JSD untuk mini-config (2 cell × 3 sampel) BELUM terkalibrasi.**
  Nilai `matchMax: 0.25` / `uncertainMax: 0.35` diambil dari kalibrasi literatur
  untuk 8 cell × 25 sampel dan belum tentu berlaku untuk 2 cell × 3 sampel.
  Wajib kalibrasi empiris: kumpulkan fingerprint beberapa model yang sudah
  pasti asli, ukur sebaran JSD-nya, baru tetapkan ambang sendiri.
- Sinyal P5 (password) adalah "eksploitasi kebetulan" (temuan whorl): bila
  provider memperbaiki RNG password-nya, sinyal ini hilang — jangan jadikan
  satu-satunya dasar verdict.
- Identity prompting (P1/P2) tidak bisa diandalkan sendirian (paper TRAP):
  model sering salah klaim atau mudah dibohongi system prompt palsu.
- File `openai/gpt-4o.json` di folder ini adalah **CONTOH PLACEHOLDER** —
  belum ada data terkalibrasi di dalamnya. JANGAN dipakai sebagai acuan.
