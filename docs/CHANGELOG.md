# Catatan Perubahan 9router

> Bahasa: Indonesia. Semua perubahan di bawah ini **belum dikomit**
> (review-first). Tanggal dalam WIB.

## 2026-10-14 (uncommitted)

- Fix bug playground: `usePlaygroundApiKey` memakai key ter-mask dari
  `GET /api/keys` (mengandung "•" non-Latin1) di header `Authorization`
  sehingga browser menolak fetch ("String contains non ISO-8859-1 code
  point"). Kini resolve key penuh via `GET /api/keys/[id]` dulu. Efek
  samping dari must-fix #2 (masking key) yang kelewat satu konsumen.

## 2026-10-13 (audit menyeluruh + 9 must-fix — instruksi Egar)

Audit codebase oleh 4 sub-agent (skill ponytail-audit + context7),
direview Merlin; temuan kritis diverifikasi langsung di kode.
Perbaikan dikerjakan 3 sub-agent dengan disiplin ponytail.

**Keamanan:**
1. `GET /api/providers` & `/api/providers/[id]` tidak lagi membocorkan
   secret di `providerSpecificData` (`clientSecret` Kiro IDC,
   `mimoPassToken` Xiaomi): modul baru `src/lib/providerSanitize.js`
   (allowlist `SAFE_FIELDS`/`SAFE_PSD_FIELDS`, dipakai juga oleh
   `client/route.js` yang sudah aman).
2. `GET /api/keys` kini mengembalikan key ter-mask satu arah
   (`src/shared/utils/maskApiKey.js`); nilai penuh hanya di respons POST
   create dan `GET /api/keys/[id]` (reveal eksplisit).
3. `ChangelogModal`: markdown di-sanitasi via `src/shared/utils/safeMarkdown.js`
   (tanpa dependensi baru) — menutup XSS via `dangerouslySetInnerHTML`.

**Behavior:**
4. `tool_choice: "none"` tidak lagi jadi `"auto"` di kedua arah translator
   (OpenAI→Claude & Claude→OpenAI).
5. Flag `_isCompact` codex executor tidak lagi bocor ke request berikutnya
   (dibaca di awal `execute()`, bukan di `transformRequest`).
6. `parseUpstreamError` baca body terbatas 16KB (`open-sse/utils/bacaBodyTerbatas.js`)
   — menutup vektor OOM.

**Data/UI:**
7. Regex backup DB diperbaiki (menangani `IF NOT EXISTS`) — backup pengaman
   migrasi kini benar-benar jalan.
8. Toggle provider: hasil PUT diverifikasi; bila gagal, refetch + notifikasi.
9. Bulk delete combo: hanya yang sukses dibuang dari UI dan di-prune strateginya.

## 2026-10-13 (batch should-fix audit — instruksi Egar "lanjutkan perbaikannya")

Dikerjakan 4 sub-agent paralel dengan disiplin ponytail, direview Merlin.

**Data/services:**
- Hapus `react`/`react-dom` dari `cli/package.json` (tak dipakai).
- Hapus script mati `scripts/translate-readme.js`, `scripts/migrate-registry.mjs`.
- `releaseAntigravityQuota(connectionId)` — cache kuota di-evict saat koneksi dihapus.
- `getComboByName` case-insensitive (selaras dengan gate keyAccess).

**API routes:**
- Check All Models kini menyertakan provider custom aktif.
- `test-batch` paralel bounded (pool 5).
- Satu helper `src/lib/compatibleModelsFetch.js` untuk 4 fetch `{baseUrl}/models`
  (timeout 15 dtk di semua, termasuk yang tadinya tanpa timeout).

**Dashboard (9 fix UI):** validasi key sebelum simpan; ConfirmModal tak bisa
ditutup saat loading; loop tunnel/Tailscale bisa dibatalkan; warna level log;
import model batch (tanpa refetch per model); duplikat header case-insensitive;
scroll-lock modal; rollback toggle Token Saver; MITM autosave cek error.

**Engine (7 fix):** deteksi format Claude jalan di jalur live; headroom lazy-load;
`<think>` tak lagi menelan finish_reason/tool_calls; credentials diteruskan ke
gemini-cli/antigravity; hook auto-disable di jalur 401→refresh→403; skip refresh
sia-sia saat akun suspend; hapus 88 baris komentar mati di proxyFetch.

Verifikasi: 0 error/warning ESLint baru, build sukses, 105 gagal test
pre-existing (identik dengan baseline via A/B), verifikasi live dev 20127
(dimatikan setelah selesai).

## 2026-10-13

### Fix "Check Models" skipped untuk provider openai/anthropic-compatible (laporan Egar)

Tombol "Check Models" di detail provider selalu `skipped` dengan alasan
"auth type not supported for model check" untuk provider kompatibel dinamis
(`openai-compatible-*` / `anthropic-compatible-*`) — padahal API key ada
dan auth type-nya api-key. Akar masalah: pesan itu menyesatkan; kode jatuh
ke fallback karena provider dinamis tidak punya entry registry/`validateUrl`,
bukan karena auth type.

`src/app/api/providers/check-models/route.js`: tambah
`checkViaConnectionBaseUrl()` — bila tidak ada `validateUrl` tetapi koneksi
punya `baseUrl`, cek `{baseUrl}/models` langsung memakai API key koneksi
(logika sama dengan "Import from /models"; untuk anthropic-compatible,
suffix `/messages` di-strip dan pakai `x-api-key`). Nama koneksi dipakai
sebagai nama tampilan hasil. Alasan fallback yang menyesatkan diganti
menjadi "no models endpoint for this provider".
Test baru `tests/unit/check-models-compat-providers.test.js` (8 lolos).

**Tambahan (permintaan Egar):** bila API key koneksi kosong/belum diatur,
check tidak mengirim request sia-sia — hasil `skipped` dengan warning
"API key belum diatur — tambahkan API key pada koneksi terlebih dahulu"
(tampil kuning di panel hasil). Pesan "no API key on connection" pada jalur
registry juga diselaraskan ke Bahasa Indonesia.

## 2026-10-13 (lanjutan)

### Nama provider custom terbaca di semua tampilan (laporan Egar)

Provider kompatibel dinamis (`openai-compatible-chat-<uuid>`) selama ini
muncul sebagai ID mentah di beberapa tempat. Helper baru
`src/lib/providerDisplayName.js` (`providerDisplayName` /
`enrichWithProviderName`): nama koneksi > nama AI_PROVIDERS > id mentah.

- API `/api/quota-incidents` (dipakai Dashboard Endpoint & Key > Insiden
  Kuota & Error): entry diperkaya `providerName`; UI memakai
  `inc.providerName || inc.provider`.
- API `/api/replay-log` + tab Replay di Console Log: entry diperkaya
  `providerName`; UI menampilkan nama dengan tooltip id mentah.
- Tab Logs di Console Log: id provider mentah pada teks log diganti nama
  koneksi saat render (via `/api/providers`, client-side).
- Log terminal server (`open-sse/handlers/chatCore.js`): 12 baris log
  (POST, REQUEST, PROXY, ERROR, TOKEN, MODALITY, PASSTHROUGH) kini memakai
  `providerLogLabel()` — nama koneksi untuk provider kompatibel dinamis.
Test: `provider-display-name.test.js` (6), `quota-incidents-provider-name.test.js`
(3) lolos; build sukses.

## 2026-10-13 (fitur: auto-disable akun suspend — permintaan Egar)

Mendeteksi akun Kiro ter-suspend dari log terminal (403 "temporarily is
suspended... locked your account"). Koneksi yang terdeteksi suspend kini
dinonaktifkan otomatis.

- `open-sse/config/quotaErrorClasses.js`: kelas error baru `suspended`
  (403/423 + body mengandung "suspend", didahulukan sebelum auth_error).
- `src/sse/services/quotaIncidents.js`: `suspended` masuk IMMEDIATE_CLASSES
  (langsung tampil di dashboard) dan NON_RETRYABLE_CLASSES.
- Baru `open-sse/utils/accountSuspension.js`: `isSuspensionSignal()` (kriteria
  ketat — 401 TIDAK termasuk agar salah ketik key tidak menonaktifkan akun)
  dan `autoDisableSuspendedAccount()` (set isActive=false, fail-open; catat
  insiden; log keras `⛔ AKUN DI-SUSPEND` ke terminal).
- Hook: error path `open-sse/handlers/chatCore.js` (jalur chat) dan
  `open-sse/services/kiroModels.js` ListAvailableModels (kasus yang
  dilaporkan); connectionId di-thread via credentials di kedua caller
  models route.
- Dashboard Insiden Kuota & Error: dot merah untuk kelas `suspended`.
- Test baru `tests/unit/account-suspension.test.js` (11 lolos).
- Cara mengaktifkan kembali: toggle koneksi manual di dashboard setelah
  akun dipulihkan di sisi provider.

## 2026-10-13 (lanjutan sweep + cascade hapus insiden — permintaan Egar)

**Sweep tampilan UUID provider (lanjutan):**
- Halaman Usage > ProviderLimits: `providerLabel()` kini memakai nama
  koneksi (kartu koneksi, dropdown filter, label terpilih).
- Tab Replay (expanded view) + tabel pxpipe History: tampil
  `providerName/model` dengan tooltip id mentah; event pxpipe kini
  menyimpan `connectionId` dan diperkaya via `/api/pxpipe/stats`.
- ModelSelectModal (picker webSearch/webFetch): nama koneksi untuk
  provider custom.
- Log server: baris ERROR di chatCore + BLOCKED di streamingHandler
  memakai `providerLogLabel()` (helper dipindah ke
  `open-sse/utils/providerLogLabel.js` agar reusable).

**Cascade hapus insiden:** menghapus koneksi/API key
(`deleteProviderConnection` / `deleteProviderConnectionsByProvider`)
kini juga menghapus semua insiden kuota & error milik koneksi tersebut
dalam transaksi yang sama — dashboard tidak lagi menampilkan insiden
yatim. Fungsi repo baru `removeIncidentsByConnection()` (diekspos via
`@/models`).

## 2026-10-13 (poin 1–3 — permintaan Egar)

1. **Translator debug page**: badge provider kini tampil nama koneksi
   (tooltip simpan ID mentah).
2. **Toggle Settings** `suspendAutoDisableOnCheck` (default OFF) di
   Dashboard > Endpoint & Key > Insiden Kuota & Error: bila ON, tombol
   "Check Models" ikut menonaktifkan otomatis koneksi yang terdeteksi
   suspend (403/423 + "suspend"); hasil check menandai `autoDisabled`
   dan UI menampilkan peringatan. Auto-disable dari jalur chat & Kiro
   models discovery tetap selalu aktif.
3. **Badge "suspended"** pada ConnectionRow di detail provider untuk
   koneksi yang punya insiden suspended (diambil dari
   `/api/quota-incidents`).

## 2026-10-11

### Input pencarian pada daftar model detail provider (permintaan Egar)

`CompatibleModelsSection.js`: kolom pencarian di atas daftar model —
filter case-insensitive berdasarkan ID model, digabung dengan tab
All/Premium/Free. Dilengkapi tombol hapus pencarian, penghitung hasil
("Menampilkan X dari Y model"), dan pesan bila tidak ada yang cocok.
Pencarian otomatis dibersihkan saat "Import from /models" dimulai agar
model yang baru diimpor tetap terlihat saat auto-scroll.

### Port upstream decolua/9router v0.5.95 → v0.5.99 (instruksi Egar)

27 commit di-port manual per-file via 4 worker paralel + verifikasi terpusat.
**Dikecualikan atas instruksi Egar:** `6a1573e` (combo #4659) dan version bump
(versi lokal tetap 1.5.0).

Provider baru: **AWS Bedrock** (+SSO; SigV4 hand-rolled via node:crypto —
`@aws-sdk/credential-providers` TIDAK ditambahkan karena butuh persetujuan
eksplisit; mode SSO gagal graceful) dan **MiniMax Code (mcode)**.
Catatan: `executors/bedrock.js` lokal (1136 baris, dead code tak terdaftar)
diganti versi upstream (488 baris); `kiro.js` di-refactor memakai util
EventStream bersama.

Fitur: Hermes per-profile config (API/Dashboard/CLI); access control
per-API-key (batasi key ke combo/model tertentu); Netlify relay proxy pool;
ElevenLabs Scribe STT; Antigravity katalog refresh + default MITM Gemini 3.8
+ Claude Sonnet/Opus 5.5; SystemOne endpoint Cloudflare AI clef-flash;
CLI `show`/`--save`/Pi/Oh My Pi + model `connect` dari server; sidebar
9Remote langsung ke website; perbaikan layout mobile.

Fix: Kimi Responses → endpoint `/responses`; Muse Responses-only routing +
nested reasoning effort; Cursor AgentService (empty turn, reasoning effort);
Codex tool strict flags + pelacakan token image; Gemini `$ref`/properties
map/duplikat tool_call_id; Ollama `cached_tokens`; GLM-5.2/5.3 konteks 1M;
GLM-5.3 tak bisa disable thinking; TTS self-hosted example.

Adaptasi: string user-visible → Bahasa Indonesia; branding → Akanesia-Gateway
(identifier fungsional tak diubah); 2 bug upstream diperbaiki saat port
(HermesToolCard useEffect order); test upstream di-port (428 lolos);
ESLint 0 error baru (sisa pre-existing); build sukses.

**Perlu konfirmasi Egar:** commit `d8c585f` (per-API-key access control)
di-port sebagai fitur lengkap 26 file (termasuk enforcement di 9 handler
SSE + migrasi DB `accessRestricted`/`accessAllow`), bukan 8 file sesuai
daftar — karena 8 file saja menghasilkan kode rusak (import hilang).
UI tanpa enforcement = rasa aman palsu.

### Samakan 11 perubahan registry provider dari OmniRoute (instruksi Egar)

Diambil dari `origin/release/v3.8.51` (hanya file registry, tanpa yang lain).
Diterapkan 5, dilewati 6 karena tidak ada padanannya / sudah ada:

- `cerebras.js`: `gpt-oss-120b` + `zai-glm-4.7` ditandai
  `unsupportedParams: ["thinking"]` (`gemma-4-31b` tidak ada lokal — dilewati).
- `opencode-go.js`: `muse-spark-1.2-contributor` dapat
  `supportedThinkingEfforts: ["minimal","low","medium","high","xhigh"]`.
- `opencode-zen.js`: `gpt-5.6-sol/terra/luna` diperluas dengan
  `supportsReasoning` + thinking efforts + `maxOutputTokens: 128000`.
- `qwen-cloud-token-plan.js`: model baru `qwen3.8-flash` dan
  `deepseek-v4.1-flash` (1M context).
- `regolo.js`: bug #14996 — `baseUrl` menunjuk bare host (request POST ke
  URL salah); kini `https://api.regolo.ai/v1/chat/completions` +
  `modelsUrl` + `models: []` (andalkan discovery + `passthroughModels`).
- Dilewati: `codex.js` (model sudah dihapus lokal), `github.js`
  & `grok-cli.js` (model tidak ada lokal), `kimi.js` (struktur lokal
  berbeda; tak ada konstanta versi yang dipetakan), `perplexity-web.js`
  (sudah punya `unsupportedParams`).

## 2026-10-02

### Header per-request x-9router-ponytail + perbaiki skrip A/B (laporan Egar)

Skrip A/B Ponytail gagal dengan `401 Unauthorized` karena `PATCH
/api/settings` diproteksi `dashboardGuard` (butuh session/JWT). Solusi:
skrip tidak lagi mengubah settings global — ditambah header per-request
`x-9router-ponytail: off|lite|full|ultra` (`open-sse/config/runtimeConfig.js`,
`open-sse/rtk/ponytail.js::resolvePonytailOverride`,
`open-sse/handlers/chatCore.js`) yang meng-override setting global hanya
untuk request tersebut. Skrip `scripts/measure-ponytail.mjs` ditulis ulang
memakai header ini: tanpa auth dashboard, tanpa mengubah settings, tidak
mengganggu traffic lain. Test `tests/unit/ponytail-override.test.js`
(4 lolos).

### Batas otomatis folder logs/ 10MB (laporan Egar: logs/ membengkak 30GB)

`open-sse/utils/requestLogger.js`: setiap request (bila
`ENABLE_REQUEST_LOGS=true`) membuat satu folder sesi tanpa batas —
pemakaian harness intensif membengkakkan `logs/` hingga 30GB. Kini ada
retensi otomatis: env `REQUEST_LOG_MAX_BYTES` (default **10MB**,
`0` = tanpa batas) — hanya 10MB data paling baru yang disimpan; saat
sesi baru dibuat, bila total melebihi batas, sesi/file terlama dihapus
otomatis (throttle 1x/menit, fail-open, fire-and-forget agar tidak
menghambat request). Didokumentasikan di `.env.example`. Test
`tests/unit/request-logger-retention.test.js` (3 lolos).

### Fail-fast connect timeout + Filter/Export Replay tab (laporan & permintaan Egar)

**Analisa error 502 `moonshotai/kimi-k3`:** "fetch connect timeout" 249 detik
bukan satu timeout 249s — melainkan 4x60s (`FETCH_CONNECT_TIMEOUT_MS`) +
backoff 3s dari retry 502 di level executor (`open-sse/executors/base.js`).
Retry buta ke upstream yang lambat menghanguskan ~78% budget timeout
Claude Code (10 menit) sebelum failover akun sempat jalan.

**Perbaikan** (`open-sse/executors/base.js`): connect timeout kini fail-fast —
langsung throw tanpa retry executor agar caller failover ke akun berikutnya.
Terverifikasi empiris: undici me-reject dengan reason
`Error("fetch connect timeout")` (`name="Error"`, bukan `AbortError`)
sehingga `chatCore` tetap memetakan ke 502 → failover akun jalan; client
abort asli (`AbortError`) tetap → 499. Network error lain tetap retry
sesuai config. Regression test
`tests/unit/base-executor-connect-timeout.test.js` (3 test, A/B-verified:
gagal di kode lama, lolos di kode baru).

**Replay tab** (`dashboard/console-log/ReplayTab.js`): tambah input
"Filter Replay" (saring berdasarkan provider/model/status/URL/error,
dengan penghitung "n / m ditampilkan") dan tombol "Export JSON" —
bila filter aktif maka yang diekspor adalah data terfilter, bila tidak
maka semua data (format `{ exportedAt, filtered, filter, count, entries }`,
nama file `replay-log-<timestamp>.json`).

**Detail asal error di Replay tab** (permintaan Egar): kolom status kini
menampilkan asal error di bawah badge status — `provider` bila server LLM
mengembalikan HTTP error, `akanesia-router` bila gateway kita yang gagal
mendapatkan respons (network error, connect timeout, dsb.). Field
`errorOrigin` (`"provider"`/`"gateway"`/`"unknown"`) dicatat di
`captureReplayEntry` (`src/lib/requestReplayBuffer.js`) dan diisi eksplisit
di kedua titik capture `chatCore` (executor throw → `"gateway"`,
provider error response → `"provider"`); ikut terfilter dan otomatis
termasuk di export JSON sehingga bukti debug lengkap tanpa tebakan.
String i18n baru di `public/i18n/literals/id.json`; test
`request-replay-buffer.test.js` +1.

### Instrumentasi pengukuran RTK & Ponytail (permintaan Egar)

Alat ukur efektivitas dua kompresi token-saver (headroom dikecualikan —
konteks berbeda):

- **RTK meter** (`open-sse/rtk/meter.js`): agregator in-memory yang dicatat
  `chatCore` setiap request — total request, hit-rate, byte sebelum/sesudah,
  per filter (`byFilter`) dan per shape body (`byShape`). Fail-open, reset
  tiap restart. Dibaca via `GET /api/debug/token-saver-meter`, reset via
  `DELETE`. Test `tests/unit/rtk-meter.test.js` (4 lolos).
- **Skrip A/B Ponytail** (`scripts/measure-ponytail.mjs`): menjalankan 5
  prompt coding × N repetisi pada fase off/lite/full/ultra (toggle via
  `PATCH /api/settings`, settings dikembalikan setelah selesai),
  membandingkan `completion_tokens` vs biaya injeksi `prompt_tokens`.
  Pakai: `GATEWAY_API_KEY=... MODEL=... node scripts/measure-ponytail.mjs`.

### Fix ReferenceError: recordFailure is not defined (laporan Egar)

`src/sse/services/auth.js` memanggil `recordFailure` /
`recordSuccess` dari `./quotaIncidents.js` tanpa meng-import-nya —
bug pre-existing sejak ide #4 (2026-09-29), sekelas dengan kasus
`readOverrides()`. Modul ter-load normal, tapi meledak tepat saat
`markAccountUnavailable`/`clearAccountError` dipanggil (error path
saat upstream gagal — sesuai stack trace `/api/v1/messages` dari
Egar). Perbaikan: tambah import; regression test
`auth-quota-hooks-wired.test.js` terverifikasi A/B (gagal dengan
ReferenceError persis tanpa import, lolos dengan import).

### Port upstream decolua/9router v0.5.95 (41 commit sejak v0.5.91)

Atas instruksi Egar: seluruh fixing & fitur baru dari upstream
decolua/9router (commit `a99cf572`, rilis v0.5.95) di-port ke
akanesia-router. Dari 41 commit, 39 di-port (1 tidak applicable:
version bump — skema versi lokal 1.5.0 dipertahankan).

**Provider & model baru:**
- Provider baru **Meta Muse** (OAuth + katalog model). Adaptasi wajib:
  alias `"muse-code"` dari upstream dibuang karena bentrok dengan
  provider lokal `muse-code.js` (hasil merge OmniRoute) — dikunci
  regression test agar request `muse-code/...` tidak dibajak.
- Provider baru **v1m System One** dan **TinyFish** (search + fetch).
- **Claude Sonnet 5.5** (registry + pricing + translator); Sonnet 5.x
  di-resolve ke adaptive thinking (tanpa forged thinking placeholder).
- **GPT-6.1 Sol** di codex (identity 0.159.0, pricing resmi, 272k
  context); varian 1M context untuk GPT-6/GPT-5.6; Sol/Luna capabilities
  + pricing; ghost models dibersihkan; bare slug gpt-5.x/6.x di-route ke
  codex; hosted web search dipertahankan.
- Context window asli GPT-6/GPT-5.4+ dan combo token limits
  dipublikasikan di `/v1/models` (termasuk combo seats).
- Kiro: model claude-opus-5.5; agnes: seed model id 2.5/3.0; deepseek
  `deepseek-v4-1-flash` vision alias; zed masuk live catalog providers.
- GLM Coding: **Z.ai OAuth login** (dual-auth oauth/apikey).

**Fitur:**
- **CLI `connect`**: perintah baru untuk konek ke remote
  Akanesia-Gateway. Env var `AKANESIA_GATEWAY_PASSWORD` (fallback
  `NINE_ROUTER_PASSWORD` untuk kompatibilitas).
- **Custom header per-provider dari registry** (settings-level, ada
  blocked list Host/Authorization/Cookie). Komplementer dengan custom
  header per-node ide #8 lokal (connection-level): keduanya hidup
  berdampingan, urutan merge = bawaan → provider-level → **node-level
  menang** (paling spesifik).
- Quota: `?provider=` URL param tersinkron dengan filter (deep link
  bookmarkable); hidden providers dikecualikan dari usage stats.
- Dashboard: badge NEW di sidebar dihapus, 9Remote ditandai HOT.
- cli-tools: placeholder `sk_9router` diganti API key aktif pertama
  (bug upstream `existingProvider` undefined diperbaiki, tidak di-port
  mentah).

**Perbaikan:**
- Responses API: `response.completed` kini menunggu usage asli (bukan
  placeholder nol); watchdog 3 detik untuk deferred completion.
- Claude translator: trailing user turn dipertahankan (anti assistant
  prefill), intentional prefill dari format non-messages[]
  dipertahankan, final tool results di-cache via breakpoint ke-4,
  user turn berisi hanya `container_upload` tidak dibuang.
- Thinking: level `xhigh` untuk claude-adaptive (dengan clamp per model).
- Proxy: auto-fallback ke insecure TLS hanya saat error sertifikat
  self-signed (di-gate `STRICT_SSL`); `strictProxy` kini di-hold
  (tidak bocor ke IP langsung) saat proxy diniatkan tapi tak ter-resolve.
- Gemini: 12 keyword skema non-standar (termasuk `errorMessage`)
  di-strip dari tool schemas.
- DeepSeek: dedup tool nama-sama; unsigned thinking placeholders untuk
  opencode-go DeepSeek `/messages`.
- Codex: stop refresh-token reuse (tidak lagi logout saat auto-ping).
- CodeBuddy: parse error 6004 (rate limit + `resetsAtMs`); forward
  `recurring` untuk quota packs codebuddy-intl.
- Grok CLI: kirim versi 1.0.44 (atasi HTTP 426).
- Test: `codebuddy-intl` masuk OAUTH_TEST_CONFIG; test yang menulis ke
  DB user asli dihapus.

**Catatan adaptasi:** komentar upstream Inggris/Mandarin diterjemahkan
ke Bahasa Indonesia; `sk_9router`, `x-9router-*`, nama DB, dan
`~/.9router` tidak disentuh. Registry diregenerasi: 323 entri, tanpa
duplikat ID; alias byte-for-byte equal; snapshot 282 providers.

### Audit bug pasca-port (2026-10-02, atas instruksi Egar)

Empat area diaudit paralel (proxy/network, translator/streaming,
codex/capabilities/pricing, provider/CLI/UI/OAuth). Bug terkonfirmasi
yang diperbaiki:

- **Strict proxy bisa dilewati MITM DNS bypass** — gate strict kini
  dihitung sebelum jalur bypass; koneksi langsung ditolak saat strict
  hold aktif (`open-sse/utils/proxyFetch.js`).
- **9 executor custom tidak menerapkan provider-level header overrides**
  (cursor, bedrock, vertex, mimo-free, devin-desktop, inner-ai,
  conol-web, trae, windsurf) — kini menerima `providerOverrides` dan
  merge setelah header request dibentuk.
- **Blocked header bisa disisipkan via `PATCH /api/settings`** —
  validasi disatukan di `src/lib/providerOverrides.js`, dipakai kedua
  endpoint (juga perbaiki regex CR/LF yang salah escape).
- **Prioritas env CLI terbalik** — kini `--password` >
  `AKANESIA_GATEWAY_PASSWORD` > `NINE_ROUTER_PASSWORD` > prompt.
- **System One crash** saat koneksi punya custom baseUrl tanpa config
  (`cfg?.headers`).
- **Combo fallback tidak provider-aware** — seat provider kini
  diteruskan ke `checkFallbackError` agar rule khusus Codex memicu
  fallback seat berikutnya.
- **Pricing combo seat `[1m]` jadi $0** — marker dibersihkan sebelum
  lookup pricing.
- **Usage hanya `total_tokens` dibuang** di Responses translator —
  kini dipakai sebagai fallback (breakdown valid tetap derive total
  dari input+output).
- **Timer watchdog bisa hidup setelah stream error** — dicek
  `controller.desiredSize` sebelum flush.
- **GLM OAuth**: error transient (429/5xx/gangguan jaringan) saat
  polling kini `authorization_pending` (lanjut polling) bukan
  `access_denied`; kegagalan mint coding-plan key mengembalikan error
  eksplisit, bukan "Authorization timeout" menyesatkan.
- **Thinking xhigh Claude 4.5** — diselaraskan dengan kiroConstants
  (4.7+ baru punya xhigh): 4.5 ikut di-exclude seperti 4.6.
- Komentar tool deduper diperbaiki (MCP dedup memang hanya untuk
  klien Claude).

Diselidiki dan dinyatakan bukan bug: v1m memang provider systemone
(bukan chat); non-chat modalities tidak menerima overrides sesuai
upstream; `applyErrorState` dead code pre-existing (dibiarkan);
`applyThinking` justru yang *set* output_config (bukan strip).

Belum diputuskan (butuh arahan Egar): `noProxy + strictProxy` kini
throw (fail-closed); pool hilang / DB error masih fail-open; usage
yang tiba setelah watchdog 3 dtk tetap tidak dikirim.

### Keputusan desain proxy & watchdog (2026-10-02, atas arahan Egar)
- **noProxy + strictProxy**: strict kini menghormati `noProxy` dari
  konfigurasi provider sendiri — host yang dikecualikan memang
  dimaksudkan direct, jadi tidak di-throw. Strict hanya mengikat host
  yang wajib lewat proxy. (Sebelumnya: throw untuk semua.)
- **Pool tak valid / DB error**: bila koneksi memang mengaktifkan proxy
  (pool diminta) tapi pool rusak atau DB error, request kini fail-closed
  **500** dan error dicatat via `console.error` sehingga tampil di menu
  Console Log. Pengecualian: bila fallback legacy masih menyediakan
  proxy, request diteruskan tapi masalah pool tetap tercatat.
  Plumbing: `strictProxy` + `proxyPoolId` + `proxyConfigError` kini
  diteruskan dari `resolveConnectionProxyConfig` → auth → chatCore →
  proxyFetch (sebelumnya flag strict pool tidak sampai ke proxyFetch
  lewat jalur chat).
- **Watchdog dinamis**: model resmi (claude/gpt/o1/o3/o4/gemini/grok)
  tetap 3 detik; model lain (deepseek, glm, kimi, ...) 10 detik agar
  trailer usage yang lambat tidak hilang sia-sia.

### Audit cakupan port (2026-10-02, atas instruksi Egar)

Empat area tambahan diaudit (CLI/OAuth, dashboard UI, core
handlers/services, registry/translator). Temuan:

- **KRITIS: `readOverrides()` hilang di route overrides** — helper
  terbuang saat refaktor validasi ke modul shared, sehingga GET/PUT
  `/api/providers/[id]/overrides` selalu 500 dan seluruh fitur Custom
  Headers mati. Sudah dikembalikan + regression test
  `provider-overrides-route.test.js` (5/5 lolos).
- **Filter `enabledModels` tidak strip marker `[1m]`** — koneksi codex
  dengan enabledModels terisi selalu melewatkan seat combo
  `gpt-6-sol[1m]`. Sudah diperbaiki pakai `stripModelContextMarker`.
- **Inkonsistensi kosmetik**: `"muse"` ada di daftar noPkce
  device-code tapi tidak di daftar poll — diselaraskan.
- Registry/translator/models: bersih, tidak ada bug.
- File test yang dihapus (`provider-priority-insert-cost.test.js`)
  adalah penghapusan disengaja upstream (menulis ke DB user asli).

## 2026-09-30

### Perbaikan tabrakan prefix node kustom dengan provider bawaan

- Atas laporan Egar: `/v1/models` menampilkan
  `tokenharbor/deepseek-v4.1-flash:free` (dari node OpenAI-Compatible
  "tokenharbor" yang punya API key), tetapi chat gagal dengan
  `404 No active credentials for provider: tokenharbor`. Akar masalah:
  `tokenharbor` adalah id/alias provider **bawaan** di registry, dan
  `getModelInfo` sengaja memprioritaskan provider bawaan di atas prefix
  node kustom — jadi request di-routing ke provider bawaan (yang tidak
  punya koneksi) alih-alih ke node. List model berbohong: menampilkan
  model yang tidak bisa dipakai.
- Perbaikan:
  - `POST /api/provider-nodes` dan `PUT /api/provider-nodes/[id]` kini
    menolak prefix yang bertabrakan dengan id/alias provider bawaan
    (400 + pesan jelas). Helper baru `isReservedProviderPrefix()`
    diekspor dari `src/sse/services/model.js`.
  - `buildModelsListUncached` (`/v1/models`) melewati koneksi node yang
    prefix-nya bertabrakan — model yang tidak bisa di-routing tidak lagi
    tampil di list, sesuai harapan: list hanya berisi model yang
    benar-benar punya koneksi aktif.
  - Filter umum: koneksi aktif tetapi **tanpa kredensial yang bisa dipakai**
    (tidak ada apiKey/accessToken/refreshToken) kini disembunyikan dari
    `/v1/models` — kecuali provider lokal (`ollama-local`) dan authType
    tanpa kredensial (`none`/`free`/`optional`). Jadi provider yang belum
    dipasang API key tidak lagi muncul di list.
  - Modal tambah/edit node kini menampilkan pesan error server
    (sebelumnya gagal diam-diam).
- Catatan untuk Egar: node "tokenharbor" yang sudah ada perlu diganti
  prefix-nya (mis. `tokenharbor-custom`) lewat Edit, atau lebih mudah:
  hapus node kustom dan pasang API key ke provider bawaan `tokenharbor`
  (sudah ada `deepseek-v4.1-flash:free` di katalognya, base URL
  https://tokenharbor.ai/v1).

### Perbaikan probe model online (BazaarLink)

- Atas laporan Egar (dengan lampiran `probe.json` dari pengujian lokal):
  label & `passReason` tiap probe dari BazaarLink berbahasa Mandarin
  Tradisional. Akar masalah: start-run tidak mengirim petunjuk bahasa.
  Dokumen resmi (`probe-api-skill.md`) mendukung field opsional `lang`
  ("Language hint for probe text") — kini payload start-run di
  `src/app/api/probe/online/route.js` mengirim `lang: "en"` sehingga run
  baru menghasilkan teks Inggris. (Run lama yang sudah selesai tidak bisa
  diubah bahasanya; perlu dijalankan ulang.)
- Hasil di UI kini lebih lengkap (sebelumnya tiap baris hanya probeId +
  lulus/gagal): tabel transparan (hanya bottom-border antar baris, tanpa
  kotak/scrollbox) — klik baris untuk toggle collapse yang menampilkan
  detail: alasan/error lengkap, metrik TTFT/durasi/kecepatan/token
  input-output/finish reason, dan cuplikan respons (600 karakter).
  Status "warning" kini tampil sebagai Warning (sebelumnya "—"),
  null ditampilkan sebagai "Skipped", plus badge grup
  (identity/submodel/security/integrity) dan penanda probe kontrol netral.
- i18n: 8 string baru ("Warning", "Skipped", "Claimed",
  "View full report", "TTFT", "Speed", "Response preview",
  "Neutral control probe — not scored.") ditambahkan ke
  `public/i18n/literals/id.json`.
- Hasil run ke-2 (2026-09-30, `aaac914e-…`) membuktikan `lang: "en"`
  hanya menerjemahkan teks dinamis (passReason kini Inggris), tetapi
  65/86 label probe statis tetap Mandarin Tradisional — dan tidak ada
  dokumentasi resmi untuk lokalisasi label. Maka diterapkan terjemahan
  manual sesuai saran Egar: `open-sse/config/probe-labels-en.js` berisi
  kamus 65 label statis + template regex fallback untuk passReason lama,
  dipasang server-side di route polling `[runId]` setelah sanitasi.
  Diverifikasi dengan probe.json asli: 0 label/passReason ber-Mandarin
  tersisa, idempoten, konten tes Mandarin dalam kutipan (mis.
  「這是測試」) tidak tersentuh. `response`/`error` model dan
  `identityAssessment.evidence` sengaja tidak diterjemahkan (dinamis /
  tidak tampil di UI).
- Perbaiki toggle collapse peringatan probe online: komponen WarningList
  hanya menampilkan `detail` (bentuk offline), padahal BazaarLink mengirim
  `evidence[]` — kini evidence dirender sebagai daftar saat di-expand.
  Sekalian: severity `"warning"` dipetakan ke pill warn (sebelumnya jatuh
  ke "Info"), dan label key `probe.warning.xxx` dirapikan menjadi label
  Inggris yang mudah dibaca ("Unofficial package source").
- Verifikasi: ESLint bersih, production build sukses.

### Revisi UI: hapus tombol Donate, tampilkan provider Web Cookie

- Atas instruksi Egar: tombol Donate di header dihapus beserta `DonateModal`
  (state, import, dan file komponennya; file dipindah ke trash agar bisa
  dikembalikan).
- Perbaikan pencarian provider: section "Web Cookie Providers" di halaman
  Providers yang selama ini di-comment out kini diaktifkan kembali, sehingga
  `perplexity-web` (dan provider cookie lain seperti Grok Web) muncul dan
  ikut terfilter oleh input search di header. Section memakai filter
  `matchSearch` + `matchStatus` yang sama dengan section lain, dan memakai
  `authType: "cookie"` yang benar untuk statistik & toggle (kode lama yang
  di-comment memakai `"apikey"` sehingga koneksi cookie tak akan terhitung).
- Verifikasi: ESLint bersih, production build sukses.

### Sinkron model Perplexity dari OmniRoute terbaru

- Atas instruksi Egar: sinkronkan provider Perplexity ke akanesia-router
  mengikuti definisi terbaru OmniRoute (`origin/release/v3.8.51`, 29 Sep 2026).
  Catatan: ketiga entri provider sebenarnya sudah ada di registry kita
  (`perplexity`, `perplexity-web`, `perplexity-agent`) — yang ketinggalan
  adalah daftar modelnya.
- `perplexity.js`: 2 -> 4 model (+ `sonar-deep-research`, `sonar-reasoning-pro`).
- `perplexity-web.js`: 7 -> 11 model (nama diperbarui: "Perplexity Best",
  "Sonar 2", GPT-5.6 Terra/Sol, Gemini 3.7 Flash, Sonnet/Opus 5.0, GLM-5.2,
  Kimi K3, Grok 4.6, Nemotron 3 Ultra; masing-masing `toolCalling: false`)
  + `unsupportedParams: ["tools", "tool_choice", "parallel_tool_calls"]`
  di level provider.
- `perplexity-agent.js`: 11 -> 2 model sesuai kurasi terbaru upstream
  (`openai/gpt-5.6-sol` + `perplexity/kimi-k3`, beserta flag
  `supportsReasoning`/`toolCalling`/`supportedThinkingEfforts`).
  `passthroughModels: true` tetap aktif sehingga ID model lain tetap bisa
  dipakai manual.
- Verifikasi: registry ter-load 320 entri, ketiga ID perplexity tampil dengan
  daftar model baru; ESLint 0 error (3 warning anonim-default-export yang
  memang konvensi semua file registry).

### Fix Online Probe untuk provider kustom (openai-/anthropic-compatible)

- Laporan Egar: Online Probe (`POST /api/probe/online`) mengembalikan HTTP 400
  `{"error":"Provider tidak dikenal di registry"}` untuk koneksi provider
  dinamis `openai-compatible-chat-<uuid>`. Akar masalah: route melakukan
  lookup exact `REGISTRY.find((r) => r.id === providerId)` ke registry statis
  (320 entri) yang tidak pernah berisi ID dinamis, lalu hard-fail — padahal
  halaman UI dan executor memang mendukung provider kustom.
- Perbaikan di `src/app/api/probe/online/route.js`: bila ID tidak ada di
  registry, route membangun entri sintetis dari koneksi tersimpan via helper
  baru `entryCustomDariKoneksi()` — base URL dari
  `connection.providerSpecificData.baseUrl` (sumber yang sama dipakai halaman
  daftar model), format `openai` untuk `openai-compatible-*` dan `claude`
  (-> `anthropic` di BazaarLink) untuk `anthropic-compatible-*`. Suffix
  endpoint (`/chat/completions` dsb) tetap di-strip via `turunkanBaseUrl()`,
  dan guard keamanan tetap berlaku: hanya HTTPS publik (localhost/IP privat
  ditolak), cookie & AWS SigV4 ditolak, connectionId harus cocok persis,
  tanpa secret di log/respons.
- Kasus baru yang ditangani eksplisit: `custom-embedding-*` -> 400 "Probe
  tidak didukung untuk provider embedding"; provider kustom tanpa base URL
  -> 400 "Base URL belum dikonfigurasi untuk provider kustom ini"; ID yang
  benar-benar asing tetap 400 "Provider tidak dikenal di registry".
- Regression test baru `tests/unit/probe-online-custom-provider.test.js`:
  8 test lolos (start-run kustom openai/anthropic + payload yang dikirim ke
  BazaarLink, strip suffix, tanpa baseUrl, embedding, localhost, ID asing,
  dan provider registry statis tetap bekerja). ESLint bersih.

### Hilangkan warning MODULE_TYPELESS_PACKAGE_JSON + hardening EBADF

- Warning `MODULE_TYPELESS_PACKAGE_JSON` untuk
  `src/sse/services/backgroundTokenRefresh.js` saat `node custom-server.js`
  dijalankan: file ber-sintaks ESM berekstensi `.js` sementara package.json
  tidak punya `"type"`, sehingga Node me-reparse sebagai ES module (ada
  overhead performa). File di-rename menjadi `backgroundTokenRefresh.mjs`;
  import di `custom-server.js`, `src/shared/services/initializeApp.js`, dan
  `tests/unit/background-token-refresh.test.js` disesuaikan. Terverifikasi:
  `.js` memicu warning, `.mjs` bersih.
- Pola double-`closeSync` yang sama seperti bug EBADF kemarin ternyata ada di
  tiga fungsi install Headroom (`installHeadroomExtras` via pip,
  `runUvToolInstall`, `uninstallHeadroomExtras`): listener `error` dan `exit`
  keduanya menutup fd yang sama. Kini memakai helper `onceCloser()` (fd
  ditutup tepat sekali); `startHeadroomProxy` juga direfaktor memakai helper
  yang sama. Test: 38 lolos (background-token-refresh, headroom lifecycle,
  platform-detect, headroom-detect), ESLint bersih.
- Catatan: warning `"next start" does not work with "output: standalone"`
  sengaja dibiarkan — custom-server memang dirancang memakai `next start`
  agar wrapper `http.createServer` (sanitasi IP) tetap aktif; warning-nya
  benign. EBADF di log adalah dari build lama sebelum fix `3f76a9d6` —
  cukup `git pull` + `npm run build` + restart.

- Tambah checkbox **Idle timeout** (`API_FORCE_IDLE_TIMEOUT`): dicentang
  menulis `1` (idle timeout 5 menit aktif untuk semua provider), tidak
  dicentang menulis `0` (timeout dimatikan — untuk gateway lambat atau model
  lokal yang jeda antar chunk > 5 menit). Nilai awal dibaca dari
  `settings.json`.
- Tambah input **API timeout** (`API_TIMEOUT_MS`, milidetik, placeholder
  600000): input hanya menerima digit; Apply memvalidasi integer positif dan
  menolak nilai > 2147483647 (overflow timer → request langsung gagal) dengan
  pesan error. Dikosongkan = tidak ditulis (pakai default 600000 / 10 menit).
- Keduanya ikut ditulis saat Apply, ikut di-reset oleh tombol Reset
  (`API_FORCE_IDLE_TIMEOUT` ditambahkan ke `RESET_ENV_KEYS`; `API_TIMEOUT_MS`
  sudah ada di sana sebelumnya), dan ikut muncul di Manual Config.

- Error `EBADF: bad file descriptor, close` (uncaughtException) di console
  setelah Start/Stop: `fs.closeSync(outFd)` dipanggil dua kali — sekali saat
  startup sukses, sekali lagi oleh listener `child.once("exit")` yang tidak
  pernah dilepas, sehingga saat proxy mati belakangan fd yang sudah tertutup
  ditutup ulang. Kini: fd ditutup tepat sekali via guard `closeOutFd()`,
  listener `exit` fase startup dilepas setelah fase startup selesai, dan
  `closeSync` dibungkus try/catch defensif.
- Regression test baru `tests/unit/headroom-process-lifecycle.test.js`:
  binary `headroom` palsu (HTTP server dengan boot delay 1,5 dtk) —
  start menunggu `/health`, stop, lalu assert tidak ada uncaughtException
  EBADF. Terverifikasi A/B: kode lama gagal dengan EBADF persis seperti
  laporan, kode baru lolos.

### Perbaikan status basi setelah Start/Stop Headroom + dashboard lebih lengkap

- Bug: setelah Start via modal, tombol sudah bertuliskan "Stop Headroom"
  (managedPid terset) tetapi label status masih "Stopped". Akar masalah:
  `startHeadroomProxy()` hanya menunggu proses *tetap hidup*, bukan menunggu
  `/health` bisa dijangkau — refresh status yang langsung jalan setelahnya
  melihat proxy belum listen. Kini start menunggu `/health` hingga 90 detik
  (gagal dengan `HEALTH_TIMEOUT` bila tidak kunjung reachable; `EARLY_EXIT`
  bila proses mati saat boot). Handler Stop di frontend juga polling hingga
  proxy benar-benar tidak reachable (maks 60 detik) agar tidak menampilkan
  status basi. Timeout dibuat longgar agar kompatibel dengan device highend
  maupun low spec.
- Dashboard Headroom diperkaya mengikuti struktur data asli (`/stats`,
  `/stats-history`): hero lifetime (requests, tokens saved, $ saved, input
  tokens/cost, savings %, savings basis), sesi berjalan, detail kompresi
  (avg/best %, tokens removed, tool schema saved), cost breakdown
  (without/with Headroom, measured vs projected, per-source), latensi/
  overhead/TTFB, cache + prefix cache + rate limiter + TOIN, traffic inbound
  per path, grafik savings per periode (hourly/daily/weekly/monthly, toggle
  token/$), tabel savings per model (cari + sortir + ekspor CSV), dan recent
  checkpoints.

### Dashboard Headroom Token Saver + deteksi non-blocking + animasi loading

- Dashboard Headroom baru di `/dashboard/token-saver/headroom` (menggantikan
  proxy dashboard bawaan yang kosong): status running/versi/uptime, tile
  request & token & USD saved (menangani `litellm_available`), grafik token
  savings (daily/weekly/monthly), tabel checkpoint, ekspor CSV, auto-refresh
  30 detik. Data diambil dari `/stats` dan `/stats-history` (API frontend
  stabil menurut dokumentasi resmi Headroom).
- Deteksi Headroom/PXPIPE kini non-blocking: seluruh probing proses
  (`findHeadroomBinary`, `findPython310`, `getHeadroomInstallKind`, extras)
  ditulis ulang menjadi async (`execFileOutputAsync`/`probeRunAsync`/
  `findOnPathAsync` di `src/lib/platform.js`); kandidat python di-probe
  paralel; hasil environment di-cache 30 detik (status `running` selalu
  fresh). Sebelumnya probe sinkron menahan event loop Node sehingga halaman
  tidak bisa ditinggal selama pengecekan. Smoke test: scan pertama ~2725 ms,
  cache hit ~3 ms, event loop tetap bergerak 27 ticks selama scan.
- Animasi loading di halaman Token Saver: badge "Checking…" dengan spinner,
  skeleton "Detecting Headroom installation…", tombol Setup/Manage dan toggle
  Headroom dinonaktifkan selama pengecekan, spinner status di modal; link
  dashboard di modal mengarah ke halaman internal baru.
- Test: `tests/unit/platform-detect.test.js` diperluas (22 lolos, termasuk
  fungsi async + event loop responsif); `tests/unit/headroom-detect.test.js`
  ditulis ulang untuk API async (5 lolos). Production build sukses
  (route `/dashboard/token-saver/headroom` terdaftar).

### Fix dialog "Open with" di halaman Token Saver (Windows)

- Akar masalah: kandidat binary di-probe lewat `execSync(string)` → cmd.exe,
  yang mengeksekusi via asosiasi ekstensi Windows. File tanpa ekstensi
  dikenal (mis. pyenv shim `#!/bin/sh` + `pyenv exec …`) memicu dialog
  "How do you want to open this file?" saat halaman dibuka
  (`/api/headroom/status` → `findPython310()`).
- Modul baru `src/lib/platform.js`: deteksi eksplisit windows/macos/linux
  (`getOsKind()`), `isExecutablePath()` (Windows: wajib ekstensi PATHEXT;
  macOS/Linux: execute bit), `probeRun()`/`findOnPath()` yang tidak pernah
  lewat shell (kecuali `.bat`/`.cmd` yang selalu terasosiasi).
- `headroom/detect.js`: `findHeadroomBinary()`/`findUvBinary()` kini
  memvalidasi hasil `where`/`which` + probe `--version`;
  `findPython310()` probe via `execFile` tanpa shell, nama telanjang di
  Windows diselesaikan lewat `where` (PATHEXT-aware).
- `headroom/process.js` & `pxpipe/install.js`: spawn `.bat`/`.cmd` via shell
  di Windows (sebelumnya CreateProcess gagal); `findNpm()` divalidasi sama.
- Test baru `tests/unit/platform-detect.test.js` (15 lolos); smoke test:
  pyenv shim `headroom` di PATH kini ditolak (`null`), python asli tetap
  terdeteksi.

### Panduan instalasi di README

- Bagian "Instalasi" baru: cara CLI launcher, dari source, plus
  langkah per OS (Windows, Ubuntu/Linux).

### .gitignore minimal

- Hanya cache & artefak build yang di-ignore (`node_modules`, `.next`,
  `coverage`, `logs`, dsb); `docs/*` dan `.env` kini bisa di-add
  (repo private).

### Repo pindah + versi 1.5.0 (termasuk CLI)

- Git remote `origin` → `https://github.com/ch0c01dxyz/akanesia-router`.
- `package.json`: versi `0.5.91` → `1.5.0`.
- `cli/package.json`: name `9router` → `akanesia-router`, versi → `1.5.0`,
  bin → `akanesia-router`, description + keywords + license (Apache-2.0).
- Branding CLI yang terlihat user → "Akanesia-Gateway" (terminal UI,
  cliTools header, tray tooltip, autostart Name/Comment, pesan startup,
  badge npm di cli/README).
- `UPDATER_CONFIG` → install `npm i -g akanesia-router`.
- Process whitelist CLI mengenali kedua nama (transisi aman).
- SENGAJA tetap: data dir `~/.9router`, APP_NAME, `custom:9Router`,
  `9router-runtime`, has9Router.
- Semua referensi URL repo lama (`decolua/9router`) di kode, landing
  page, dan docs diganti ke `ch0c01dxyz/akanesia-router` (61 file).

### Rename project → akanesia-router / Akanesia-Gateway

- `package.json`: `name` `9router-app` → `akanesia-router`.
- Branding UI: `APP_CONFIG.name` "9Router Proxy" → "Akanesia-Gateway"
  (tampil di sidebar, footer, halaman profile); judul tab browser;
  halaman login; landing page; 34 file i18n literals + sinkronisasi
  ulang call-site `translate()` agar tidak ada key basi; README dan
  dokumentasi.
- Identifier fungsional SENGAJA dipertahankan demi kompatibilitas:
  prefix API key `sk_9router`, header `x-9router-*`, nama koleksi DB,
  localStorage keys, direktori `.9router`, dan nama entry "9Router"
  pada config cli-tools pihak ketiga.
- Verifikasi: ESLint 0 error baru (error react-hooks yang muncul
  pre-existing), production build sukses.

### Pengujian langsung 178 endpoint + perbaikan bug

- Sweep `GET` (+`POST {}` bila 405) ke seluruh route API: **0× 500**,
  auth gating benar (401/403), validasi 400 tepat, 405 tepat.
  Jalur inti: `POST /v1/chat/completions` tanpa key → 401 (30 ms),
  key salah → 401 (20 ms), body rusak → 400 (18 ms). Halaman:
  `/login` 200, `/dashboard` → 307 ke `/login`. Log dev bersih.
- **BUG-2 (fungsional, penting)** — `POST /api/v1/api/chat`
  (kompatibel Ollama): `transformToOllama`
  (`open-sse/utils/ollamaTransform.js`) menyamarkan SEMUA error
  menjadi HTTP 200 `{"message":{"content":""},"done":true}` —
  `flush()` selalu mengirim `done:true` dan status asli dibuang.
  Klien tidak bisa membedakan error dari sukses. Perbaikan: respons
  non-OK diteruskan apa adanya (status + body asli). Terverifikasi:
  tanpa key kini → 401 `{"error":{"message":"Missing API key",...}}`.
- **BUG-1 + PERF-3** — `GET /v1/models/[...model]` membangun SELURUH
  katalog (`buildModelsList`, ~0,5–1 dtk) hanya untuk lookup satu
  model / 404; `/v1/models` juga rebuild tiap request tanpa cache.
  Perbaikan (`src/app/api/v1/models/route.js`): cache module-level
  TTL 30 dtk per kombinasi kindFilter. Terverifikasi: `/v1/models`
  hit1 500 ms → hit2 17 ms; lookup 404 → 27–49 ms (dari ~700 ms).
- Verifikasi: ESLint 0 error pada file yang diubah. Tidak ada
  commit/push.

### Audit performa P8 + P11 — diterapkan
- **P8 — capped reader di jalur error non-SSE**
  (`open-sse/handlers/chatCore/streamingHandler.js`): `await
  providerResponse.text()` yang mem-buffer SELURUH body tanpa batas
  diganti `bacaBodyTerbatas()` — hanya 16 KB pertama yang dibaca, lalu
  stream di-cancel agar upstream berhenti mengirim. Sebelumnya upstream
  jahat/rusak bisa mengirim body "error" tak terbatas → memory
  exhaustion (undici `maxResponseSize` default `-1` = unbounded).
  Perilaku downstream tidak berubah: `<title>` tetap diekstrak,
  fail-open → string kosong. Terukur: body 5 MB dari 441 ms → 8 ms.
- **P11 — Agent keep-alive 60 dtk independen dari toggle warmup**
  (`src/lib/fillFirstWarmup.js`): `pasangDispatcherGlobal()` kini
  dipanggil SELALU di `jalankanWarmup()`, sebelum guard
  `fillFirstWarmupEnabled`. Toggle hanya mengendalikan traffic ping
  warmup, bukan pooling koneksi (jalur chat upstream di `base.js`
  memakai `proxyAwareFetch` tanpa dispatcher eksplisit → memakai
  dispatcher global). Terverifikasi via smoke test: request setelah
  idle 4,5 dtk — dispatcher default reconnect, Agent 60 dtk reuse.
  Efek nyata hanya saat warmup dimatikan + origin tanpa keep-alive
  hint (default warmup ON → perilaku tidak berubah).
- Verifikasi: ESLint 0 error/warning pada kedua file; helper P8 diuji
  langsung (body kecil utuh + title terekstrak, body 2 MB tepat
  16384 char dalam 2 ms, null body → `""`); mekanisme P11 diuji
  (reuse vs reconnect). Test unit `fill-first-warmup.test.js` gagal
  load karena alias `open-sse/` tidak ter-resolve di vitest —
  pre-existing (gagal identik dengan perubahan di-stash), di luar
  cakupan tugas ini. Production build: sukses (`npm run build`
  exit 0, postbuild standalone assets OK).
- Tidak ada commit/push.

### Merge provider OmniRoute — selesai (sisa 4 ID)

- Investigasi: dari 194 ID provider OmniRoute yang dulu belum ada, 190
  ternyata sudah masuk (152 diimpor 2026-09-29 + sisanya sudah ada dengan
  nama sama). Perbandingan nama ID saat ini hanya menyisakan 4:
  `devin`, `gitlab-duo`, `segmind`, `tinycms` — setelah dicek, 2 di
  antaranya false positive: `devin` sudah jadi alias di `devin-cli.js`,
  dan direktori `tinycms/` di OmniRoute sebenarnya ber-ID `tinycms-web`
  (sudah ada di 9router).
- **Baru: `segmind`** (`open-sse/providers/registry/segmind.js` +
  `open-sse/handlers/imageProviders/segmind.js`, terdaftar di
  `imageProviders/index.js`): provider image generation — 6 model
  (FLUX.1 Schnell/Dev/1.1 Pro, SDXL 1.0, SD 3.5 Large, Kandinsky 2.2).
  Wire shape terverifikasi dari sumber resmi 2026-09-30:
  `POST https://api.segmind.com/v1/{model}`, header `x-api-key`, body
  JSON `{prompt, aspect_ratio}`, respons raw image bytes → `b64_json`.
  Guard anti path-traversal pada model ID. Model video (wan/hunyuan/ltx/
  kling) belum diport — butuh verifikasi format async job dulu.
- **`gitlab.js`**: tambah `aliases: ["gitlab-duo", "gld"]` + 2 model dari
  entri `gitlab-duo` OmniRoute (`claude-sonnet-4-6`, `claude-haiku-4-5`).
  Tidak dibuat entri terpisah karena `gitlab` di 9router memang adalah
  layanan GitLab Duo yang sama (display name identik).
- `scripts/generate-registry-index.mjs` dijalankan ulang (320 entri).
- Verifikasi: ESLint 0 error, smoke test runtime (registry load,
  imageConfig, adapter URL/header/body, traversal guard) lolos.
  Tidak ada commit/push.

### Quick wins performa (dari audit 2026-09-30)

- **SSE anti-buffering** (`open-sse/utils/sseConstants.js`):
  `SSE_HEADERS_CORS` kini mengirim `X-Accel-Buffering: no` dan
  `Cache-Control: no-cache, no-transform` — melindungi TTFT/latency
  antar-token bila 9router di balik reverse proxy. Selaras dengan pola
  `SSE_HEADERS_NO_BUFFER` yang sudah ada.
- **Hapus import tak terpakai** (`open-sse/translator/index.js`):
  `AntigravityExecutor` hanya dipakai di komentar — modul + transitifnya
  (~449 ms waktu import) tidak lagi ditarik saat startup. Executor
  antigravity tetap terdaftar via lazy-load manifest.
- Verifikasi: ESLint lolos, `npm run build` sukses. Tidak ada commit/push.

### Batch 2 — lanjutan optimasi performa

- **Buffered async writer** (`open-sse/utils/requestLogger.js`):
  `appendProviderChunk` / `appendOpenAIChunk` / `appendConvertedChunk`
  tidak lagi `fs.appendFileSync` per chunk. Diganti class internal
  `BufferedChunkWriter`: satu `fs.WriteStream` per file log (lazy),
  antrean memori, flush pada ≥64 KB / ≥100 potong / 1 detik (timer
  di-`unref`), stream idle >60 detik ditutup otomatis, flush saat
  `beforeExit`/`SIGINT`/`SIGTERM`, dan fail-open total (logging tidak
  pernah melempar ke hot path). Format baris + nama file tidak berubah.
  Smoke test 1000 chunk: isi byte-identik. Test existing yang gagal
  terkonfirmasi pre-existing (resolusi alias `@/`, gagal juga di kode
  asli). ESLint lolos. Tidak ada commit/push.
- **`getSettings()` sekali per request** (`src/sse/handlers/chat.js`,
  `src/sse/services/auth.js`): settings dibaca 1× di awal `handleChat`,
  diteruskan sebagai parameter ke `handleSingleModelChat` (6 call site +
  2 rekursi combo) dan ke `getProviderCredentials` via
  `options.settings` (kompatibel mundur untuk 13 pemanggil lain).
  Penghematan: dari `2 + 2N` menjadi 1 panggilan per request
  (N = percobaan fallback). Jalur combo kini meneruskan
  `maxFallbacks` dari settings ke plumbing `combo.js` yang sudah ada.
  Koreksi verifikasi: guard batas fallback yang sempat ditambahkan agen
  di loop single-model saya revert — itu perubahan perilaku di luar
  lingkup refactor, bukan bagian instruksi.
- Verifikasi batch 2: ESLint lolos (3 file), `npm run build` sukses.
  Tidak ada commit/push.

### Batch 3 — sisa optimasi performa (2026-09-30)

- **Prefetch gambar paralel** (`open-sse/translator/concerns/prefetch.js`,
  `concerns/image.js`, `config/mediaConfig.js`): `prefetchRemoteImages`
  kini unduh paralel via worker pool (konkurensi 4, config-driven).
  Reuse Agent per hostname unik per sesi (bukan satu Agent global —
  lookup undici di-pin ke IP tervalidasi per hostname anti-TOCTOU, jadi
  satu Agent lintas hostname akan salah routing + melubangi SSRF guard).
  Urutan hasil deterministik, fail-open per gambar, timeout per gambar
  tetap. Smoke test: 4 gambar × 300ms selesai 347ms (vs ±1200ms serial).
  Test `prefetch-images` 7/7 lolos; 3 gagal di codex/image-fetch
  terkonfirmasi pre-existing (sandbox DNS). ESLint lolos.
- **Pool koneksi MITM + hygiene** (`open-sse/utils/proxyFetch.js`,
  `open-sse/config/runtimeConfig.js`): `createBypassRequest` tidak lagi
  buka socket + TLS handshake per request — kini satu undici `Agent`
  singleton dengan `connect.lookup` kustom (logika Google-DNS bypass
  pindah ke lookup, koneksi di-pool per origin dengan keep-alive).
  SNI = hostname asli dan validasi sertifikat tetap aktif (terverifikasi:
  self-signed ditolak). Implementasi lama dipertahankan verbatim sebagai
  fallback. Agent di-`close()` saat eviksi dari cache (batas 20 tetap);
  DNS cache dibatasi 500 entri (LRU, config-driven
  `MEMORY_CONFIG.dnsCacheMaxSize`), expiry tetap dihormati. Smoke test:
  10 request → 2 koneksi TCP (vs 10 handshake sebelumnya).
- **Dua metrik TTFT** (`open-sse/utils/stream.js`,
  `open-sse/handlers/chatCore/streamingHandler.js`): `latency.ttft` tetap
  (byte pertama dari upstream, dashboard kompatibel); baru
  `latency.ttftClient` (payload pertama benar-benar ke klien, diukur via
  pembungkus `enqueueKeKlien` di semua titik enqueue).
  `onStreamComplete` menerima argumen ke-4 opsional (backward compatible).
- **Fast path SSE** (`open-sse/utils/stream.js`): di mode passthrough,
  baris "bersih" (kriteria konservatif: chat chunk OpenAI tanpa
  tool_calls/usage/Azure/type/response, finish_reason null/absen, id
  valid, ada object+created, konten terbukti berharga) diteruskan mentah
  tanpa JSON.parse/re-encode; ragu sedikit pun → jalur lama. `[DONE]`,
  komentar, dan `event:` tetap byte-identik termasuk quirk duplikasi.
  Efek samping direplikasi (akumulasi konten via regex, reqLogger).
  Smoke test byte-identical 16 kasus + 36 test streaming existing lolos.
- **Lazy-load translator** (`open-sse/translator/index.js` + choke points):
  24 modul translator tidak lagi diimpor statis; dimuat on-demand via
  `TRANSLATOR_MANIFEST` (dynamic import + cache + singleflight, pola sama
  seperti lazy-load executor; fail-loud bila import gagal).
  `translateRequest`/`translateResponse` tetap sinkron (hot path per-chunk
  SSE tak tersentuh). Entry point async wajib preload dulu:
  `chatCore.js` (bypass + full pair via pivot), `src/sse/handlers/chat.js`
  (bypass claude-cli), `api/translator/translate/route.js`,
  `executors/github.js`. Audit side-effect: satu-satunya side-effect
  top-level adalah `register()` — aman dari circular-import deadlock.
  4 file yang masih ter-import langsung di tempat lain (rtk/headroom,
  nonStreamingHandler) adalah pre-existing dan aman karena `register()`
  idempotent. Test baru `tests/translator/lazy-load.test.js`: 8/8 lolos.
  Full suite translator: 950 lolos, 14 gagal terkonfirmasi pre-existing
  (uji A/B git stash menghasilkan 14 kegagalan identik dengan index.js
  original — berasal dari pekerjaan paralel lain, bukan perubahan ini).

### Ide #5c — Koreksi kontrak BazaarLink (hasil verifikasi harness lokal)

Verifikasi kontrak via agent harness lokal Egar (MCP browser, 19 item
A1–D19, laporan `laporan-verifikasi-bazaarlink.md`) menemukan 5 asumsi
implementasi yang salah. Diperbaiki via 3 agen paralel:

- **Auth BazaarLink opsional** (`src/app/api/probe/online/route.js`):
  endpoint publik tidak mewajibkan Bearer (7 run diterima tanpa auth);
  Bearer admin hanya untuk bypass rate limit. Blok 400
  "bazaarApiKey wajib diisi" dihapus; header `Authorization` hanya
  dikirim bila key tersedia (env `BAZAARLINK_API_KEY` atau input UI).
- **`upstreamFormat` eksplisit**: dipetakan dari `transport.format`
  registry (`claude` → `anthropic`, selainnya → `openai`).
- **Ownership polling** (`[runId]/route.js` + UI): start-run generate
  `pollToken` (`crypto.randomUUID()`), disimpan server-side, dikembalikan
  ke UI; route polling mewajibkan token via `?token=` / `x-poll-token`
  (403 bila salah, 404 bila runId tidak dikenal). Perbaiki bug
  "Bearer null" — header auth ke BazaarLink hanya bila key ada.
- **Render hasil dari `identityAssessment`** (`ProbeSection.js`):
  outer `status`, `verdict.status` (8 nilai kontrak dipetakan ke label
  Indonesia), `trueFamily`/`trueModel`/`confidence` dari verdict;
  null = "belum diketahui". Fallback defensif bila field tidak ada.
- **Microcopy biaya**: "84–86 request berbayar" → "84 tes standar +
  2 opsional; jumlah request dan biaya upstream bervariasi".
- Rate limit terverifikasi 30 run/IP/jam (per IP egress, key user tidak
  bypass); format 429 `retryAfterSeconds` + header `Retry-After`.
- ESLint lolos untuk ketiga file. Tidak ada commit/push.

## 2026-09-29

### Ide #1 — Lazy-load executor ✅

`getAdapter(id)` / `getExecutor(provider)` kini async; adapter di-load
on-demand via dynamic import, bukan 322 sekaligus saat startup.

- **Loader**: `open-sse/executors/index.js` ditulis ulang —
  `createAdapterLoader({ manifest, toFileUrl, importModule })` dengan cache
  `Map`, singleflight (in-flight dedupe), rejection tidak di-cache,
  fallback `DefaultExecutor` bila adapter spesialis gagal di-load.
- **Manifest**: `open-sse/executors/adapterDefs.js` (45 adapter spesialis) +
  `open-sse/executors/adapters.manifest.js` (322 id, auto-generate via
  `scripts/generate-registry-index.mjs`, di-import eager).
- **Registry**: generator menghormati 3 provider yang SENGAJA dinonaktifkan
  (`trae`, `devin-cli`, `windsurf`) — tidak ikut `registry/index.js`
  maupun manifest (319 aktif).
- **Build**: `next.config.mjs` `outputFileTracingIncludes` memastikan 76
  file executor ada di `.next/standalone` (terverifikasi).
- Semua call site produksi di-`await`; bulk check-models pakai
  `Promise.allSettled`.
- **Perbaikan audit**: `DefaultExecutor` pakai import relatif (alias `@/`
  tidak dikenal dynamic import Node); `probe.js` perbaiki
  `await getExecutor(...).execute(...)`; 4 file test di-`await`.
- Test: `executor-lazy-load.test.js` 7/7.

### Ide #2 — Warming koneksi fill-first ✅

Hilangkan penalti cold-start TLS pada request pertama ke provider aktif.

- **Modul**: `src/lib/fillFirstWarmup.js` — selective lazy warm: hanya
  provider AKTIF (koneksi aktif + muncul di `usageHistory` 7 hari terakhir).
- Ping ringan TANPA auth ke origin provider; concurrency ≤ 4, timeout
  10 dtk/request, deadline total 30 dtk, 1 retry berjitter hanya untuk
  timeout/429/503. Gagal = diam, boot tidak tertunda.
- **Anti-SSRF**: origin hanya dari `baseUrl` koneksi milik user / registry;
  hanya http/https; tidak pernah URL arbitrary.
- Satu undici `Agent` global (`keepAliveTimeout` 60 dtk) via
  `setGlobalDispatcher`, sekali saja, fail-open, hanya bila ON.
- **Toggle**: `fillFirstWarmupEnabled` (default ON) + kartu status di
  halaman Endpoint; OFF = nol traffic. Toggle ON berlaku langsung tanpa
  restart (`triggerFillFirstWarmup()` di `PATCH /api/settings`).
- Status di `/api/health`; singleton `globalThis` (HMR-safe).
- Test: `fill-first-warmup.test.js` 12/12.

### Ide #5c — Tab "Probe LLM" ✅

Cek keaslian LLM provider (asli vs masking) dari halaman detail provider.

- **Offline** (MVP): `open-sse/config/probe.js` + `open-sse/services/probe.js`
  — baterai 13 call (P1 identitas, P2 cutoff, P3 token, P4 streaming,
  P5 password n-gram, P6 satu-token JSD); JSD basis-2 ala
  llm-fingerprint-detector, skor ensemble n-gram ala whorl; verdict
  match/uncertain/mismatch/insufficient_data.
- **Online**: via BazaarLink Probe API — `POST /api/probe/online` +
  polling `[runId]`; 429 diteruskan + countdown UI tanpa auto-retry.
- **Nol-secret**: klien hanya kirim `connectionId`; key diselesaikan
  server-side; field sensitif di-strip rekursif dari hasil polling;
  `pesanAman()` redact pola secret di error; `bazaarApiKey` hanya di
  memori (maks 35 menit).
- **Key BazaarLink**: `BAZAARLINK_API_KEY` di `.env` dibaca server-side
  sebagai default; input manual di UI kini opsional (kosong = pakai key
  server).
- **UI**: `ProbeSection.js` (sub-tab Offline/Online), `SearchableSelect.js`,
  `MetricCard.js`, `ProbeGroupRow.js`, `WarningList.js`; seluruh literal
  ikut `translate()` (54 entri baru `id.json`).
- Fingerprint referensi: struktur + loader siap; fingerprint empiris
  `infoapi/space-bunny-free.json`, `bariska/deepseek-v4.1-flash.json`,
  `bariska/mimo-v2.6-flash.json`, `dahl/MiniMaxAI_MiniMax-M2.7.json`, dan
  `atria/Atria-Dawn-Preview.json` (parsial — 11/13 call gagal), dan
  `tokenharbor/deepseek-v4.1-flash:free.json`, dan
  `aipixel/gpt-5.6-luna.json`, dan `anthropic/claude-sonnet-5-5.json`
  (fingerprint RESMI pertama dari api.anthropic.com) dikumpulkan dari run
  live 2026-09-29 (kalibrasi awal, 3 sampel/cell).
- Live-test 2026-09-29: deepseek-v4.1-flash (13/13 call, billing_anomaly;
  identitas bingung "ChatGPT?", reasoning bocor ke jawaban), mimo-v2.6-flash
  (12/13 call, billing_anomaly + backend_rotation + 1 call gagal; identitas
  bersih "MiMo/Xiaomi", cutoff 2025-01; satu jawaban P6 mengandung teks injeksi
  promosi dengan homoglyph Cyrillic), dahl DeepSeek-V4-Flash-0731 (13/13 gagal
  — HTTP 429 concurrency capacity, akun berbayar didahulukan), dahl
  MiniMax-M2.7 (9/13 call, backend_rotation + 4 call gagal; tag <think>
  bocor ke semua jawaban), atria Atria-Dawn-Preview (2/13 call berhasil,
  11 call gagal — endpoint tidak stabil; identitas "Atria by Shanghai AI Lab"),
  tokenharbor deepseek-v4.1-flash:free (12/13 call, billing_anomaly + 1 call
  gagal; P5 mengembalikan password IDENTIK 3x berturut-turut pada temperature
  1.0 — indikasi kuat temperature diabaikan / response di-cache), aipixel
  gpt-5.6-luna (12/13 call, billing_anomaly + backend_rotation + 1 call gagal;
  P1 mengklaim "OpenAI o3", P2 cutoff 2024-06 — pola masked identity claim),
  anthropic claude-sonnet-5-5 (13/13 call ke endpoint RESMI api.anthropic.com;
  temperature deprecated → 400 bila dikirim; P1 "I'm Claude, made by Anthropic";
  P2 cutoff ~2025-01; thinking menghabiskan budget max_tokens pada P2/P6-angka).
- Test: `probe-*.test.js` 50 passed, 1 skipped.
- **Batasan jujur**: P5/P6 butuh lebih banyak sampel untuk baseline final;
  kontrak BazaarLink belum terverifikasi penuh.

### Ide #7 — Tab "Replay" di Console Log ✅

Ulangi request upstream yang gagal untuk debugging, tanpa membuat ulang
dari klien.

- **Buffer**: `src/lib/requestReplayBuffer.js` — ring buffer in-memory
  singleton (`globalThis`, HMR-safe), tidak di-persist. Kapasitas berbasis
  byte dari setting `replayLogMaxBytes` (default 5 MB), drop-oldest,
  tidak pernah melewati batas. Fail-open: `captureReplayEntry` tidak
  pernah throw.
- **Redaksi saat capture (fail-closed)**: header sensitif
  (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`,
  `proxy-authorization`) → `[REDACTED]`; key JSON sensitif
  (`password`, `secret`, `access_token`, `refresh_token`, `api_key`,
  `apikey`, `client_secret`) rekursif case-insensitive; query param URL
  sensitif di-redact; custom header ide #8 di-redact via
  `redactCustomHeaders`; **nilai secret aktual** dari credentials
  (`apiKey`, token OAuth, value custom header) disapu dari free-text
  body/response/error agar gema upstream tidak bocor. Body truncate
  ~64 KB, response ~8 KB.
- **Capture**: hook di `open-sse/handlers/chatCore.js` — hanya request
  upstream yang GAGAL (status ≥ 400 / network error / exception); abort
  klien (499) tidak di-capture. Body yang disimpan adalah
  `translatedBody` (format provider).
- **API**: `GET /api/replay-log` (daftar + statistik; selaraskan cap dari
  setting), `DELETE /api/replay-log` (clear),
  `POST /api/replay-log/[id]/replay` (body opsional `{ body }` untuk edit
  sebelum kirim; resolve koneksi tersimpan server-side via
  `getProviderCredentials` + `preferredConnectionId`; **409 bila koneksi
  asal tidak tersedia** — tidak pernah fallback diam-diam ke akun lain;
  eksekusi via executor yang sama, non-streaming, timeout 90 dtk).
- **UI**: `ConsoleLogClient.js` jadi container tab config-driven
  (`TABS`: Logs, Replay) ala #5b; `ConsoleLogsTab.js` diekstrak verbatim
  dari kode lama; `ReplayTab.js` baru — tabel entry (waktu,
  provider/model, method+path, badge status, latensi), expand detail
  (header ter-redact, body, response), edit body sebelum replay, tombol
  Replay/Clear (konfirmasi), pengaturan kapasitas MB → `PATCH
  /api/settings`, polling 15 dtk.
- **Penyimpangan sadar**: capture hanya yang gagal (bukan tiap request);
  body replay as-is mengirim `[REDACTED]` bila secret asli sudah
  di-redact (trade-off keamanan yang disengaja).
- **Verifikasi**: test `request-replay-buffer` 24/24 (termasuk uji
  adversarial: tidak ada secret di entry mana pun), ESLint bersih,
  regresi chatCore 20/20, full `npm run build` lulus. Tiga temuan
  verifikasi diperbaiki: custom header ide #8 belum ter-redact di buffer,
  secret free-text lolos redaksi, URL relatif ber-query tidak ter-redact.

### Ide #6 — Check Models terjadwal ("Auto Sync") ✅

Check Models berjalan otomatis berkala untuk provider yang di-ON-kan user.

- **Scheduler**: `src/lib/checkModelsAutoSync.js` — recursive `setTimeout`
  (self-scheduling; jadwal berikutnya dipasang setelah tick selesai, tanpa
  overlap by construction) + flag anti-overlap lapis 2. Singleton
  `globalThis` agar HMR tidak menggandakan. Timer `unref()`, clamp delay
  1 dtk – 2³¹−1 ms (anti overflow). Tiap tick baca settings fresh
  (`autoSyncProviderIds`, `checkModelsTtlSeconds`); tidak ada provider ON
  atau TTL ≤ 0 → skip run tapi tetap jadwalkan ulang. Concurrency
  antar-provider 3 (`Promise.allSettled` per batch), try/catch
  sekeliling tick — fail-open. Tick pertama 60 dtk setelah start.
- **Reuse**: route `check-models` mengekspor `checkProviderModels()` —
  dipakai route POST dan scheduler (tanpa duplikasi logika
  fetch/timeout). Scheduler memanggil dengan `forceRefresh: true`;
  hasil ditulis ke cache ide #3 (satu sumber data).
- **Boot**: `startAutoSync()` dipanggil di `initializeApp()` →
  `runHeavyStartup()` (server-side only; dynamic import + catch).
- **UI**: radiobox "Auto Sync" ON/OFF di kanan header section "Available
  Models" (halaman detail provider). Toggle PATCH `/api/settings`
  (`autoSyncProviderIds`); scheduler membaca settings fresh tiap tick
  jadi tidak perlu restart.
- **Setting**: `autoSyncProviderIds: []` (default) di settingsRepo.
- **Verifikasi**: test `check-models-autosync` 13/13, regresi
  `check-models-cache` 9/9, ESLint bersih, full `npm run build` lulus.
  Kriteria terima terpenuhi: ON → refresh berkala tanpa duplikasi run;
  OFF → tidak ada timer; HMR → singleton.

### Ide #5b — Tab "Compare" di Playground ✅

Bandingkan 2–3 model provider dalam satu prompt, side-by-side.

- **Struktur**: `PlaygroundSection.js` ditulis ulang jadi container tab
  config-driven (`TABS`: Test, Compare) — tab "Probe LLM" (ide #5c)
  tinggal tambah entri. Props ke `page.js` tidak berubah.
- **Baru**: `playgroundUtils.js` (helper bersama: `buildAvailableModels`,
  `hasActiveConnection`, `formatMs`, `parseSsePayload`,
  `streamChatCompletion` — satu pipeline SSE untuk kedua tab),
  `usePlaygroundApiKey.js` (auto-load + auto-provision key),
  `PlaygroundTestTab.js` (ekstrak dari kode lama; perilaku 100% sama),
  `PlaygroundCompareTab.js`.
- **Compare**: 3 select model (2 wajib + 1 opsional, maks 3, duplikat
  dicegah), satu prompt (Ctrl+Enter), fan-out paralel
  (`Promise.allSettled`, AbortController per kolom), kolom responsif
  side-by-side, statistik TTFT/latensi/token per kolom + tabel
  ringkasan. Token dari server sudah termasuk buffer internal —
  ditampilkan apa adanya. Berhenti → status kolom "Stopped".
- **Verifikasi**: test `playground-utils` 15/15, ESLint bersih,
  full `npm run build` lulus. Satu temuan verifikasi (kolom di-stop
  tampil "Done") diperbaiki.

### Ide #4 — Fill-first sadar kuota ✅

Visibilitas kegagalan kuota/error per koneksi+model di dashboard — **tanpa
pemblokiran/cooldown** (lokal & intranet). Setiap request tetap mencoba
koneksi sesuai urutan strategy; threshold hanya mengatur kapan insiden
muncul di dashboard.

- **Klasifikasi**: `open-sse/config/quotaErrorClasses.js` (baru) —
  `classifyQuotaError(status, errorText)` pure & config-driven:
  `rate_limited` (429/503/504), `overloaded` (529), `quota_exhausted`
  (402 / 429 ber-body quota), `auth_error` (401/403 kredensial),
  `policy_refusal` (403 content-policy / safety — tidak dihitung),
  `server_error` (500/502), `payload_error` (400/404/… — tidak dihitung),
  `ignored` (499). Nuansa OpenRouter `limit_source` didukung.
- **Counter**: `src/sse/services/quotaIncidents.js` (baru) — in-memory per
  `connectionId|model`, HMR-safe, fail-open. Hook di baris pertama
  `markAccountUnavailable`/`clearAccountError` (`src/sse/services/auth.js`)
  — choke point semua handler. Sukses sekali → counter reset + entri
  dashboard terhapus (request biasa, agent harness, test provider).
- **Guard dalam-request**: cycle guard (satu koneksi/model tidak dicoba 2×
  per request) + batas kedalaman fallback `quotaMaxFallbacks` (default 5)
  di `open-sse/services/combo.js` dan loop `while(true)`
  `src/sse/handlers/chat.js`. Perilaku retry/fallback existing tidak diubah.
- **Dashboard**: card "Insiden Kuota & Error" di bawah card API keys
  (`EndpointPageClient.js`) — tabel provider–model–error terakhir (×N)–
  tanggal/waktu + legenda warna (🟡 429/503/529, 🔴 401/403/402,
  🟠 500/502/504, 🟣 kuota habis). API `GET /api/quota-incidents`.
- **Persistensi**: tabel `quota_incidents` (SQLite, `SCHEMA_VERSION` 1→2,
  migrasi additive) — tahan restart. Setting baru `quotaFailureThreshold`
  (default 3, rentang 1–10) dan `quotaMaxFallbacks` (default 5).
- **Test**: `quota-error-classes` 21/21, `quota-incidents-repo` 5/5
  (SQL asli via node:sqlite), `combo-routing` 5/5; regresi
  `auth-status`, `fetch-success-clears-account`, `combo-fusion` lulus.
- **Diperbaiki saat verifikasi**: 4 test bogus (impor fungsi yang tidak ada
  di `combo.js`) diganti 1 test valid; inkonsistensi model-null
  (counter naik tapi dashboard tidak persist) dinormalisasi ke `""`.
- **Diketahui**: `server_error` ikut menaikkan counter (penyimpangan sadar —
  tanpanya legenda oranye mati); 2 gagal di
  `combo-autoswitch.test.js` adalah pre-existing (terverifikasi via stash).
- **Tambahan 2026-09-29**: jalur Antigravity quota kini masuk dashboard —
  `handleAntigravityQuotaError()` memanggil `recordFailure`
  (`quota_exhausted`, langsung tampil) saat strike ke-3 (blokir 15 mnt)
  maupun upstream exhausted (`resetAt`). Test
  `antigravity-quota-incidents` 3/3.

### Ide #8 — Advanced Option provider custom ✅

Custom header per provider OpenAI/Anthropic-compatible (`x-api-key`,
`Authorization`, dsb.) dengan placeholder `{{key}}` → API key koneksi.

- **UI**: `CustomHeadersEditor.js` (baru) — section "Advanced Option",
  collapsed default, editor key-value + preset
  (`Authorization: Bearer {{key}}`, `x-api-key`, `X-API-Key`, `xi-api-key`).
  Dipakai di `AddCompatibleModal` dan `EditCompatibleNodeModal`;
  tombol Check ikut memakai custom headers.
- **Util**: `src/shared/utils/customHeaders.js` (baru) — validasi nama
  header (RFC 7230 token, maks 20 header), `applyCustomHeaders`
  (custom menang atas header default, resolve `{{key}}`),
  `redactCustomHeaders`.
- **Simpan**: `customHeaders` di `providerNodes.data` → snapshot ke
  `connection.providerSpecificData.customHeaders` (create, update,
  propagasi PUT). Tanpa migrasi schema.
- **Runtime**: `DefaultExecutor.buildHeaders()` menerapkan custom header
  paling akhir (choke point — semua compatible provider mewarisi).
- **Log**: value custom header di-redact di request log
  (`4_req_target.json`) dan DB log — tidak bocor ke file log.
- **Test**: `tests/unit/custom-headers.test.js` 6/6 lulus; 17 assertion
  util lulus.

### Ide #3 — Cache hasil Check Models ✅

Hasil `GET /models` per provider di-cache (TTL + SWR-lite) agar tidak
fetch berulang.

- **Cache**: `src/lib/checkModelsCache.js` (baru) — in-memory Map HMR-safe
  (`globalThis` singleton). Fresh (umur < TTL) → langsung dari cache;
  stale → data basi + background refresh (singleflight); miss → fetch
  singleflight (request konkuren = 1 fetch upstream). TTL efektif =
  setting ± jitter 60 dtk (min 1 dtk). TTL 0 = bypass total.
  Hanya hasil `ok:true` yang di-cache.
- **Setting**: `checkModelsTtlSeconds` (detik, default 3600, 0 = mati)
  di `settingsRepo`.
- **API**: `POST /api/providers/check-models` — lapisan
  `checkProviderWithCache`; hasil dari cache ditandai `cached: true`
  (aditif, UI lama kompatibel); body `forceRefresh: true` = invalidate
  lalu fetch segar (hasil ikut tersimpan). Timeout 15 dtk & concurrency 5
  tidak berubah.
- **UI**: tombol Check per provider mengirim `forceRefresh: true`
  (obat data basi selain TTL); tombol Check-all memakai cache
  (klik ulang dalam TTL tanpa hit network).
- **Test**: `tests/unit/check-models-cache.test.js` 9/9 lulus.

### Hasil verifikasi gabungan

- `node --check`: semua file baru/ubah OK.
- ESLint: file baru 0 problem; error yang tersisa pre-existing
  (pola `set-state-in-effect` yang disengaja, konvensi AGENTS.md #10).
- Vitest: 15/15 lulus (`custom-headers` + `check-models-cache`).
- 1 test gagal pre-existing & tidak terkait
  (`claude-header-forwarding` — timeout network, gagal juga di tree bersih).
