/**
 * MuseSparkWebExecutor — ported from OmniRoute's open-sse/executors/muse-spark-web.ts
 * (branch release/v3.8.51, types stripped).
 *
 * Meta AI web chat protocol:
 *   1. GraphQL "warmup" persisted query initialises the conversation.
 *   2. GraphQL "mode switch" persisted query sets the reasoning level
 *      (think_fast / think_hard per model).
 *   3. The prompt is sent over wss://gateway.meta.ai/ws/clippy as a
 *      protobuf-inside-JSON frame (templates captured from Meta's web client,
 *      mutated per-conversation), and the binary WS frame stream is parsed
 *      into full/patch response events → OpenAI SSE chunks.
 *   4. A continuation cache reuses the meta.ai conversationId across turns so
 *      a multi-turn client session appears as one growing meta.ai conversation.
 *
 * Auth: cookie — the ecto_1_sess session cookie from meta.ai DevTools, plus
 * the ecto1:... WS auth token (Authorization query param on the clippy WS URL).
 *
 * Gaps vs OmniRoute:
 *   - The `ws` npm package is not installed in 9router, so the WebSocket uses
 *     Node's built-in global WebSocket (no custom Cookie/User-Agent headers
 *     on the upgrade) unless `ws` is installed — in which case it is picked up
 *     dynamically and headers are sent as in the source.
 *   - `getRotatingApiKey` is a local in-memory round-robin; OmniRoute's
 *     apiKeyRotator service is not present in 9router.
 *   - `normalizeSessionCookieHeader(s)` is ported from OmniRoute's
 *     src/lib/providers/webCookieAuth.ts into this file.
 *   - `prepareToolMessages`/`buildToolAwareResult` come from the sibling
 *     maxai/webTools.js port (same source: translator/webTools.ts), copied
 *     into muse-spark-web/webTools.js and imported relatively.
 */

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import { BaseExecutor } from "./base.js";
import { isRecord } from "./muse-spark-web/response-parser.js";
import { prepareToolMessages, buildToolAwareResult } from "./muse-spark-web/webTools.js";

const META_AI_GRAPHQL_API = "https://www.meta.ai/api/graphql";
// Meta rebranded "Abra" to "Ecto"; `abra_sess` became `ecto_1_sess`.
// `normalizeSessionCookieHeader` only uses this constant for bare values with no
// `name=` prefix; full cookie lines (with any cookie names) pass through
// untouched, so users who paste their entire DevTools cookie line still work.
const META_AI_DEFAULT_COOKIE = "ecto_1_sess";
// Persisted-query id and friendly name for the current send-message
// operation. The previous Abra mutation (doc_id 078dfdff...) was retired
// when Meta removed the RewriteOptionsInput type from the schema; it now
// fails server-side validation with `Unknown type "RewriteOptionsInput"`.
// The new operation is a Subscription rather than a Mutation, but Meta's
// GraphQL endpoint still accepts it over POST and streams the response.
const META_AI_WARMUP_DOC_ID = "e7f802582dbfed8e181b012e010993eb";
const META_AI_MODE_SWITCH_DOC_ID = "c32bbe999c48e64e855dc63177d5153f";
const META_WS_APP_ID = "1522763855472543";
const META_WS_APP_VERSION = "1.0.0";
const META_WS_AUTHTYPE = "15:0";
const META_WS_DGW_VERSION = "5";
const META_WS_DGW_UUID = "0";
const META_WS_TIER = "prod";
const META_WS_INTRO_FRAME_TYPE = 0x0f;
const META_WS_PROMPT_FRAME_TYPE = 0x0d;
const META_WS_PROMPT_FRAME_FLAG = 0x80;
const META_AI_ROOT_BRANCH_PATH = "0";
const META_AI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// ─── WebSocket constructor loader ────────────────────────────────────────────
// Prefer the `ws` npm package (supports custom upgrade headers, as the source
// uses). It is not installed in 9router, so fall back to Node's built-in
// global WebSocket, which cannot send custom headers on the handshake — the
// WS URL itself already carries the Authorization query param.

let WebSocketCtor = null; // test hook may override
let wsSupportsHeaders = false;
let wsCtorPromise = null;

async function loadWebSocketCtor() {
  if (WebSocketCtor) return { ctor: WebSocketCtor, supportsHeaders: wsSupportsHeaders };
  if (!wsCtorPromise) {
    wsCtorPromise = (async () => {
      try {
        const mod = await import("ws");
        return { ctor: mod.default || mod.WebSocket, supportsHeaders: true };
      } catch {
        return { ctor: globalThis.WebSocket, supportsHeaders: false };
      }
    })();
  }
  return wsCtorPromise;
}

export function __setMuseSparkWebSocketForTesting(ctor) {
  const previous = WebSocketCtor;
  WebSocketCtor = ctor;
  wsSupportsHeaders = false;
  return () => {
    WebSocketCtor = previous;
  };
}

/** Local error-message sanitizer (target's utils/error.js has no equivalent). */
function sanitizeErrorMessage(message) {
  const s = String(message ?? "");
  return s
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-jwt]")
    .slice(0, 500);
}

/** Apply model-level extra upstream headers (ported from OmniRoute's base/headers). */
function mergeUpstreamExtraHeaders(headers, extra) {
  if (!extra) return;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof k === "string" && k.length > 0 && typeof v === "string") {
      headers[k] = v;
    }
  }
}

// ─── Cookie helpers (ported from OmniRoute's src/lib/providers/webCookieAuth.ts) ─

function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

function parseJsonCookiesToHeader(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed || !trimmed.startsWith("[")) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return "";

  const parts = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid cookie JSON at index ${i}: expected an object`);
    }
    const record = entry;

    if (typeof record.name !== "string" || !record.name) {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'name'`);
    }
    if (typeof record.value !== "string") {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'value'`);
    }

    parts.push(`${record.name}=${record.value}`);
  }

  return parts.join("; ");
}

export function normalizeMetaAiCookieHeader(apiKey) {
  const stripped = stripCookieInputPrefix(apiKey);
  if (!stripped) return "";

  const jsonResult = parseJsonCookiesToHeader(stripped);
  if (jsonResult !== null) {
    return jsonResult;
  }

  if (stripped.includes("=")) {
    return stripped;
  }

  return `${META_AI_DEFAULT_COOKIE}=${stripped}`;
}

function normalizeMetaAiCookieHeaders(rawValues) {
  const seen = new Set();
  const normalizedHeaders = [];

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") continue;
    const normalized = normalizeMetaAiCookieHeader(rawValue);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedHeaders.push(normalized);
  }

  return normalizedHeaders;
}

// ─── API-key rotation (local stand-in for OmniRoute's apiKeyRotator service) ──

const apiKeyRotation = new Map();

function getRotatingApiKey(connectionId, primary, rest) {
  const pool = [primary, ...(rest || [])].filter(
    (v) => typeof v === "string" && v.length > 0
  );
  if (pool.length === 0) return "";
  if (!connectionId || pool.length === 1) return pool[0];
  const next = apiKeyRotation.get(connectionId) || 0;
  apiKeyRotation.set(connectionId, (next + 1) % pool.length);
  return pool[next % pool.length];
}

const MODEL_MAP = {
  "muse-spark": { mode: "think_fast", isThinking: false },
  "muse-spark-thinking": { mode: "think_hard", isThinking: true },
  "muse-spark-contemplating": { mode: "think_hard", isThinking: true },
};

function extractMessageText(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (part.type === "input_text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .trim();
}

function parseOpenAIMessages(messages) {
  const extracted = [];

  for (const message of messages) {
    let role = String(message.role || "user");
    if (role === "developer") role = "system";

    const content = extractMessageText(message.content);
    if (!content) continue;
    extracted.push({ role, content });
  }

  if (extracted.length === 0) {
    return {
      foldedPrompt: "",
      latestUserContent: "",
      lastAssistantIndex: -1,
      normalized: [],
    };
  }

  let lastUserIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  let lastAssistantIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  const foldedPrompt = extracted
    .map((message, index) => {
      if (index === lastUserIndex) {
        return message.content;
      }
      return `${message.role}: ${message.content}`;
    })
    .join("\n\n")
    .trim();

  const latestUserContent = lastUserIndex >= 0 ? extracted[lastUserIndex].content : "";

  return { foldedPrompt, latestUserContent, lastAssistantIndex, normalized: extracted };
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function encodeBase62(value, padLength) {
  let remaining = value;
  let encoded = "";

  while (remaining > 0n) {
    encoded = BASE62_ALPHABET[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  }

  return encoded.padStart(padLength, "0");
}

function decodeBase62(value) {
  let decoded = 0n;
  for (const char of value) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid base62 character: ${char}`);
    }
    decoded = decoded * 62n + BigInt(index);
  }
  return decoded;
}

function randomBigInt(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function generateMetaConversationId() {
  const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
  const random = randomBigInt(8) & ((1n << 64n) - 1n);
  const packed = (timestamp << 64n) | random;
  return `c.${encodeBase62(packed, 19)}`;
}

function generateMetaEventId(conversationId) {
  if (!conversationId.startsWith("c.")) {
    return null;
  }

  try {
    const packedConversation = decodeBase62(conversationId.slice(2));
    const conversationRandom = packedConversation & ((1n << 64n) - 1n);
    const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
    const eventRandom = randomBigInt(4) & ((1n << 32n) - 1n);
    const packedEvent = (timestamp << (64n + 32n)) | (conversationRandom << 32n) | eventRandom;
    return `e.${encodeBase62(packedEvent, 25)}`;
  } catch {
    return null;
  }
}

function generateNumericMessageId() {
  return (
    BigInt(Date.now()) * 1000n +
    BigInt(Math.floor(Math.random() * 1000)) +
    (randomBigInt(2) & 0xfffn)
  ).toString();
}

function normalizeMetaLocale() {
  const locale =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
      : "en-US";
  return locale.replace(/-/g, "_");
}

function getMuseSparkModelInfo(model) {
  return MODEL_MAP[model] || MODEL_MAP["muse-spark"];
}
// ─── Conversation continuity cache ──────────────────────────────────────────
// The default behavior of /v1/chat/completions is stateless: the caller passes
// the full message history each turn. Without continuation, every turn would
// open a brand-new meta.ai conversation containing the OpenAI history folded
// into a single user prompt — three real chat turns become three separate
// conversations in the user's meta.ai history, each polluted with the prior
// turns rendered as "user: …" / "assistant: …" text.
//
// To present a clean single growing conversation in meta.ai, we cache the
// conversationId we created on the previous turn keyed by a hash of the
// (connectionId, model, normalized history through the last assistant turn).
// On the next turn, if the incoming OpenAI history's prefix-up-to-the-last-
// assistant-turn matches a cached entry, we reuse the cached conversationId,
// set isNewConversation=false, and send only the latest user turn — Meta
// appends to the existing conversation tree.
//
// Hashing the *full prefix* (not just the assistant text) is important: two
// independent chats from the same connection that happen to land on identical
// assistant text (e.g. a generic refusal or greeting) would otherwise collide
// and route the next turn into the wrong meta.ai conversation, mixing chat
// state across logical sessions. The differing preceding history makes the
// hashes distinct.
//
// TTL is 30 minutes (Meta's web client also expires idle conversations on a
// similar window). Cache cap is generous — entries are tiny (~250 B) so 5000
// entries is ~1.25 MB, plenty of headroom for multi-user setups.

const MUSE_CONV_CACHE_MAX = 5000;
const MUSE_CONV_CACHE_TTL_MS = 30 * 60 * 1000;
const conversationCache = new Map();

/**
 * Canonical-stringify a normalized message list so the same logical history
 * always produces the same hash. Uses ASCII Group Separator / Record
 * Separator characters as field delimiters so they can't appear inside
 * normal message content.
 */
function canonicalizeNormalizedHistory(messages) {
  return messages.map((m) => `${m.role}\x1e${m.content}`).join("\x1f");
}

function makeConversationCacheKey(connectionId, model, normalizedPrefix) {
  return createHash("sha256")
    .update(`${connectionId}\x1f${model}\x1f${canonicalizeNormalizedHistory(normalizedPrefix)}`)
    .digest("hex");
}

function lookupCachedConversation(key) {
  const entry = conversationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    conversationCache.delete(key);
    return null;
  }
  return entry;
}

function rememberConversation(key, context) {
  if (conversationCache.size >= MUSE_CONV_CACHE_MAX && !conversationCache.has(key)) {
    // Map iteration is insertion order, so the first key is the oldest.
    const oldest = conversationCache.keys().next().value;
    if (oldest) conversationCache.delete(oldest);
  }
  conversationCache.set(key, {
    conversationId: context.conversationId,
    branchPath: context.branchPath,
    expiresAt: Date.now() + MUSE_CONV_CACHE_TTL_MS,
  });
}

/** Test hook — exported for unit tests; not wired to runtime callers. */
export function __resetMuseSparkConversationCacheForTesting() {
  conversationCache.clear();
}

function buildMetaAiRequestBody(prompt, model, conversation) {
  const userUniqueMessageId = generateNumericMessageId();

  return {
    doc_id: META_AI_WARMUP_DOC_ID,
    variables: {
      assistantMessageId: crypto.randomUUID(),
      // `attachments` was removed from Meta's GraphQL schema (the
      // AttachmentInput type is gone), so sending it — even as null —
      // makes the server reject the persisted query with
      // `Unknown type "AttachmentInput"`. Omit it entirely; GraphQL
      // input fields are nullable-by-omission by default.
      clientLatitude: null,
      clientLongitude: null,
      clientTimezone:
        typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
      clippyIp: null,
      content: prompt,
      conversationId: conversation.conversationId,
      conversationStarterId: null,
      currentBranchPath: conversation.branchPath,
      developerOverridesForMessage: null,
      devicePixelRatio: 1,
      entryPoint: "KADABRA__CHAT__UNIFIED_INPUT_BAR",
      imagineOperationRequest: null,
      isNewConversation: conversation.isNewConversation,
      mentions: null,
      mode: getMuseSparkModelInfo(model).mode,
      promptEditType: null,
      promptSessionId: crypto.randomUUID(),
      promptType: null,
      qplJoinId: null,
      requestedToolCall: null,
      // `rewriteOptions` was removed from Meta's GraphQL schema (the
      // RewriteOptionsInput type is gone), so sending it — even as null —
      // makes the server reject the persisted query with
      // `Unknown type "RewriteOptionsInput"`. Omit it entirely; GraphQL
      // input fields are nullable-by-omission by default.
      turnId: crypto.randomUUID(),
      userAgent: META_AI_USER_AGENT,
      userEventId: generateMetaEventId(conversation.conversationId),
      userLocale: normalizeMetaLocale(),
      userMessageId: crypto.randomUUID(),
      userUniqueMessageId,
    },
  };
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildStreamingResponse(deltas, reasoningDeltas, model, id, created) {
  const encoder = new TextEncoder();

  return new ReadableStream(
    {
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant" },
                  finish_reason: null,
                  logprobs: null,
                },
              ],
            })
          )
        );

        for (const delta of reasoningDeltas) {
          if (!delta) continue;
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: delta },
                    finish_reason: null,
                    logprobs: null,
                  },
                ],
              })
            )
          );
        }

        for (const delta of deltas) {
          if (!delta) continue;
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  {
                    index: 0,
                    delta: { content: delta },
                    finish_reason: null,
                    logprobs: null,
                  },
                ],
              })
            )
          );
        }

        controller.enqueue(
          encoder.encode(
            sseChunk({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    },
    { highWaterMark: 16384 }
  );
}

function buildNonStreamingResponse(content, reasoningContent, model, id, created) {
  const completionTokens = estimateTokens(content);
  const message = { role: "assistant", content };
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }

  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          message,
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: completionTokens,
        completion_tokens: completionTokens,
        total_tokens: completionTokens * 2,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function buildErrorResponse(status, message, code) {
  return new Response(
    JSON.stringify({
      error: {
        message: sanitizeErrorMessage(message),
        type: "upstream_error",
        ...(code ? { code } : {}),
      },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function selectMetaAiCookieHeader(credentials) {
  const extraCookieValues = Array.isArray(credentials.providerSpecificData?.extraApiKeys)
    ? credentials.providerSpecificData.extraApiKeys.filter(
        (value) => typeof value === "string" && value.trim().length > 0
      )
    : [];

  const normalizedPool = normalizeMetaAiCookieHeaders(
    [credentials.apiKey || "", ...extraCookieValues]
  );

  if (normalizedPool.length === 0) {
    return "";
  }

  if (normalizedPool.length === 1 || !credentials.connectionId) {
    return normalizedPool[0];
  }

  return getRotatingApiKey(credentials.connectionId, normalizedPool[0], normalizedPool.slice(1));
}

function buildMetaAiHeaders(cookieHeader) {
  return {
    Accept: "text/event-stream",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    Origin: "https://www.meta.ai",
    Referer: "https://www.meta.ai/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": META_AI_USER_AGENT,
    "X-ASBD-ID": "129477",
    "X-FB-Friendly-Name": "useEctoSendMessageSubscription",
    "X-FB-Request-Analytics-Tags": "graphservice",
  };
}

function resultWithResponse(response, headers, transformedBody) {
  return {
    response,
    url: META_AI_GRAPHQL_API,
    headers,
    transformedBody,
  };
}

function errorResult(status, message, code, headers, transformedBody) {
  return resultWithResponse(buildErrorResponse(status, message, code), headers, transformedBody);
}

function getOpenAiMessages(body) {
  const messages = body.messages;
  if (!messages || !Array.isArray(messages) || messages.length === 0) return null;
  return messages;
}

// ─── Protobuf WS templates ──────────────────────────────────────────────────────
// Base64-encoded protobuf templates captured from Meta AI web client.
// These are mutated at specific field paths to inject conversation-id,
// prompt text, timestamps, and message IDs per conversation.
//
// VERIFIED against live meta.ai WS captures from TWO independent accounts
// (2026-07-19). The following fields are confirmed STATIC (app-level
// constants sent by Meta's own client, not per-user secrets):
//   - 64-hex session token (e2b88f98...)
//   - Actor numeric ID (867051314767696)
//   - Locale (en-US)
//   - App ID (1522763855472543)
// The only user-variable field is the timezone (system TZ), which is
// low-signal for anti-fraud. No fingerprint randomization is warranted.

const META_WS_HOME_TEMPLATE_B64 =
  "CrYGCsQDCiBLQURBQlJBX19IT01FX19VTklGSUVEX0lOUFVUX0JBUhIQMTUyMjc2Mzg1NTQ3MjU0MyInNWE1Yi04ZDRlLWYwNTQtOTllZi1iMmRlLWRiMDItMGQwNS01MmM3KigqJgokOGYxMjliMjUtYzNlMC00NzNiLWFlNzktNWViM2YyNGU1NjRjMAU6C0hVTUFOX0FHRU5UQiIKDzg2NzA1MTMxNDc2NzY5NhIPODY3MDUxMzE0NzY3Njk2UgVFQ1RPMVoRQWJyYSBXZWIgTWFpbiBLZXliCRoDCOgHIgIIAWoITWFjIE9TIFhyCnVzZXJfaW5wdXR6dU1vemlsbGEvNS4wIChNYWNpbnRvc2g7IEludGVsIE1hYyBPUyBYIDEwXzE1XzcpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDYuMC4wLjAgU2FmYXJpLzUzNy4zNoIBC2Rlc2t0b3Bfd2VimgFHCkBlMmI4OGY5ODQ2Mzc5Y2JjMjY5NjBmYTNhZTFkMjIyMDFkZmIxOWRmNzg5MGFlNmEzYWM4YTI4ODcwYmFjNjgyFQAAAEASFAi4w6XTk4/yARC4w6XTk4/yARgCGgIgASIAKg4Ix6D+ldkzGJ6g/pXZMzIkZWU3YTM1ZWItZGY4Yy00NzkzLWExYzAtMTBhZTQxNGY1ZTZlOgBKBxIFZW4tVVNScgokNTYwN2Y0YzAtYjljZi00ZjZlLWJlYTYtZTc2N2E1OGJhMjhlGiRlMDliN2FhMC1jYzYwLTQyYTktYjk2OS00YzY1YjViZGZlNGIiJDhmMTI5YjI1LWMzZTAtNDczYi1hZTc5LTVlYjNmMjRlNTY0Y3oRIg9BbWVyaWNhL0NoaWNhZ2+CAQOwAQGSAQwKBnN0b2NrcxICCAGSAQ0KB3dlYXRoZXISAggBkgEkCh5tZXRhX2tub3dsZWRnZV9zZWFyY2hfY2Fyb3VzZWwSAggBkgEiChxtZXRhX2NhdGFsb2dfc2VhcmNoX2Nhcm91c2VsEgIIAZIBEwoNbWVkaWFfZ2FsbGVyeRICCAGiAQEDEpIBCmEKJGFiOWRkNzg5LWRlOGQtNDc5MS05ODE1LWI5YjBmMTU1MDdiNBI3CiQ4ZjEyOWIyNS1jM2UwLTQ3M2ItYWU3OS01ZWIzZjI0ZTU2NGMQyKD+ldkzGKbcxozB/KuyZygBEihIZWxsbyB0aGlzIGlzIGFub3RoZXIgdGVzdCBvZiB5b3VyIHBvd2VyIgMKATA=";
const META_WS_CHAT_TEMPLATE_B64 =
  "CrIGCsADCiBLQURBQlJBX19DSEFUX19VTklGSUVEX0lOUFVUX0JBUhIQMTUyMjc2Mzg1NTQ3MjU0MyInNWE1Yi04ZDRlLWYwNTQtOTllZi1iMmRlLWRiMDItMGQwNS01MmM3KigqJgokYjA4Mzg1YTYtNWE1My00ZjE0LTk2NmUtMzQ3ZjI4MDg4NDU0MAU6C0hVTUFOX0FHRU5UQiIKDzg2NzA1MTMxNDc2NzY5NhIPODY3MDUxMzE0NzY3Njk2UgVFQ1RPMVoRQWJyYSBXZWIgTWFpbiBLZXliBRoDCOgHaghNYWMgT1MgWHIKdXNlcl9pbnB1dHp1TW96aWxsYS81LjAgKE1hY2ludG9zaDsgSW50ZWwgTWFjIE9TIFggMTBfMTVfNykgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0Ni4wLjAuMCBTYWZhcmkvNTM3LjM2ggELZGVza3RvcF93ZWKaAUcKQGUyYjg4Zjk4NDYzNzljYmMyNjk2MGZhM2FlMWQyMjIwMWRmYjE5ZGY3ODkwYWU2YTNhYzhhMjg4NzBiYWM2ODIVAAAAQBIUCLjDpdOTj/IBELjDpdOTj/IBGAIaAiABIgAqDgikgvuW2TMYoYL7ltkzMiRjNmI1ZDI2MS02NjI0LTQ5YWYtOTBjNy0wOWI0NWMwYTZiZWY6AEoHEgVlbi1VU1JyCiQxZDNjZGQzYy1jYTFhLTRlMDItODk1My1kZTBiYTM0NzI5ODkaJDcxODNhMzM0LTFiNWEtNGQyNi1iMjcxLWJjY2Y1NDY2NmJiZiIkYjA4Mzg1YTYtNWE1My00ZjE0LTk2NmUtMzQ3ZjI4MDg4NDU0ehEiD0FtZXJpY2EvQ2hpY2Fnb4IBA7ABAZIBDAoGc3RvY2tzEgIIAZIBDQoHd2VhdGhlchICCAGSASQKHm1ldGFfa25vd2xlZGdlX3NlYXJjaF9jYXJvdXNlbBICCAGSASIKHG1ldGFfY2F0YWxvZ19zZWFyY2hfY2Fyb3VzZWwSAggBkgETCg1tZWRpYV9nYWxsZXJ5EgIIAaIBAQMSlgEKfAokMTc4MDVmYjEtOTY3Zi00YmYyLTlmMjctOWRhYmRhMzYyMTJkEjcKJGIwODM4NWE2LTVhNTMtNGYxNC05NjZlLTM0N2YyODA4ODQ1NBCkgvuW2TMYxN23xoT2rbJnIhtlLjAwcHlKMUtxa3BHTmg5Sk9oWElNdnJRWlYSEWZvbGxvdyB1cCBwcm9iZSAyIgMKATI=";

// ─── Proto helpers ─────────────────────────────────────────────────────────────

function encodeVarint(value) {
  // Use BigInt arithmetic to avoid 32-bit truncation from bitwise operators.
  let v = BigInt(value);
  const out = [];
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v & 0x7fn));
  return new Uint8Array(out);
}

function decodeVarint(data, offset) {
  let shift = 0;
  let value = 0;
  let off = offset;
  while (true) {
    const byte = data[off++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value >>> 0, off];
    shift += 7;
    if (shift > 63) throw new Error("Varint too long");
  }
}

function parseProtoFields(data) {
  const fields = [];
  let offset = 0;
  while (offset < data.length) {
    const [tag, next] = decodeVarint(data, offset);
    offset = next;
    const number = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      const [value, n] = decodeVarint(data, offset);
      offset = n;
      fields.push({ number, wireType, value });
    } else if (wireType === 1) {
      const view = new DataView(data.buffer, data.byteOffset + offset, 8);
      fields.push({ number, wireType, value: view.getBigUint64(0, true) });
      offset += 8;
    } else if (wireType === 2) {
      const [len, n] = decodeVarint(data, offset);
      offset = n;
      fields.push({ number, wireType, value: data.slice(offset, offset + len) });
      offset += len;
    } else if (wireType === 5) {
      const view = new DataView(data.buffer, data.byteOffset + offset, 4);
      fields.push({ number, wireType, value: view.getUint32(0, true) });
      offset += 4;
    } else {
      throw new Error(`Unsupported wire type: ${wireType}`);
    }
  }
  return fields;
}

function serializeProtoFields(fields) {
  const parts = [];
  for (const f of fields) {
    const tag = (f.number << 3) | f.wireType;
    parts.push(encodeVarint(tag));
    if (f.wireType === 0) {
      parts.push(encodeVarint(Number(f.value)));
    } else if (f.wireType === 1) {
      const buf = new Uint8Array(8);
      if (f.value instanceof Uint8Array) {
        throw new Error(
          `serializeProtoFields: wire type 1 field ${f.number} has non-numeric value`
        );
      }
      new DataView(buf.buffer).setBigUint64(0, BigInt(f.value), true);
      parts.push(buf);
    } else if (f.wireType === 2) {
      const raw =
        f.value instanceof Uint8Array ? f.value : new TextEncoder().encode(String(f.value));
      parts.push(encodeVarint(raw.length));
      parts.push(raw);
    } else if (f.wireType === 5) {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, Number(f.value), true);
      parts.push(buf);
    }
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

function findProtoField(fields, number) {
  return fields.find((f) => f.number === number);
}

function traverseAndMutate(fields, path, mutator) {
  if (path.length === 0) return false;
  const field = findProtoField(fields, path[0]);
  if (!field || !(field.value instanceof Uint8Array)) return false;
  if (path.length === 1) {
    mutator(field);
    return true;
  }
  const nested = parseProtoFields(field.value);
  if (traverseAndMutate(nested, path.slice(1), mutator)) {
    field.value = serializeProtoFields(nested);
    return true;
  }
  return false;
}

// ─── WS frame builders ─────────────────────────────────────────────────────────

function writeU24Le(value, arr, offset) {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
}

function buildWsIntroFrame(conversationId) {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      "x-dgw-app-x-ecto-conversation-id": conversationId,
      "x-dgw-app-client-payload-type": "PROTO_INSIDE_JSON",
    })
  );
  const header = new Uint8Array(6);
  header[0] = META_WS_INTRO_FRAME_TYPE;
  header[1] = 0;
  header[2] = 0;
  writeU24Le(payload.length, header, 3);
  const result = new Uint8Array(header.length + payload.length);
  result.set(header);
  result.set(payload, header.length);
  return result;
}

function buildWsPromptFrame(prompt, conversationId, opts) {
  const requestId = opts.requestId || crypto.randomUUID();
  const userMessageId = opts.userMessageId || crypto.randomUUID();
  const submittedMs = opts.submittedMs ?? Date.now();
  const uniqueMessageId =
    opts.uniqueMessageId ??
    Number(`${submittedMs}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`);

  const raw = Buffer.from(opts.templateB64, "base64");
  const protoFields = parseProtoFields(raw);

  // Patch conversationId at [1,1,5]
  traverseAndMutate(protoFields, [1, 1], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field5 = findProtoField(nested, 5);
    if (field5) field5.value = new TextEncoder().encode(conversationId);
    f.value = serializeProtoFields(nested);
  });
  // Patch userMessageId at [2,1,1]
  traverseAndMutate(protoFields, [2, 1], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field1 = findProtoField(nested, 1);
    if (field1) field1.value = new TextEncoder().encode(userMessageId);
    f.value = serializeProtoFields(nested);
  });
  // Patch convId + timestamps at [2,1,2]
  traverseAndMutate(protoFields, [2, 1, 2], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const f1 = findProtoField(nested, 1);
    const f2 = findProtoField(nested, 2);
    const f3 = findProtoField(nested, 3);
    if (f1) f1.value = new TextEncoder().encode(conversationId);
    if (f2) f2.value = submittedMs;
    if (f3) f3.value = uniqueMessageId;
    f.value = serializeProtoFields(nested);
  });
  // Patch prompt text at [2,2]
  traverseAndMutate(protoFields, [2], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field2 = findProtoField(nested, 2);
    if (field2) field2.value = new TextEncoder().encode(prompt);
    f.value = serializeProtoFields(nested);
  });
  // Patch timestamps at [1,5]
  traverseAndMutate(protoFields, [1, 5], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const f1 = findProtoField(nested, 1);
    const f3 = findProtoField(nested, 3);
    if (f1) f1.value = submittedMs + 1;
    if (f3) f3.value = submittedMs;
    f.value = serializeProtoFields(nested);
  });
  // Patch requestId at [1,6]
  traverseAndMutate(protoFields, [1], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field6 = findProtoField(nested, 6);
    if (field6) field6.value = new TextEncoder().encode(requestId);
    f.value = serializeProtoFields(nested);
  });
  // Patch conversationId at [1,10,4]
  traverseAndMutate(protoFields, [1, 10], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field4 = findProtoField(nested, 4);
    if (field4) field4.value = new TextEncoder().encode(conversationId);
    f.value = serializeProtoFields(nested);
  });

  const updatedB64 = Buffer.from(serializeProtoFields(protoFields)).toString("base64");
  const outer = JSON.stringify({ "req-id": requestId, payload: updatedB64 });
  const inner = new TextEncoder().encode(outer);
  const subSessionIdx = opts.subSessionIdx || 0;
  const messageSeq = opts.messageSeq || 0;

  const msgBody = new Uint8Array(2 + inner.length);
  msgBody[0] = messageSeq;
  msgBody[1] = META_WS_PROMPT_FRAME_FLAG;
  msgBody.set(inner, 2);

  const header = new Uint8Array(6);
  header[0] = META_WS_PROMPT_FRAME_TYPE;
  header[1] = subSessionIdx & 0xff;
  header[2] = (subSessionIdx >> 8) & 0xff;
  writeU24Le(msgBody.length, header, 3);

  const frame = new Uint8Array(header.length + msgBody.length);
  frame.set(header);
  frame.set(msgBody, header.length);
  return frame;
}

// ─── WS URL builder + GraphQL helper + b64 helpers ─────────────────────────────

function buildWsUrl(authorization, requestId) {
  const params = new URLSearchParams({
    "x-dgw-appid": META_WS_APP_ID,
    "x-dgw-appversion": META_WS_APP_VERSION,
    "x-dgw-authtype": META_WS_AUTHTYPE,
    "x-dgw-version": META_WS_DGW_VERSION,
    "x-dgw-uuid": META_WS_DGW_UUID,
    "x-dgw-tier": META_WS_TIER,
    Authorization: authorization,
    "x-dgw-app-origin": "meta.ai",
    "x-dgw-app-clippy-request-id": requestId,
    "x-dgw-app-clippy-async": "true",
  });
  return `wss://gateway.meta.ai/ws/clippy?${params.toString()}`;
}

async function graphqlPost(docId, variables, cookieHeader, label, signal) {
  try {
    const response = await fetch(META_AI_GRAPHQL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "multipart/mixed, application/json",
        Cookie: cookieHeader,
        "User-Agent": META_AI_USER_AGENT,
        Origin: "https://meta.ai",
      },
      body: JSON.stringify({ doc_id: docId, variables }),
      signal: signal ?? undefined,
    });
    if (!response.ok) return { ok: false, error: `${label} failed: HTTP ${response.status}` };
    // GraphQL often returns errors in the body with HTTP 200 — parse them.
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        const msg = json.errors[0]?.message || "Unknown GraphQL error";
        return { ok: false, error: `${label} failed: ${msg}` };
      }
    } catch {
      // Response wasn't JSON or had no errors — treat as success.
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `${label} fetch failed: ${sanitizeErrorMessage(
        err instanceof Error ? err.message : String(err)
      )}`,
    };
  }
}

// ─── WS response parser ────────────────────────────────────────────────────────

function parseWsResponseEvents(payload) {
  const events = [];
  let start = null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i];
    if (start === null) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== null) {
        try {
          events.push(JSON.parse(payload.slice(start, i + 1)));
        } catch {
          /* skip */
        }
        start = null;
      }
    }
  }
  return events;
}

async function wsChat(prompt, conversationId, authorization, cookieHeader, templateB64, signal) {
  const requestId = crypto.randomUUID();
  const wsUrl = buildWsUrl(authorization, requestId);
  const { ctor: WsCtor, supportsHeaders } = await loadWebSocketCtor();

  return new Promise((resolve) => {
    const ws = supportsHeaders
      ? new WsCtor(wsUrl, {
          headers: {
            Cookie: cookieHeader,
            "User-Agent": META_AI_USER_AGENT,
            Origin: "https://meta.ai",
          },
        })
      : new WsCtor(wsUrl);
    // Node's built-in WebSocket delivers binary frames as Blob by default;
    // the parser below expects bytes — ask for ArrayBuffer instead.
    try {
      ws.binaryType = "arraybuffer";
    } catch {
      /* ws package ignores this */
    }
    let settled = false;
    let accumulatedText = "";
    const contentDeltas = [];
    let timeout = null;
    let abortHandler = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const fail = (error) => finish({ content: "", deltas: [], error });

    timeout = setTimeout(() => fail(`Meta AI WS timed out (readyState=${ws.readyState})`), 30000);
    abortHandler = () => fail("Request aborted");
    signal?.addEventListener("abort", abortHandler, { once: true });

    ws.onopen = () => {
      ws.send(buildWsIntroFrame(conversationId));
      ws.send(buildWsPromptFrame(prompt, conversationId, { templateB64, requestId }));
    };

    ws.onmessage = async (event) => {
      let raw = "";
      const data = event.data;
      if (typeof data === "string") {
        raw = data;
      } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
        raw = data.toString("utf-8");
      } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        raw = new TextDecoder().decode(data);
      } else if (data && typeof data.text === "function") {
        // WHATWG Blob fallback
        try {
          raw = await data.text();
        } catch {
          /* ignore */
        }
      }
      if (!raw) return;
      const events = parseWsResponseEvents(raw);
      for (const evt of events) {
        if (evt.type === "full") {
          const sections = evt.response?.sections || [];
          for (const section of sections) {
            const text = section?.view_model?.primitive?.text || "";
            if (text && text !== accumulatedText) {
              const delta = accumulatedText ? text.slice(accumulatedText.length) || text : text;
              if (delta) contentDeltas.push(delta);
              accumulatedText = text;
            }
          }
        } else if (evt.type === "patch") {
          const operations = evt.operations || [];
          for (const op of operations) {
            if (
              op.op === "delta" &&
              op.path === "/sections/0/view_model/primitive/text" &&
              typeof op.value === "string"
            ) {
              contentDeltas.push(op.value);
              accumulatedText += op.value;
            }
          }
        }
      }
    };

    ws.onerror = () => fail("Meta AI WebSocket connection error");
    ws.onclose = () => {
      if (settled) return;
      finish({ content: accumulatedText, deltas: contentDeltas });
    };
  });
}

function getContinuationCacheKey(parsedHistory, credentials, model) {
  if (
    parsedHistory.lastAssistantIndex < 0 ||
    !credentials.connectionId ||
    parsedHistory.latestUserContent.length === 0
  ) {
    return null;
  }

  return makeConversationCacheKey(
    credentials.connectionId,
    model,
    parsedHistory.normalized.slice(0, parsedHistory.lastAssistantIndex + 1)
  );
}

function getConversationContext(cached) {
  if (!cached) {
    return {
      conversationId: generateMetaConversationId(),
      branchPath: META_AI_ROOT_BRANCH_PATH,
      isNewConversation: true,
    };
  }

  return {
    conversationId: cached.conversationId,
    branchPath: cached.branchPath,
    isNewConversation: false,
  };
}

function evictContinuationIfNeeded(cached, cacheKey) {
  if (cached && cacheKey) {
    conversationCache.delete(cacheKey);
  }
}

function rememberAssistantTurn(parsed, credentials, model, parsedHistory, conversationContext) {
  if (!parsed.content || !credentials.connectionId) return;

  const writePrefix = [
    ...parsedHistory.normalized,
    { role: "assistant", content: parsed.content },
  ];
  rememberConversation(makeConversationCacheKey(credentials.connectionId, model, writePrefix), {
    conversationId: conversationContext.conversationId,
    branchPath: conversationContext.branchPath,
  });
}

async function buildSuccessResult(parsed, stream, model, headers, transformedBody, hasTools, requestedTools) {
  const id = `chatcmpl-meta-${crypto.randomUUID().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);
  const deltas = parsed.deltas.length > 0 ? parsed.deltas : [parsed.content];
  const reasoningDeltas = parsed.reasoningDeltas;
  let response = stream
    ? new Response(buildStreamingResponse(deltas, reasoningDeltas, model, id, created), {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      })
    : buildNonStreamingResponse(parsed.content, parsed.reasoningContent, model, id, created);

  if (hasTools && !stream) {
    const bodyText = await response.text();
    try {
      const json = JSON.parse(bodyText);
      const rawContent = json?.choices?.[0]?.message?.content || "";
      const { content, toolCalls, finishReason } = buildToolAwareResult(
        rawContent,
        requestedTools,
        "muse"
      );
      if (toolCalls) {
        json.choices[0].message = { role: "assistant", content: null, tool_calls: toolCalls };
        json.choices[0].finish_reason = finishReason;
      } else {
        json.choices[0].message.content = content;
      }
      response = new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      /* keep original response */
    }
  }

  return resultWithResponse(response, headers, transformedBody);
}

export class MuseSparkWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-spark-web", { id: "muse-spark-web", baseUrl: META_AI_GRAPHQL_API });
  }

  async execute({ model, body, stream, credentials, signal, log, upstreamExtraHeaders }) {
    const bodyObj = body || {};
    const rawMessages = getOpenAiMessages(body);
    if (!rawMessages) {
      return errorResult(400, "Missing or empty messages array", "invalid_request", {}, body);
    }

    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(
      bodyObj,
      rawMessages
    );
    const parsedHistory = parseOpenAIMessages(effectiveMessages);
    if (!parsedHistory.foldedPrompt) {
      return errorResult(400, "Empty query after processing messages", "invalid_request", {}, body);
    }

    // Extract the WebSocket auth token (ecto1:...) from provider-specific data
    // or from the apiKey field itself (user can paste both in the cookie field).
    let authorization;
    if (
      typeof credentials.providerSpecificData?.authorization === "string" &&
      credentials.providerSpecificData.authorization
    ) {
      authorization = credentials.providerSpecificData.authorization.trim();
    } else if (typeof credentials.apiKey === "string") {
      const match = credentials.apiKey.match(/ecto1:[^\s;]+/i);
      authorization = match ? match[0].trim() : "";
    } else {
      authorization = "";
    }
    if (!authorization) {
      return errorResult(
        400,
        "Missing Authorization for Meta AI WebSocket — paste the ecto1:... WS auth token from meta.ai DevTools (Network → WS → clippy request Authorization param), alongside your ecto_1_sess cookie.",
        "missing_authorization",
        {},
        body
      );
    }

    // Look up a prior meta.ai conversation we created for this caller +
    // model + chat thread. The lookup key is the connection + model + the
    // SHA-256 of the normalized history prefix ending at the last assistant
    // turn — that prefix is exactly what we hashed when we cached on the
    // previous turn, so a real continuation hits and two parallel chats
    // with coincidentally-identical assistant text do not.
    //
    // We also require `latestUserContent` to be non-empty before using a
    // cached entry: if the incoming history has no `user` role (e.g. an
    // assistant-prefill payload), the cache-hit path would otherwise POST
    // empty content with `isNewConversation: false`, an avoidable upstream
    // failure. Falling through to the fresh-conversation path uses the
    // folded history instead, which contains real content.
    const continuationCacheKey = getContinuationCacheKey(parsedHistory, credentials, model);
    const cached = continuationCacheKey ? lookupCachedConversation(continuationCacheKey) : null;
    const conversationContext = getConversationContext(cached);

    const prompt = cached ? parsedHistory.latestUserContent : parsedHistory.foldedPrompt;
    const cookieHeader = selectMetaAiCookieHeader(credentials);
    const modelInfo = getMuseSparkModelInfo(model);
    const templateB64 = cached ? META_WS_CHAT_TEMPLATE_B64 : META_WS_HOME_TEMPLATE_B64;

    // Step 1: GraphQL warmup initialises the conversation on Meta's side
    const warmupResult = await graphqlPost(
      META_AI_WARMUP_DOC_ID,
      { conversationId: conversationContext.conversationId },
      cookieHeader,
      "Warmup",
      signal
    );
    if (!warmupResult.ok) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", `Warmup failed: ${warmupResult.error}`);
      return errorResult(502, warmupResult.error, "meta_ai_warmup_failed", {}, body);
    }

    // Step 2: GraphQL mode switch sets the conversation's reasoning level
    const modeResult = await graphqlPost(
      META_AI_MODE_SWITCH_DOC_ID,
      { input: { conversationId: conversationContext.conversationId, mode: modelInfo.mode } },
      cookieHeader,
      "Mode switch",
      signal
    );
    if (!modeResult.ok) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", `Mode switch failed: ${modeResult.error}`);
      return errorResult(502, modeResult.error, "meta_ai_mode_switch_failed", {}, body);
    }

    // Step 3: Send message via WebSocket
    const wsResult = await wsChat(
      prompt,
      conversationContext.conversationId,
      authorization,
      cookieHeader,
      templateB64,
      signal
    );

    const headers = buildMetaAiHeaders(cookieHeader);
    mergeUpstreamExtraHeaders(headers, upstreamExtraHeaders);

    if (wsResult.error) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", `WS error: ${wsResult.error}`);
      const lower = wsResult.error.toLowerCase();
      const status = /auth|authorization|401/.test(lower) ? 401 : 502;
      // On a 401, name the live cookie so users know what to re-paste. Meta
      // rebranded Abra→Ecto: the retired `abra_sess` cookie is now `ecto_1_sess`.
      const message =
        status === 401
          ? `${wsResult.error} — your meta.ai ecto_1_sess cookie may be missing or expired; re-paste the ecto_1_sess value from DevTools.`
          : wsResult.error;
      return errorResult(status, message, "meta_ai_ws_error", headers, body);
    }

    const content = wsResult.content || "";

    // Empty WS response is an upstream failure, not a successful empty completion.
    if (!content && !wsResult.deltas.length) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", "WS returned empty response");
      return errorResult(
        502,
        "Meta AI returned no assistant content",
        "meta_ai_empty_response",
        headers,
        body
      );
    }

    const deltas = wsResult.deltas.length > 0 ? wsResult.deltas : [content];
    const parsed = {
      content,
      deltas,
      reasoningContent: "",
      reasoningDeltas: [],
      errorCode: null,
      errorMessage: null,
      status: 200,
    };
    if (content) {
      rememberAssistantTurn(parsed, credentials, model, parsedHistory, conversationContext);
    }
    return buildSuccessResult(parsed, stream, model, headers, body, hasTools, requestedTools);
  }
}

export default MuseSparkWebExecutor;
