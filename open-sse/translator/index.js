import { FORMATS } from "./formats.js";
import { ensureToolCallIds, fixMissingToolResponses } from "./concerns/toolCall.js";
import { prepareClaudeRequest, ensureTrailingUserTurn } from "./formats/claude.js";
import { cloakClaudeTools, decloakStreamChunk } from "../utils/claudeCloaking.js";
import { restoreToolNames } from "../utils/opencodeFingerprint.js";
import { filterToOpenAIFormat } from "./formats/openai.js";
import { normalizeThinkingConfig } from "../services/provider.js";
import { applyThinking, captureThinking } from "./concerns/thinkingUnified.js";
import { captureSessionId } from "../utils/sessionManager.js";
import { ensureStreamToolCallIds } from "../utils/streamHelpers.js";
import { ROLE, GEMINI_ROLE } from "./schema/roles.js";
import { PROVIDERS } from "../providers/index.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Registry for translators. Backed by a globalThis singleton: under `next start`
// the bundled chunk AND the natively-imported source translator files are TWO
// instances of this module — without sharing, register() side-effects from the
// dynamic imports never reach the instance the hot path reads, and every
// translateResponse() silently no-ops (raw upstream frames forwarded as-is,
// e.g. agentrouter's claude SSE reaching an OpenAI client untranslated).
// Hoisted function (not var+??=): register() must stay callable during
// circular import, before this module's body evaluates.
function REGS() {
  return (globalThis.__9router_translatorRegistries__ ??= { request: new Map(), response: new Map() });
}

// Register translator
export function register(from, to, requestFn, responseFn) {
  const regs = REGS();
  const key = `${from}:${to}`;
  if (requestFn) {
    regs.request.set(key, requestFn);
  }
  if (responseFn) {
    regs.response.set(key, responseFn);
  }
}

// No-op (dulu: translator self-register via static import; sekarang via
// lazy-load ensureTranslatorsFor*). Dipertahankan agar pemanggil lama tidak rusak.
function ensureInitialized() {}

// Strip specific content types from messages (explicit opt-in via strip[] in PROVIDER_MODELS)
function stripContentTypes(body, stripList = []) {
  if (!stripList.length || !body.messages || !Array.isArray(body.messages)) return;
  const imageTypes = new Set(["image_url", "image"]);
  const audioTypes = new Set(["audio_url", "input_audio"]);
  const shouldStrip = (type) => {
    if (imageTypes.has(type)) return stripList.includes("image");
    if (audioTypes.has(type)) return stripList.includes("audio");
    return false;
  };
  for (const msg of body.messages) {
    if (!Array.isArray(msg.content)) continue;
    msg.content = msg.content.filter(part => !shouldStrip(part.type));
    if (msg.content.length === 0) msg.content = "";
  }
}

// Role di mana percakapan klien sebenarnya berakhir, dalam bentuk format sumbernya
// sendiri — tidak semua sumber memakai messages[] (Gemini/Antigravity: contents[],
// Responses/Codex: input[]). Hanya giliran model/assistant eksplisit di akhir yang
// merupakan prefill asli dan harus diteruskan ke ensureTrailingUserTurn sebagai
// ROLE.ASSISTANT; ekor lainnya (termasuk tanpa role, mis. function output) tetap
// undefined agar perbaikan giliran-kosong tetap berlaku.
function detectClientLastRole(body) {
  if (Array.isArray(body?.messages)) return body.messages[body.messages.length - 1]?.role;
  const items = Array.isArray(body?.contents) ? body.contents : Array.isArray(body?.input) ? body.input : null;
  if (!items) return undefined;
  const role = items[items.length - 1]?.role;
  return role === ROLE.ASSISTANT || role === GEMINI_ROLE.MODEL ? ROLE.ASSISTANT : undefined;
}

// Translate request: source -> openai -> target
export function translateRequest(sourceFormat, targetFormat, model, body, stream = true, credentials = null, provider = null, reqLogger = null, stripList = [], connectionId = null, clientTool = null) {
  ensureInitialized();
  let result = body;
  // Role yang sebenarnya dikirim klien di akhir, sebelum translator membuang giliran yang dikosongkan.
  const clientLastRole = detectClientLastRole(body);

  // Strip explicit content types (opt-in via strip[] in PROVIDER_MODELS entry)
  stripContentTypes(result, stripList);

  // Normalize thinking config: remove if lastMessage is not user
  normalizeThinkingConfig(result);

  // Always ensure tool_calls have id (some providers require it)
  ensureToolCallIds(result);
  
  // Kiro performs stricter source-aware reconciliation after session replay.
  // The generic helper inserts OpenAI `role: tool` messages, which a direct
  // Claude→Kiro translator cannot consume and which cannot repair partial
  // parallel tool results.
  if (targetFormat !== FORMATS.KIRO) {
    fixMissingToolResponses(result);
  }

  // Capture thinking intent from the original (pre-translation) body, before any
  // format conversion strips/renames the fields. Applied after translation.
  const thinkingIntent = captureThinking(result);

  // Capture session id from the original body (envelope still intact, e.g. antigravity request.sessionId)
  const clientSessionId = captureSessionId(result, credentials, connectionId, targetFormat);
  // Expose to downstream translators (gemini-cli/antigravity envelopes) that run after envelope is stripped
  if (credentials) credentials._clientSessionId = clientSessionId;

  // If same format, skip translation steps
  if (sourceFormat !== targetFormat) {
    // Direct route: if a translator is registered for this exact source:target
    // pair, use it instead of pivoting through OpenAI. This is lossless for
    // pairs like claude:kiro (avoids the claude->openai->kiro double-hop).
    const directFn = REGS().request.get(`${sourceFormat}:${targetFormat}`);
    if (directFn) {
      result = directFn(model, result, stream, credentials);
    } else {
      // Step 1: source -> openai (if source is not openai)
      if (sourceFormat !== FORMATS.OPENAI) {
        const toOpenAI = REGS().request.get(`${sourceFormat}:${FORMATS.OPENAI}`);
        if (toOpenAI) {
          result = toOpenAI(model, result, stream, credentials);
          // Log OpenAI intermediate format
          reqLogger?.logOpenAIRequest?.(result);
        }
      }

      // Step 2: openai -> target (if target is not openai)
      if (targetFormat !== FORMATS.OPENAI) {
        const fromOpenAI = REGS().request.get(`${FORMATS.OPENAI}:${targetFormat}`);
        if (fromOpenAI) {
          result = fromOpenAI(model, result, stream, credentials);
        }
      }
    }
  }

  // Normalize thinking to the target provider-native format (config-driven, capability-aware).
  // Kiro's GenerateAssistantResponse request does not accept the generic top-level
  // `thinking` field; its translators map thinking intent to KAS-compatible
  // systemPrompt/additionalModelRequestFields instead.
  const kiroThinkingMappedByTranslator =
    targetFormat === FORMATS.KIRO &&
    (sourceFormat === FORMATS.OPENAI || sourceFormat === FORMATS.CLAUDE);
  if (!kiroThinkingMappedByTranslator) {
    applyThinking(targetFormat, model, result, provider, thinkingIntent);
  }

  // Always normalize to clean OpenAI format when target is OpenAI
  // This handles hybrid requests (e.g., OpenAI messages + Claude tools)
  if (targetFormat === FORMATS.OPENAI) {
    result = filterToOpenAIFormat(result, {
      preserveCacheControl: !!PROVIDERS[provider]?.quirks?.preserveCacheControl,
    });
  }

  // Final step: prepare request for Claude format endpoints
  if (targetFormat === FORMATS.CLAUDE) {
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    result = prepareClaudeRequest(result, provider, apiKey, connectionId, credentials?.rawHeaders, clientSessionId);
    if (Array.isArray(result?.messages)) result.messages = ensureTrailingUserTurn(result.messages, clientLastRole);
  }

  // Claude cloaking: rename client tools with CLAUDE_TOOL_SUFFIX (anti-ban)
  // quirk: only providers flagged cloakToolsOnOAuth, and only with an OAuth token
  if (PROVIDERS[provider]?.quirks?.cloakToolsOnOAuth) {
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    if (apiKey?.includes("sk-ant-oat")) {
      const { body: cloakedBody, toolNameMap } = cloakClaudeTools(result);
      result = cloakedBody;
      if (toolNameMap?.size > 0) {
        result._toolNameMap = toolNameMap;
      }
    }
  }

  // Antigravity cloaking disabled
  // if (provider === FORMATS.ANTIGRAVITY && body.userAgent !== FORMATS.ANTIGRAVITY) {
  //   const { cloakedBody, toolNameMap } = AntigravityExecutor.cloakTools(result);
  //   result = cloakedBody;
  //   if (toolNameMap?.size > 0) {
  //     result._toolNameMap = toolNameMap;
  //   }
  // }

  return result;
}

// Translate response chunk: target -> openai -> source
export function translateResponse(targetFormat, sourceFormat, chunk, state) {
  ensureInitialized();
  // If same format, return as-is — except the tool name may still be cloaked:
  // translateRequest() suffixes client tools for OAuth-cloaked Claude providers
  // even when no format conversion is needed, so streamed tool_use blocks must
  // be decloaked here or the client sees an unknown ("_ide"-suffixed) tool.
  if (sourceFormat === targetFormat) {
    // Same-format (openai→openai) passthrough: the upstream chunk reaches the
    // client as-is. A fragment that opens a new tool-call index without an id
    // aborts strict OpenAI-compatible clients (#4992) — mint/reuse one first.
    if (state && chunk && typeof chunk === "object") {
      if (!state.streamToolCallIds) state.streamToolCallIds = new Map();
      ensureStreamToolCallIds(chunk, state.streamToolCallIds);
    }
    return [restoreToolNames(decloakStreamChunk(chunk, state?.toolNameMap), state?.toolNameMap)];
  }

  let results = [chunk];
  let openaiResults = null; // Store OpenAI intermediate results

  // Direct route: if a response translator is registered for this exact
  // target:source pair, use it instead of pivoting through OpenAI. Mirrors the
  // request-side direct route (e.g. kiro:claude — KiroExecutor already emits
  // OpenAI-shaped chunks, so this converts them straight to Claude SSE).
  const directFn = REGS().response.get(`${targetFormat}:${sourceFormat}`);
  if (directFn) {
    const converted = directFn(chunk, state);
    const directResults = converted ? (Array.isArray(converted) ? converted : [converted]) : [];
    return restoreToolNames(directResults, state?.toolNameMap);
  }

  // Step 1: target -> openai (if target is not openai)
  if (targetFormat !== FORMATS.OPENAI) {
    const toOpenAI = REGS().response.get(`${targetFormat}:${FORMATS.OPENAI}`);
    if (toOpenAI) {
      results = [];
      const converted = toOpenAI(chunk, state);
      if (converted) {
        results = Array.isArray(converted) ? converted : [converted];
        openaiResults = results; // Store OpenAI intermediate
      }
    }
  }

  // Step 2: openai -> source (if source is not openai)
  if (sourceFormat !== FORMATS.OPENAI) {
    const fromOpenAI = REGS().response.get(`${FORMATS.OPENAI}:${sourceFormat}`);
    if (fromOpenAI) {
      const finalResults = [];
      for (const r of results) {
        const converted = fromOpenAI(r, state);
        if (converted) {
          finalResults.push(...(Array.isArray(converted) ? converted : [converted]));
        }
      }
      results = finalResults;
    }
  }

  results = restoreToolNames(results, state?.toolNameMap);

  // Attach OpenAI intermediate results for logging
  if (openaiResults && sourceFormat !== FORMATS.OPENAI && targetFormat !== FORMATS.OPENAI) {
    results._openaiIntermediate = openaiResults;
  }

  return results;
}

// Check if translation needed
export function needsTranslation(sourceFormat, targetFormat) {
  return sourceFormat !== targetFormat;
}

// Initialize state for streaming response based on format
export function initState(sourceFormat) {
  // Base state for all formats
  const base = {
    messageId: null,
    model: null,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    inThinkingBlock: false,
    currentBlockIndex: null,
    toolCalls: new Map(),
    // Tool-call ids already emitted to the client, keyed by tool-call index.
    // A fragment that opens a NEW index without an id breaks strict
    // OpenAI-compatible clients (#4992).
    streamToolCallIds: new Map(),
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    contentBlockIndex: -1
  };

  // Add openai-responses specific fields
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return {
      ...base,
      seq: 0,
      responseId: `resp_${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      started: false,
      msgTextBuf: {},
      msgItemAdded: {},
      msgContentAdded: {},
      msgItemDone: {},
      reasoningId: "",
      reasoningIndex: -1,
      reasoningBuf: "",
      reasoningPartAdded: false,
      reasoningDone: false,
      inThinking: false,
      funcArgsBuf: {},
      funcNames: {},
      funcCallIds: {},
      funcItemAdded: {},
      funcArgsDone: {},
      funcItemDone: {},
      customToolNames: new Set(),
      // Usage Chat Completions untuk response.completed. Bukan state.usage: translator
      // lain di pipeline yang sama menimpanya dengan bentuknya sendiri.
      responsesUsage: null,
      // finish_reason tiba sebelum usage; response.completed menunggu chunk usage.
      completionPending: false,
      completedSent: false
    };
  }

  return base;
}

// Kept for backward compatibility; translators are already registered at import time.
export function initTranslators() {
  ensureInitialized();
}

// ---------------------------------------------------------------------------
// Lazy-load translator.
//
// 24 modul translator TIDAK lagi diimpor statis di bawah file ini. Mereka
// dimuat on-demand lewat manifest di bawah (pola yang sama dengan lazy-load
// executor di open-sse/executors/index.js): dynamic import + cache + singleflight.
//
// Alasan desain:
// - translateRequest()/translateResponse() tetap SINKRON karena dipanggil di
//   hot path (per chunk SSE). Dynamic import tidak boleh terjadi per chunk.
// - Sebagai gantinya, setiap entry point async WAJIB memanggil
//   ensureTranslatorsForRequest(sourceFormat, targetFormat) (atau
//   ensureTranslatorsFor(daftarKunci, arah)) SEBELUM request diproses / stream
//   dibuat. Setelah itu registry terisi penuh dan fungsi translate sinkron
//   aman dipakai.
// - Modul translator aman di-load on-demand: audit 2026-09-29 menunjukkan
//   satu-satunya side-effect top-level adalah register() + deklarasi
//   fungsi/konstanta (tanpa timer, tanpa I/O, tanpa process.on, tanpa
//   top-level await). Circular import (modul → register() → index.js) tidak
//   deadlock karena register() hanya memakai assignment Map yang di-hoist
//   via `var` (lihat komentar registry di atas).
// ---------------------------------------------------------------------------

// Manifest pasangan format → file modul. Satu kunci bisa punya file request
// dan response yang BERBEDA (mis. "claude:openai": request/claude-to-openai.js
// untuk requestFn, response/claude-to-openai.js untuk responseFn).
// Satu entri per kunci "dari:ke" (tanpa duplikat).
const TRANSLATOR_MANIFEST = {
  "antigravity:openai": {
    request: "./request/antigravity-to-openai.js",
    response: "./response/gemini-to-openai.js",
  },
  "claude:kiro": { request: "./request/claude-to-kiro.js" },
  "claude:openai": {
    request: "./request/claude-to-openai.js",
    response: "./response/claude-to-openai.js",
  },
  "gemini:openai": {
    request: "./request/gemini-to-openai.js",
    response: "./response/gemini-to-openai.js",
  },
  "gemini-cli:openai": {
    request: "./request/gemini-to-openai.js",
    response: "./response/gemini-to-openai.js",
  },
  "vertex:openai": { response: "./response/gemini-to-openai.js" },
  "openai-responses:openai": {
    request: "./request/openai-responses.js",
    response: "./response/openai-responses.js",
  },
  "openai:openai-responses": {
    request: "./request/openai-responses.js",
    response: "./response/openai-responses.js",
  },
  "openai:claude": {
    request: "./request/openai-to-claude.js",
    response: "./response/openai-to-claude.js",
  },
  "openai:clova": { request: "./request/openai-to-clova.js" },
  "openai:commandcode": { request: "./request/openai-to-commandcode.js" },
  "openai:cursor": { request: "./request/openai-to-cursor.js" },
  "openai:gemini": { request: "./request/openai-to-gemini.js" },
  "openai:gemini-cli": { request: "./request/openai-to-gemini.js" },
  "openai:antigravity": {
    request: "./request/openai-to-gemini.js",
    response: "./response/openai-to-antigravity.js",
  },
  "openai:kiro": { request: "./request/openai-to-kiro.js" },
  "openai:ollama": { request: "./request/openai-to-ollama.js" },
  "openai:vertex": { request: "./request/openai-to-vertex.js" },
  "clova:openai": { response: "./response/clova-to-openai.js" },
  "commandcode:openai": { response: "./response/commandcode-to-openai.js" },
  "cursor:openai": { response: "./response/cursor-to-openai.js" },
  "kiro:claude": { response: "./response/kiro-to-claude.js" },
  "kiro:openai": { response: "./response/kiro-to-openai.js" },
  "ollama:openai": { response: "./response/ollama-to-openai.js" },
};

// Cari direktori translator/ di runtime (pola sama seperti executor):
// repo dev → .next/standalone → fallback lokasi file ini (untuk vitest).
function cariDirektoriTranslator() {
  const kandidat = [
    path.join(process.cwd(), "open-sse", "translator"),
    path.join(process.cwd(), ".next", "standalone", "open-sse", "translator"),
  ];
  try {
    const dariModul = path.dirname(fileURLToPath(import.meta.url));
    if (dariModul) kandidat.push(dariModul);
  } catch { /* abaikan: import.meta.url tidak selalu file URL */ }
  for (const dir of kandidat) {
    try {
      if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch { /* abaikan */ }
  }
  return kandidat[0];
}
const DIREKTORI_TRANSLATOR = cariDirektoriTranslator();

// Cache file yang sudah di-load + singleflight untuk import konkuren
// (pola sama seperti executors/index.js).
const fileSudahDiLoad = new Set();
const fileInFlight = new Map();

function imporModulTranslator(file) {
  const url = pathToFileURL(path.join(DIREKTORI_TRANSLATOR, file)).href;
  // webpackIgnore agar Next.js tidak mencoba me-resolve URL dinamis ini;
  // file translator ikut ter-copy ke standalone via outputFileTracingIncludes.
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

function muatFileTranslator(file) {
  if (fileSudahDiLoad.has(file)) return Promise.resolve();
  const berjalan = fileInFlight.get(file);
  if (berjalan) return berjalan;
  const p = imporModulTranslator(file).then(
    () => {
      fileSudahDiLoad.add(file);
      fileInFlight.delete(file);
    },
    (err) => {
      fileInFlight.delete(file);
      throw new Error(`[translator] Gagal me-load modul ${file}: ${err?.message || err}`);
    }
  );
  fileInFlight.set(file, p);
  return p;
}

function kunciSudahTerdaftar(kunci, arah) {
  const regs = REGS();
  const reg = arah === "response" ? regs.response : regs.request;
  return !!reg?.has(kunci);
}

/**
 * Pastikan translator untuk pasangan format tersedia di registry.
 * @param {string[]} daftarKunci - kunci registry "dari:ke", mis. ["openai:claude"].
 * @param {"request"|"response"|"both"} arah - arah translasi yang dibutuhkan.
 *
 * Kunci yang tidak ada di manifest diabaikan (pasangan tanpa translator =
 * passthrough, konsisten dengan perilaku translateRequest/translateResponse).
 * Kunci yang sudah terdaftar tidak di-load ulang. Gagal import = throw
 * (fail-loud) supaya tidak ada translasi yang diam-diam terlewat.
 */
export async function ensureTranslatorsFor(daftarKunci, arah = "both") {
  const files = new Set();
  for (const kunci of daftarKunci) {
    const entri = TRANSLATOR_MANIFEST[kunci];
    if (!entri) continue;
    if ((arah === "request" || arah === "both") && entri.request && !kunciSudahTerdaftar(kunci, "request")) {
      files.add(entri.request);
    }
    if ((arah === "response" || arah === "both") && entri.response && !kunciSudahTerdaftar(kunci, "response")) {
      files.add(entri.response);
    }
  }
  await Promise.all([...files].map(muatFileTranslator));
}

/**
 * Pastikan SEMUA translator yang mungkin dibutuhkan satu request chat
 * sudah ter-load: pasangan langsung + kedua kaki pivot via OpenAI untuk
 * request dan response. Panggil sekali di awal request (async) sebelum
 * translateRequest()/stream dibuat; setelah itu fungsi translate sinkron
 * aman dipakai di hot path.
 */
export async function ensureTranslatorsForRequest(sourceFormat, targetFormat) {
  const O = FORMATS.OPENAI;
  const OR = FORMATS.OPENAI_RESPONSES;
  const kunciRequest = [
    `${sourceFormat}:${targetFormat}`,
    `${sourceFormat}:${O}`,
    `${O}:${targetFormat}`,
  ];
  const kunciResponse = [
    `${targetFormat}:${sourceFormat}`,
    `${targetFormat}:${O}`,
    `${O}:${sourceFormat}`,
  ];
  // Jalur codex: provider Responses-API memakai pasangan openai-responses di
  // stream, dengan target akhir mengikuti CODEX_SOURCE_TO_TARGET di
  // handlers/chatCore/streamingHandler.js (claude/antigravity/openai-responses).
  if (sourceFormat === OR || targetFormat === OR) {
    kunciRequest.push(`${O}:${OR}`, `${OR}:${O}`);
    kunciResponse.push(`${OR}:${O}`, `${O}:${OR}`, `${O}:${FORMATS.CLAUDE}`, `${O}:${FORMATS.ANTIGRAVITY}`);
  }
  await Promise.all([
    ensureTranslatorsFor(kunciRequest, "request"),
    ensureTranslatorsFor(kunciResponse, "response"),
  ]);
}

/**
 * Cek apakah translator untuk pasangan format sudah terdaftar
 * (tanpa me-load apa pun). Berguna untuk test/diagnostik.
 */
export function isTranslatorLoaded(kunci, arah = "both") {
  if (arah === "request") return kunciSudahTerdaftar(kunci, "request");
  if (arah === "response") return kunciSudahTerdaftar(kunci, "response");
  return kunciSudahTerdaftar(kunci, "request") || kunciSudahTerdaftar(kunci, "response");
}
