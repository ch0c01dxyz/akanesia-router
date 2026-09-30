// AdaptaWebExecutor — Adapta ONE web chat via a Clerk session (ported from
// OmniRoute's adapta-web executor).
//
// Auth: the API key is the `__client` cookie from .clerk.agent.adapta.one.
// The executor calls Clerk's /v1/client to get the active session id, then
// /v1/client/sessions/{id}/tokens for a short-lived session JWT (cached
// in-memory, 100 entries, 30s expiry buffer), and streams
// https://agent.adapta.one/api/chat/stream/v1 with `Authorization: Bearer`.
//
// Request/response translation:
//   - OpenAI messages → Adapta {role, parts:[{type:"text"}]} shape; system
//     prompt is injected into the first user message.
//   - Adapta SSE events (text-delta / text-end / error / done) → OpenAI SSE
//     chunks. The "quick-response" loading placeholder is suppressed.
//   - Tool calls: OmniRoute's translator/webTools.ts (serialize the OpenAI
//     `tools` array into a system-prompt contract, parse `<tool>{...}</tool>`
//     blocks back into `tool_calls`) is ported inline below as local helpers,
//     since 9router has no webTools equivalent.
//
// Gaps vs OmniRoute: `sanitizeErrorMessage` here is a compact local redactor
// (caps length, redacts JWT-shaped tokens and __client cookie values) rather
// than OmniRoute's full errorSanitization machinery; upstream diagnostics are
// still kept out of public error bodies.
import { BaseExecutor } from "./base.js";
import { buildErrorBody } from "../utils/error.js";

const ADAPTA_APP_URL = "https://agent.adapta.one";
const ADAPTA_CLERK_URL = "https://clerk.agent.adapta.one";
const ADAPTA_STREAM_URL = `${ADAPTA_APP_URL}/api/chat/stream/v1`;

/** Compact local stand-in for OmniRoute's sanitizeErrorMessage: keep upstream
 *  diagnostics out of public error bodies and redact credential-shaped tokens. */
function sanitizeErrorMessage(message) {
  let text = String(message ?? "").slice(0, 4096);
  text = text.replace(
    /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    "[redacted]"
  );
  text = text.replace(/__client\s*=\s*[^\s;"']+/gi, "__client=[redacted]");
  return text.trim();
}

const ADAPTA_PUBLIC_STREAM_ERROR = `\n\n[Erro: ${sanitizeErrorMessage("Adapta upstream error")}]`;

// Default model ID in Adapta's internal system (corresponds to "ONE" / auto-select)
const DEFAULT_AI_MODEL_ID = 14;

// Map from OmniRoute model IDs to Adapta internal model IDs.
// 14 = "ONE" (auto), values confirmed via chat history inspection.
// Additional IDs can be added as they are discovered.
const MODEL_ID_MAP = {
  "adapta-one": 14,
  "adapta-gpt": 14,
  "adapta-claude": 14,
  "adapta-gemini": 14,
  "adapta-grok": 14,
  "adapta-deepseek": 14,
  "adapta-llama": 14,
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// ── In-memory session cache ───────────────────────────────────────────────────

const SESSION_CACHE_MAX = 100;

function evictOldest(cache) {
  if (cache.size >= SESSION_CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

// Keyed by the first 32 chars of the stored __client JWT
const sessionCache = new Map();

function cacheKey(clientJwt) {
  return clientJwt.slice(0, 32);
}

function cachedJwt(clientJwt) {
  const entry = sessionCache.get(cacheKey(clientJwt));
  if (!entry) return null;
  // Keep a 30-second buffer before expiry
  if (Date.now() >= entry.jwtExpiresAt - 30_000) {
    sessionCache.delete(cacheKey(clientJwt));
    return null;
  }
  return entry.jwt;
}

function storeSession(clientJwt, sessionId, jwt, expMs) {
  evictOldest(sessionCache);
  sessionCache.set(cacheKey(clientJwt), { sessionId, jwt, jwtExpiresAt: expMs });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractClientJwt(rawApiKey) {
  // Users may paste the full "name=value" form or just the JWT value
  const trimmed = rawApiKey.trim();
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0 && !trimmed.startsWith("eyJ")) {
    return trimmed.slice(eqIdx + 1).trim();
  }
  return trimmed;
}

/** Decode the exp claim from a JWT without verifying signature. */
function jwtExpMs(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return 0;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function makeErrorResponse(status, message) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// ── Clerk auth flow ───────────────────────────────────────────────────────────

/** Step 1: GET /v1/client → returns active session ID. */
async function getSessionId(clientJwt, signal, log) {
  const resp = await fetch(`${ADAPTA_CLERK_URL}/v1/client`, {
    headers: {
      Cookie: `__client=${clientJwt}`,
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
    },
    signal: signal ?? undefined,
  });

  if (!resp.ok) {
    throw new Error(`Clerk /v1/client returned HTTP ${resp.status} — check your __client cookie`);
  }

  const body = await resp.json();
  const sessions = body?.response?.sessions ?? [];
  const active = sessions.find((s) => s.status === "active");
  if (!active?.id) {
    throw new Error(
      "No active Clerk session found — your __client cookie may be expired or invalid"
    );
  }

  log?.info?.("ADAPTA-WEB", `Got session ID: ${active.id}`);
  return active.id;
}

/** Step 2: POST /v1/client/sessions/{id}/tokens → fresh short-lived JWT. */
async function refreshSessionJwt(clientJwt, sessionId, signal, log) {
  const resp = await fetch(`${ADAPTA_CLERK_URL}/v1/client/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers: {
      Cookie: `__client=${clientJwt}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
    },
    signal: signal ?? undefined,
  });

  if (!resp.ok) {
    throw new Error(`Clerk token refresh returned HTTP ${resp.status}`);
  }

  const body = await resp.json();
  const jwt = body?.jwt;
  if (typeof jwt !== "string" || !jwt.startsWith("eyJ")) {
    throw new Error("Clerk token refresh did not return a valid JWT");
  }

  log?.info?.("ADAPTA-WEB", `Got fresh session JWT (${jwt.length} chars)`);
  return jwt;
}

/** Returns a valid (non-expired) session JWT, refreshing if necessary. */
async function getSessionJwt(clientJwt, signal, log) {
  const cached = cachedJwt(clientJwt);
  if (cached) {
    log?.info?.("ADAPTA-WEB", "Using cached session JWT");
    return cached;
  }

  const sessionId = await getSessionId(clientJwt, signal, log);
  const jwt = await refreshSessionJwt(clientJwt, sessionId, signal, log);
  storeSession(clientJwt, sessionId, jwt, jwtExpMs(jwt) || Date.now() + 55_000);
  return jwt;
}

// ── webTools port (from OmniRoute open-sse/translator/webTools.ts) ────────────
// Tool-call translation for web-cookie providers: the web UIs accept only a
// single plain prompt string and have no native function calling — they reply
// with tool invocations as raw text. We (a) serialize the OpenAI `tools` array
// into a system-prompt contract on the request side, and (b) parse the upstream
// `<tool>{...}</tool>` text back into OpenAI `tool_calls` on the response side.

const TOOL_BLOCK_RE = /<tool>\s*([\s\S]*?)\s*<\/tool>/g;
// Some web-cookie models wrap calls as `<tool_call name="...">{json}</tool_call>`
// instead of the canonical `<tool>{json}</tool>`. Capture the JSON body — the real tool name
// lives there, never in the tag's `name="..."` attribute (#3260).
const TOOL_CALL_TAG_RE = /<tool_call(?:\s+[^>]*)?\s*>\s*([\s\S]*?)\s*<\/tool_call>/g;

// Per-request nonce binding for tool envelopes (#9343). Associates a random nonce
// with each tools[] array reference so the serializer and parser can share it
// without threading extra parameters through executor call chains.
const toolNonceMap = new WeakMap();

function getToolNonce(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  let nonce = toolNonceMap.get(tools);
  if (!nonce) {
    nonce = Math.random().toString(36).slice(2, 10);
    toolNonceMap.set(tools, nonce);
  }
  return nonce;
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function getRequestedToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  const names = [];
  const seen = new Set();
  for (const tool of tools) {
    const record = toRecord(tool);
    const fn = toRecord(record?.function);
    const name = typeof fn?.name === "string" ? fn.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push({ original: name, normalized: normalizeToolName(name) });
  }
  return names;
}

function normalizeToolName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    const temp = previous;
    previous = current;
    current = temp;
  }
  return previous[b.length];
}

function scoreToolName(emitted, requested) {
  if (emitted === requested.original) return 1;
  const normalized = normalizeToolName(emitted);
  if (!normalized || !requested.normalized) return 0;
  if (normalized === requested.normalized) return 0.98;

  const shorter = Math.min(normalized.length, requested.normalized.length);
  const longer = Math.max(normalized.length, requested.normalized.length);
  if (shorter >= 4) {
    if (normalized.includes(requested.normalized) || requested.normalized.includes(normalized)) {
      return 0.86 - (longer - shorter) / Math.max(longer, 1) / 4;
    }
  }

  const distance = levenshteinDistance(normalized, requested.normalized);
  const similarity = 1 - distance / Math.max(longer, 1);
  return similarity >= 0.72 ? similarity : 0;
}

function resolveRequestedToolName(emitted, requestedTools) {
  if (requestedTools.length === 0) return emitted;

  let best = null;
  let secondBest = 0;
  for (const requested of requestedTools) {
    const score = scoreToolName(emitted, requested);
    if (!best || score > best.score) {
      secondBest = best?.score ?? 0;
      best = { name: requested.original, score };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (!best || best.score < 0.72) return null;
  // Avoid correcting to an arbitrary tool when the fuzzy match is ambiguous.
  if (best.score < 0.98 && best.score - secondBest < 0.08) return null;
  return best.name;
}

function stripCodeFence(value) {
  return value
    .trim()
    .replace(/^```(?:json|javascript|js|python)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function convertSingleQuotedStrings(value) {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of value) {
    if (escaped) {
      result += ch === '"' && inSingle ? '\\"' : ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (inSingle) {
        result += '\\"';
      } else {
        inDouble = !inDouble;
        result += ch;
      }
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result += '"';
      continue;
    }

    result += ch;
  }

  return result;
}

function replacePythonLiterals(value) {
  let result = "";
  let inString = false;
  let escaped = false;
  let token = "";

  const flushToken = () => {
    if (token === "True") result += "true";
    else if (token === "False") result += "false";
    else if (token === "None") result += "null";
    else result += token;
    token = "";
  };

  for (const ch of value) {
    if (escaped) {
      if (token) flushToken();
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      if (token) flushToken();
      result += ch;
      escaped = inString;
      continue;
    }

    if (ch === '"') {
      if (token) flushToken();
      inString = !inString;
      result += ch;
      continue;
    }

    if (!inString && /[A-Za-z]/.test(ch)) {
      token += ch;
      continue;
    }

    if (token) flushToken();
    result += ch;
  }

  if (token) flushToken();
  return result;
}

function normalizeLooseJson(value) {
  return replacePythonLiterals(convertSingleQuotedStrings(value))
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, "$1");
}

function parseLooseJsonObject(raw) {
  const trimmed = stripCodeFence(raw);
  for (const candidate of [trimmed, normalizeLooseJson(trimmed)]) {
    try {
      return toRecord(JSON.parse(candidate));
    } catch {
      // Try the next, more permissive form.
    }
  }
  return null;
}

function stripRanges(text, ranges) {
  let content = text;
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const range of sorted) {
    const lineStart = content.lastIndexOf("\n", range.start - 1) + 1;
    const nextLineBreak = content.indexOf("\n", range.end);
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
    const beforeOnLine = content.slice(lineStart, range.start);
    const afterOnLine = content.slice(range.end, lineEnd);
    const removeWholeLine = beforeOnLine.trim() === "" && afterOnLine.trim() === "";
    const start = removeWholeLine ? lineStart : range.start;
    const end =
      removeWholeLine && nextLineBreak !== -1
        ? nextLineBreak + 1
        : removeWholeLine
          ? lineEnd
          : range.end;
    content = `${content.slice(0, start)}${content.slice(end)}`;
  }
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

function toArgumentsString(value) {
  if (value === undefined) return "{}";
  if (typeof value === "string") {
    const parsed = parseLooseJsonObject(value);
    return parsed ? JSON.stringify(parsed) : value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

/**
 * Serialize an OpenAI `tools` array into a system-prompt block that instructs the
 * web UI model how to invoke a tool (emit a `<tool>{...}</tool>` block). Returns an
 * empty string when there are no usable tools.
 *
 * Each invocation generates a per-request nonce that is embedded in the tool format
 * instructions. The parser (parseToolCallsFromText) requires this nonce in the model's
 * `<tool>` JSON to distinguish legitimate tool calls from bare JSON, code-fenced JSON,
 * or copy-attacked envelopes (#9343).
 */
function serializeToolsToPrompt(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";

  const nonce = getToolNonce(tools);
  if (!nonce) return "";

  const lines = [];
  for (const t of tools) {
    const fn = t?.function;
    if (!fn?.name) continue;
    const desc = typeof fn.description === "string" && fn.description ? fn.description : "";
    let params = "";
    try {
      params = fn.parameters ? JSON.stringify(fn.parameters) : "";
    } catch {
      params = "";
    }
    lines.push(
      `- ${fn.name}${desc ? `: ${desc}` : ""}${params ? `\n  parameters: ${params}` : ""}`
    );
  }

  if (lines.length === 0) return "";

  return [
    "The client application provides tools beyond your built-in ones. They are NOT in your " +
      "native tool registry; they are invoked via a plain-text protocol: the client parses " +
      "your reply and executes the tool on the user machine. Treat these client tools as " +
      "fully available to you; never claim they are unavailable. To invoke one, reply with " +
      "a single line containing a <tool> block",
    `with JSON that includes the secret binding "_nonce": "${nonce}":`,
    `<tool>{"name": "<tool_name>", "arguments": { ... }, "_nonce": "${nonce}"}</tool>`,
    "These client tools ARE available to you in this conversation. Only emit the <tool> " +
      "block when you actually want to call a tool; otherwise answer normally.",
    "",
    "Available tools:",
    ...lines,
  ].join("\n");
}

/**
 * Parse `<tool>{...}</tool>` or `<tool_call>{...}</tool_call>` blocks out of
 * upstream text into OpenAI `tool_calls`.
 *
 * **Security hardening (#9343):** Bare JSON with name+arguments keys is NEVER
 * promoted to tool_calls — only explicit `<tool>` or `<tool_call>` envelopes are
 * accepted. When a nonce was embedded via serializeToolsToPrompt (stored from the
 * same tools[] reference), it MUST be present in the parsed JSON body as `_nonce`.
 * This prevents code-fenced JSON, prose JSON, and copy-attacked user envelopes from
 * triggering tool execution.
 *
 * Returns the content with the recognized blocks stripped, plus the tool calls
 * (or null when there are none). `arguments` is always a JSON *string*, matching
 * the OpenAI API.
 *
 * `idSeed` makes generated ids deterministic for callers that need stability; when
 * omitted, ids are still unique within a single call (index-based).
 */
function parseToolCallsFromText(text, idSeed = "call", requestedTools) {
  const requestedToolNames = getRequestedToolNames(requestedTools);
  if (typeof text !== "string" || (!text.includes("<tool>") && !text.includes("<tool_call"))) {
    return { content: text ?? "", toolCalls: null };
  }

  const nonce = getToolNonce(requestedTools);
  const candidates = [];

  let blockMatch;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((blockMatch = TOOL_BLOCK_RE.exec(text)) !== null) {
    candidates.push({
      raw: blockMatch[1].trim(),
      start: blockMatch.index,
      end: TOOL_BLOCK_RE.lastIndex,
      requireRequestedTool: false,
    });
  }

  TOOL_CALL_TAG_RE.lastIndex = 0;
  while ((blockMatch = TOOL_CALL_TAG_RE.exec(text)) !== null) {
    candidates.push({
      raw: blockMatch[1].trim(),
      start: blockMatch.index,
      end: TOOL_CALL_TAG_RE.lastIndex,
      requireRequestedTool: false,
    });
  }

  candidates.sort((a, b) => a.start - b.start);

  const toolCalls = [];
  const acceptedRanges = [];
  for (const candidate of candidates) {
    const parsed = parseLooseJsonObject(candidate.raw);
    const emittedName =
      parsed && typeof parsed.name === "string"
        ? parsed.name
        : parsed && typeof parsed.command === "string"
          ? parsed.command
          : null;
    if (!emittedName) continue;

    // Nonce binding check (#9343): when the tool prompt embedded a nonce, check
    // that any _nonce present in the JSON body matches. A wrong nonce (present but
    // does not match) means this is a copy-attack or hallucination — treat it as text
    // instead of executing it. A missing _nonce is tolerated for backward compatibility
    // with models that do not (yet) follow the nonce instruction.
    if (nonce && parsed && parsed._nonce !== undefined && parsed._nonce !== nonce) continue;

    const name =
      resolveRequestedToolName(emittedName, requestedToolNames) ||
      (candidate.requireRequestedTool ? null : emittedName);
    if (!name || (candidate.requireRequestedTool && requestedToolNames.length === 0)) continue;
    const args = toArgumentsString(parsed?.arguments);
    toolCalls.push({
      id: `${idSeed}_${toolCalls.length}`,
      type: "function",
      function: { name, arguments: args },
    });
    acceptedRanges.push({ start: candidate.start, end: candidate.end });
  }

  if (toolCalls.length === 0) {
    return { content: text, toolCalls: null };
  }

  const content = stripRanges(text, acceptedRanges);
  return { content, toolCalls };
}

/** One-line nudge appended to the latest user message. Web-UI models weigh the
 *  current user turn far more heavily than a large system block, and ChatGPT's
 *  injection heuristics distrust long instructions embedded in user content —
 *  so the full contract stays in the system block (trailing, see below) and the
 *  user turn only carries a short pointer back to it, naming the tools. */
function buildToolReminder(toolPrompt) {
  const names = (toolPrompt.match(/^- [^:\n]+/gm) || []).map((s) => s.slice(2).trim()).join(", ");
  return (
    "\n\n[Client protocol reminder: the client-tool contract in the system instructions " +
    "is active in this conversation. These client tools ARE available via the <tool> " +
    "block protocol" +
    (names ? ": " + names : "") +
    ".]"
  );
}

/**
 * Extract tools from an OpenAI request body and inject the tool contract when
 * tools are present. Every web-cookie executor that wants tool-call support
 * calls this once before building its upstream request body.
 *
 * Placement matters: the contract used to be PREPENDED as the first system
 * message. Executors fold all system messages into one block, so with agentic
 * clients whose system prompts exceed ~28K chars the contract sat at the head
 * of a huge block and observed web models ignored it, answering
 * "tool X is not in my tool set" instead of emitting <tool> blocks. Dual
 * placement fixes it: the full contract goes AFTER the client messages (folds
 * to the tail of the system block) and a one-line reminder rides at the end of
 * the latest user message.
 */
function prepareToolMessages(bodyObj, messages) {
  const requestedTools = bodyObj.tools;
  const hasTools = Array.isArray(requestedTools) && requestedTools.length > 0;
  if (!hasTools) return { hasTools: false, requestedTools, effectiveMessages: messages };

  const toolPrompt = serializeToolsToPrompt(requestedTools);
  if (!toolPrompt) return { hasTools: true, requestedTools, effectiveMessages: messages };

  const effectiveMessages = [...messages];
  const reminder = buildToolReminder(toolPrompt);
  for (let i = effectiveMessages.length - 1; i >= 0; i--) {
    const msg = effectiveMessages[i];
    if (msg?.role !== "user") continue;
    if (typeof msg.content === "string") {
      effectiveMessages[i] = { ...msg, content: msg.content + reminder };
    } else if (Array.isArray(msg.content)) {
      effectiveMessages[i] = {
        ...msg,
        content: [...msg.content, { type: "text", text: reminder }],
      };
    }
    break;
  }
  effectiveMessages.push({ role: "system", content: toolPrompt });
  return { hasTools: true, requestedTools, effectiveMessages };
}

/**
 * Parse tool calls from a model's text response.  Returns the cleaned content
 * (with `<tool>` blocks stripped), the parsed tool calls (or null), and the
 * appropriate finish_reason.  Every web-cookie executor calls this on the
 * collected response text when `hasTools` is true.
 */
function buildToolAwareResult(rawContent, requestedTools, idSeed = "call") {
  const { content, toolCalls } = parseToolCallsFromText(
    rawContent,
    `${idSeed}-${Date.now()}`,
    requestedTools
  );
  return {
    content,
    toolCalls,
    finishReason: toolCalls ? "tool_calls" : "stop",
  };
}

// ── Request translation ───────────────────────────────────────────────────────

/** Extract plain text from an OpenAI message content (string or content-parts array). */
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => String(c.text ?? ""))
      .join("");
  }
  return String(content ?? "");
}

/** Build the final Adapta messages array, injecting system prompt into first user message. */
function buildAdaptaMessages(messages) {
  let systemText = "";
  const rest = [];

  for (const msg of messages) {
    const role = msg.role === "developer" ? "system" : msg.role;
    if (role === "system") {
      systemText += (systemText ? "\n" : "") + extractText(msg.content);
    } else {
      rest.push(msg);
    }
  }

  const adapted = [];
  let systemInjected = false;

  for (const msg of rest) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = extractText(msg.content);
    if (!text.trim()) continue;

    if (!systemInjected && systemText && msg.role === "user") {
      adapted.push({
        role: "user",
        parts: [{ type: "text", text: `${systemText}\n\n${text}` }],
      });
      systemInjected = true;
    } else {
      adapted.push({ role: msg.role, parts: [{ type: "text", text }] });
    }
  }

  return adapted;
}

// ── SSE transform: Adapta → OpenAI ───────────────────────────────────────────

function transformStream(adaptaStream, model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-adp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let roleEmitted = false;

  return new ReadableStream({
    async start(controller) {
      const reader = adaptaStream.getReader();
      let buffer = "";

      const emit = (obj) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const chunk = (delta, finish) =>
        emit({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finish ?? null }],
        });

      const ensureRole = () => {
        if (!roleEmitted) {
          roleEmitted = true;
          chunk({ role: "assistant", content: "" });
        }
      };

      const finalize = () => {
        ensureRole();
        chunk({}, "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;

            let event;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }

            const type = event.type;

            if (type === "text-delta") {
              const delta = event.delta;
              // Suppress the "quick-response" loading placeholder
              if (event.id === "quick-response") continue;
              if (typeof delta === "string" && delta.length > 0) {
                ensureRole();
                chunk({ content: delta });
              }
            } else if (type === "text-end") {
              if (event.id === "quick-response") continue;
              // Real text ended — stream will send more events or close
            } else if (type === "error") {
              ensureRole();
              // Keep upstream diagnostics private: the transformed SSE is a public HTTP 200 body.
              chunk({ content: ADAPTA_PUBLIC_STREAM_ERROR });
              finalize();
              return;
            } else if (type === "done" || type === "end") {
              finalize();
              return;
            }
          }
        }
      } catch {
        // Stream aborted or network error — emit what we have
      }

      finalize();
    },
  });
}

// ── Executor ──────────────────────────────────────────────────────────────────

export class AdaptaWebExecutor extends BaseExecutor {
  constructor() {
    super("adapta-web", { baseUrl: ADAPTA_STREAM_URL });
  }

  async testConnection(credentials, signal) {
    try {
      const rawKey = String(credentials?.apiKey ?? "");
      if (!rawKey) return false;
      const clientJwt = extractClientJwt(rawKey);
      const sessionId = await getSessionId(clientJwt, signal);
      return !!sessionId;
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const bodyObj = body ?? {};
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(bodyObj, messages);

    // 1. Extract and validate credentials
    const rawKey = String(credentials?.apiKey ?? "");
    if (!rawKey) {
      return {
        response: makeErrorResponse(
          401,
          "Missing Adapta credentials — paste your __client cookie from .clerk.agent.adapta.one"
        ),
        url: ADAPTA_STREAM_URL,
        headers: {},
        transformedBody: body,
      };
    }
    const clientJwt = extractClientJwt(rawKey);

    let sessionJwt;
    try {
      log?.info?.("ADAPTA-WEB", "Obtaining session JWT via Clerk...");
      sessionJwt = await getSessionJwt(clientJwt, signal, log);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn?.("ADAPTA-WEB", `Auth failed: ${msg}`);
      return {
        response: makeErrorResponse(401, `Adapta auth failed: ${sanitizeErrorMessage(msg)}`),
        url: ADAPTA_STREAM_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // 2. Build Adapta request body
    const aiModelId = MODEL_ID_MAP[model] ?? DEFAULT_AI_MODEL_ID;
    const adaptaMessages = buildAdaptaMessages(effectiveMessages);

    if (adaptaMessages.length === 0) {
      return {
        response: makeErrorResponse(400, "No messages provided"),
        url: ADAPTA_STREAM_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const requestPayload = {
      messages: adaptaMessages,
      aiModelId,
    };

    const headers = {
      Authorization: `Bearer ${sessionJwt}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
      Referer: `${ADAPTA_APP_URL}/agentic-chat`,
    };

    log?.info?.(
      "ADAPTA-WEB",
      `POST ${ADAPTA_STREAM_URL} | model=${model} aiModelId=${aiModelId} msgs=${adaptaMessages.length}`
    );

    // 3. Fire request
    const resp = await fetch(ADAPTA_STREAM_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
      signal: signal ?? undefined,
    });

    if (!resp.ok) {
      let errMsg = `Adapta error HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403) {
        errMsg =
          "Adapta session expired or invalid — re-paste your __client cookie from .clerk.agent.adapta.one";
        // Evict cached JWT so next request re-authenticates
        sessionCache.delete(cacheKey(clientJwt));
      } else if (resp.status === 429) {
        errMsg = "Adapta rate limited — wait and retry";
      }
      log?.warn?.("ADAPTA-WEB", errMsg);
      return {
        response: makeErrorResponse(resp.status, errMsg),
        url: ADAPTA_STREAM_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    // 4. Stream or collect
    if (stream !== false) {
      return {
        response: new Response(transformStream(resp.body, model), {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: ADAPTA_STREAM_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    // Non-streaming: collect all text-delta events
    const decoder = new TextDecoder();
    const reader = resp.body.getReader();
    let buf = "";
    let fullText = "";
    let upstreamErrorMessage = null;

    try {
      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "text-delta" && ev.id !== "quick-response") {
              fullText += String(ev.delta ?? "");
            } else if (ev.type === "error") {
              upstreamErrorMessage = "Adapta upstream error";
              break readLoop;
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      if (upstreamErrorMessage) {
        void reader.cancel("Adapta upstream SSE error").catch(() => undefined);
      }
      reader.releaseLock();
    }

    if (upstreamErrorMessage) {
      return {
        response: new Response(JSON.stringify(buildErrorBody(502, upstreamErrorMessage)), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
        url: ADAPTA_STREAM_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    if (hasTools) {
      const { content, toolCalls, finishReason } = buildToolAwareResult(
        fullText,
        requestedTools,
        "adp"
      );
      if (toolCalls) {
        return {
          response: new Response(
            JSON.stringify({
              id: `chatcmpl-adp-${Date.now()}`,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: null, tool_calls: toolCalls },
                  finish_reason: finishReason,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          ),
          url: ADAPTA_STREAM_URL,
          headers,
          transformedBody: requestPayload,
        };
      }
      return {
        response: new Response(
          JSON.stringify({
            id: `chatcmpl-adp-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
        url: ADAPTA_STREAM_URL,
        headers,
        transformedBody: requestPayload,
      };
    }

    return {
      response: new Response(
        JSON.stringify({
          id: `chatcmpl-adp-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: fullText },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: ADAPTA_STREAM_URL,
      headers,
      transformedBody: requestPayload,
    };
  }
}

export default AdaptaWebExecutor;
