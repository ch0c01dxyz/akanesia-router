# CHECKPOINT — 2026-10-16

> Status terakhir repo akanesia-router. Dibaca saat sesi baru untuk lanjut kerja tanpa tanya ulang.

## HEAD

- Branch: `master`
- Remote: `git@github.com:ch0c01dxyz/akanesia-router.git`
- Commit terakhir: `fd6000d4` (batch 2 link audit)
- Working tree: BERSIH (setelah commit ini)

## Pengaturan Aktif

- **Node**: ≥24 (engines di package.json)
- **Database**: node:sqlite (better-sqlite3 dihapus)
- **Dev server**: port 20127, matikan setelah selesai
- **Test**: `npx vitest run --config tests/vitest.config.js` (vitest 4.1.11 di tests/)
- **Bahasa**: Indonesia untuk teks user-visible

## Fitur Kunci (2026-10-14 → 2026-10-16)

1. **OpenCode Bridge** (`opencode` provider):
   - Executor: `open-sse/executors/opencode-bridge.js` via `opencode2 serve` lokal (port 4096)
   - Supervisor: `open-sse/utils/opencodeBridgeSupervisor.js`
     - OS-aware binary path (win32: `~/.bun/bin/opencode2.exe`, lain: `~/.opencode/bin/opencode2`)
     - Guard probe port (orphan serve detection)
   - Ter-bind ke provider `opencode` (OpenCode Free), `opencode-bridge` id dihapus

2. **Tool call collision fix**: `nextFreeToolIdx` di openai-to-claude.js + kiro-to-claude.js

3. **Tool param aliasing**: Read/Edit/Write/Bash di openai-to-claude.js

4. **Export/Import provider**: tombol di halaman detail provider, API `/api/providers/[id]/export|import`

5. **Provider links**: 153 provider dapat website/apiKeyUrl

## Aturan Kerja Egar (jangan langgar)

- Review-first: jangan commit/push tanpa instruksi eksplisit
- "cuman tanya" = jangan ubah apa pun
- Jangan tampilkan secret di chat/log/file
- Jangan sentuh: `open-sse/rtk/ponytail.js`, Optimizer V1
- Sub-agent coding wajib baca `~/workspace/custom-skills/local-ponytail/SKILL.md`

## Yang Belum Selesai

- 19 provider terblokir kebijakan untuk link audit (sesi berikutnya)
- chenzk.top pensiun 31 Okt 2026 — baseUrl akan mati
- lambda-ai wind-down Inference API — perlu verifikasi
