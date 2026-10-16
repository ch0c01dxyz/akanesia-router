# CHECKPOINT — 2026-10-16 (update sore)

> Status terakhir repo akanesia-router. Dibaca saat sesi baru untuk lanjut kerja tanpa tanya ulang.

## HEAD

- Branch: `master`
- Remote: `git@github.com:ch0c01dxyz/akanesia-router.git`
- Commit terakhir: `803b10de` (harness fix opencode-bridge, via pull)
- Working tree: BERSIH

## Riwayat Commit Hari Ini

1. `e8dcd6dd` — port upstream v0.5.104 (12 item: Gemini 4 Argon, Antigravity 2.22, Nous OAuth, dll.)
2. `64f13152` — fitur deteksi + setup opencode2 (status API, panduan per OS, auto-update, modal)
3. `dbc419f9` — docs: checkpoint + ledger
4. `cd9699be` — fix build: import path opencode-bridge
5. `bbc2c2ac` — hilangkan warning Node.js di npm start
6. `bbfecee8` — tombol Setup Bridge + Playground no-auth aktif
7. `3984e43c` — update model list opencode-free (13 model)
8. `fd9d890f` — tombol Setup Bridge ke section no-auth
9. `803b10de` — harness fix: remainder SSE, stale-serve recovery, orphan kill

## Pengaturan Aktif

- **Node**: ≥24 (engines di package.json)
- **Database**: node:sqlite (better-sqlite3 dihapus 2026-10-14)
- **Dev server**: port 20127, matikan setelah selesai
- **Test**: `npx vitest run --config tests/vitest.config.js` (vitest 4.1.11 di tests/)
- **Bahasa**: Indonesia untuk teks user-visible
- **Upstream**: 9router official v0.5.104 (terakhir di-port 2026-10-16)

## Prosedur Verifikasi (aturan Egar 2026-10-16)

Setiap selesai coding/fitur, WAJIB:
1. `npm run build` — pastikan build sukses tanpa error
2. `npm start` — jalankan production server, cek endpoint kunci
3. **Matikan** server setelah pengecekan selesai (jangan dibiarkan jalan)

Jangan skip langkah ini. Build yang gagal = jangan commit.

## Fitur Kunci (2026-10-16)

1. **OpenCode Bridge** (`opencode` provider):
   - Executor: `open-sse/executors/opencode-bridge.js` via `opencode2 serve` lokal (port 4096)
   - Supervisor: `open-sse/utils/opencodeBridgeSupervisor.js`
     - OS-aware binary path (win32: `~/.bun/bin/opencode2.exe`, lain: `~/.opencode/bin/opencode2`)
     - Guard probe port (orphan serve detection)
     - `checkOpencodeInstalled()`, `getSetupGuide()` per OS
   - API: `/api/opencode-bridge/status`, `/api/opencode-bridge/update` (background + progress)
   - Dashboard: `OpencodeSetupModal.js` (khusus provider opencode)

2. **Proxy Relay Health Monitor**:
   - Auto check 12 jam, auto-disable 3x gagal, monthly reset
   - Dashboard card "Kesehatan Proxy Relay" terpisah
   - Scheduler: `src/lib/proxy/healthMonitor.js`

3. **Port upstream v0.5.104** (12 item):
   - Gemini 4 Argon, Antigravity 2.22.0, Nous OAuth + free-tier
   - Timezone auto-ping: Asia/Jakarta
   - Migrasi DB v2: nous-research → nous

4. **Tool call collision fix**: `nextFreeToolIdx` (openai-to-claude.js + kiro-to-claude.js)

5. **Export/Import provider**: `/api/providers/[id]/export|import`

## Aturan Kerja Egar (jangan langgar)

- Review-first: jangan commit/push tanpa instruksi eksplisit
- "cuman tanya" = jangan ubah apa pun
- Jangan tampilkan secret di chat/log/file
- Jangan sentuh: `open-sse/rtk/ponytail.js`, Optimizer V1
- Sub-agent coding wajib baca `~/workspace/custom-skills/local-ponytail/SKILL.md`

## Yang Belum Selesai

- 19 provider terblokir kebijakan untuk link audit (sesi berikutnya)
- chenzk.top pensiun 31 Okt 2026 — baseUrl akan mati
- Fingerprint upstream opencode (5bdcd5e) sengaja tidak di-port (bridge lebih baik)
