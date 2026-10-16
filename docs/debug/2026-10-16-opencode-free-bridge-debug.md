# Debug Log: Provider `opencode-free` (bridge executor) — 2026-10-16

Sesi debugging lengkap jalur `oc/*` (alias `oc` → provider `opencode` → executor `opencode-bridge` → `opencode2 serve` di port 4096). Hasil akhir: **11/13 model GREEN via router**. 2 model mati di upstream (bukan bug router).

## Arsitektur Jalur

```
Client → 9router (20127) /v1/chat/completions
       → model "oc/<model>"
       → provider registry "opencode" (alias oc, noAuth, forceStream)
       → executor opencode-bridge (adapters.manifest.js: "opencode" → ./opencode-bridge.js)
       → opencodeBridgeSupervisor.ensureBridgeRunning() → spawn `opencode2 serve --port 4096`
         (Basic auth password ditangkap dari stdout: "server password <pw>")
       → POST /api/session (model pinned {providerID:"opencode", id})
       → POST /api/session/:id/prompt {text, files:[{uri,name}]} (async)
       → poll GET /api/session/:id/message sampai finish === "stop"
       → emit SSE chunk (delta content) + final chunk (usage) + [DONE]
```

- `forceStream: true` di transport → request non-stream client dikonversi jadi stream lalu diagregasi oleh `sseToJsonHandler.js` (`parseSSEToOpenAIResponse`) / Responses converter bila `targetFormat === "openai-responses"`.
- Eksekusi non-stream executor: wall clock 55s (`NON_STREAM_TIMEOUT_MS`), stream 600s.
- Orphan handling: bila port 4096 sudah dipakai dan password tidak diketahui → kill & respawn (jangan adopt buta).

## Masalah & Solusi (4 root cause)

### 1. Respons non-stream kosong (`fin=stop`, konten kosong) untuk model cepat

- **Gejala**: 8/13 model balik EMPTY dengan `finish_reason: "stop"`, usage 0, durasi 2-3s.
- **Root cause**: stream path executor — `waitCompletion` return begitu melihat `finish === "stop"`, seringkali SEBELUM `onProgress` sempat mengirim teks (model cepat selesai di antara dua poll). Chunk final hanya berisi usage. Agregator router → JSON kosong.
- **Solusi**: track `streamedLen` dari heartbeat, emit remainder `fullText.slice(streamedLen)` sebelum chunk final.
- **File**: `open-sse/executors/opencode-bridge.js`

### 2. Muse-spark-1.3 EMPTY `fin=in_progress`, usage 0, id `resp_*`

- **Gejala**: hanya muse; id respons `resp_<timestamp>` bukan `chatcmpl-ocbridge-*` → tidak lewat jalur bridge SSE parser.
- **Root cause (3 lapis)**:
  1. `registry/opencode.js`: entry muse punya `targetFormat: "openai-responses"` → request dipaksa lewat `convertResponsesStreamToJson` yang mengharapkan event Responses, padahal bridge emit Chat Completions chunks → nol event dikenali → status default `"in_progress"`, output kosong.
  2. `config/providerModels.js` `getModelTargetFormat()`: hardcode `isMuseSparkModel()` → selalu balik `OPENAI_RESPONSES` untuk alias apapun.
  3. Fallback `opencodeFamilyFormats()`: regex `^muse[-_]?spark` → responses untuk id tak-dikenal.
- **Solusi**: hapus `targetFormat` dari entry muse di registry; scope override + family fallback agar TIDAK berlaku untuk alias bridge (`oc`, `opencode`), tetap berlaku untuk jalur direct (`ocg`, `ocz`). Jalur direct (opencode-go) memang bicara `/responses` ke upstream; jalur bridge bicara chat-completions.
- **File**: `open-sse/providers/registry/opencode.js`, `open-sse/config/providerModels.js`, test `tests/unit/opencode-muse-spark-thinking.test.js` (kontrak diperbarui: `oc` → null, `ocg` → responses).

### 3. 502 permanen `session create 401` setelah serve mati dari luar

- **Gejala**: supervisor punya `proc && password` stale (serve dibunuh proses luar) → semua request 401 tanpa self-heal sampai restart router.
- **Root cause**: tidak ada invalidasi state saat auth ditolak; orphan guard lama mengadopsi serve asing tanpa tahu passwordnya → auth `Basic opencode:null` → 401 abadi.
- **Solusi**:
  - `invalidateBridge()` baru di supervisor (clear proc/password/startPromise).
  - Executor: `session create 401 && password` → invalidate + respawn + retry sekali.
  - Orphan guard baru: port terpakai TANPA password dikenal → `killPortListener()` (PowerShell `Get-NetTCPConnection` / POSIX `lsof`) → spawn milik sendiri. Adopt hanya bila password masih pegang.
  - `FETCH_TIMEOUT_MS = 30s` per-call di `ocFetch` (AbortSignal.any) supaya hung serve API tidak memblokir poll loop melewati wall clock.
- **File**: `open-sse/utils/opencodeBridgeSupervisor.js`, `open-sse/executors/opencode-bridge.js`

### 4. jev-1.13 hang 180s+ via router

- **Gejala**: jev tidak pernah selesai lewat router, tapi executor langsung juga 240s kosong.
- **Root cause**: entry jev ditandai `kind: "systemone"` → router bawa ke jalur systemone (direct `opencode.ai/inference/v1/systemone`) yang FreeTierError/hang. Bridge executor tidak pernah kepanggil.
- **Solusi**: hapus `kind: "systemone"` dari entry jev → lewat bridge seperti model lain.
- **File**: `open-sse/providers/registry/opencode.js`

## Model MATI di upstream (BUKAN bug router)

Diverifikasi langsung ke serve (auth valid, bypass router):

- **jev-1.13-free**: 240s stream = kosong; agent tidak pernah menghasilkan teks.
- **nemotron-3-ultra-free**: dump session API setelah 9+ menit = TIDAK ADA assistant message sama sekali (`parts: []`, finish NONE). 259s stream juga kosong.
- Upstream opencode tidak pernah mulai menjawab untuk kedua model ini (kemungkinan per-account/fingerprint gating). Tidak ada fix di sisi router. Coba ulang lain waktu.

## Hasil Verifikasi Akhir (batch non-stream via router)

| Model | Status | Waktu |
|---|---|---|
| muse-spark-1.3-contributor-free | OK | 28.5s |
| big-pickle | OK | 6.0s |
| cat-jam-free | OK | 5.3s |
| deepseek-v4.1-flash-free | OK | 3.5s |
| ling-3.0-flash-fin-free | OK | 2.9s |
| longcat-2.5-preview-free | OK | 6.7s |
| mimo-v2.5-free | OK | 6.4s |
| mimo-v2.6-flash-free | OK | 5.2s |
| nemotron-3.5-lightning-free | OK (36s saat solo; batch sempat 70s+ karena antrean) | 36s |
| nemotron-3.5-super-vl-free | OK | 2.3s |
| space-bunny-free | OK | 8.1s |
| jev-1.13-free | TIMEOUT 180s (upstream dead) | — |
| nemotron-3-ultra-free | TIMEOUT 180s (upstream dead) | — |

Semua respons sehat: id `chatcmpl-ocbridge-*`, `fin=stop`, usage terisi.

## Workflow Debugging yang Terbukti (reusable)

1. **Identifikasi jalur via response id**: `chatcmpl-ocbridge-*` = bridge SSE; `resp_<ts>_<rand>` = Responses converter (salah jalur). Selalu dump full JSON respons saat gejala aneh.
2. **Isolasi executor vs router**: panggil executor langsung (harness `.mjs` import `OpenCodeBridgeExecutor`) — bila executor OK tapi router kosong, bug ada di lapisan agregasi/routing, bukan executor. Bila executor juga error, bug di serve/upstream.
3. **Cek route dengan DB log**: `requestDetails` di sqlite 9router (`AppData/Roaming/9router/db/data.sqlite`, tabel `requestDetails`, kolom `response.error`) memperlihatkan FreeTierError = request lewat jalur direct, bukan bridge. Pola log tiap 5 menit = health checker dashboard, bukan trafik test.
4. **Probe serve langsung**: `POST /api/session` + `POST /prompt` + poll `/message` dengan Basic auth dari supervisor untuk melihat kondisi mentah upstream (assistant message pernah dibuat atau tidak).
5. **Background test yang survive**: jalankan node test via PowerShell `Start-Process -WorkingDirectory ... -WindowStyle Hidden` + tulis ke file log (subshell `&` MSYS sering mati bersama parent).
6. **Baseline test sebelum menyalahkan diri sendiri**: `git stash push <file> -q && vitest run <suite> ; git stash pop -q` untuk membedakan failure pre-existing vs regresi sendiri.

## Gotchas

- Kernel exec 300s cap untuk cell panjang → pecah jadi background job + poll file log.
- `git push` bisa ditolak bila remote maju → `git stash push` (file user `.env`, `package-lock.json` jangan dibawa commit) → `git pull --rebase` → push → `stash pop`.
- Port 4096 orphan dari harness lama adalah sumber 401 klasik — kill dulu sebelum test executor sendiri, atau biarkan supervisor baru yang meng-kill.
- Health checker dashboard menulis requestDetails tiap 5 menit untuk muse-1.2/1.3 + mimo-2.5 — jangan tertukar dengan trafik debugging.

## Commit Terkait

- `803b10de` — Fix opencode-bridge: remainder SSE, stale-serve recovery, muse/jev routing
- `c1cc2e6f` — Fix: getModelTargetFormat muse — bridge lane (oc) chat, direct lanes (ocg) responses

## Status File (pasca sesi)

- `open-sse/executors/opencode-bridge.js` — remainder SSE + 401 retry + fetch timeout
- `open-sse/utils/opencodeBridgeSupervisor.js` — invalidateBridge + killPortListener + orphan guard
- `open-sse/providers/registry/opencode.js` — muse tanpa targetFormat, jev tanpa kind systemone
- `open-sse/config/providerModels.js` — override muse + family fallback di-scope ke jalur direct saja
