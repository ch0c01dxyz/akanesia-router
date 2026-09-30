// YuanbaoWebExecutor — Tencent Yuanbao (yuanbao.tencent.com) Web Provider
// (ported from OmniRoute's yuanbao-web executor).
//
// Routes chat requests through the Tencent Yuanbao consumer web session.
// Requires the `hy_user` + `hy_token` cookies from a logged-in
// yuanbao.tencent.com browser session (paste the full Cookie header).
//
// API flow (verified against the reverse-engineered references in the source):
//   1. POST /api/user/agent/conversation/create  { agentId } -> { id }  (conversationId)
//   2. POST /api/chat/{conversationId}           (JSON body) -> SSE stream
//
// Streaming format (SSE, `data: {json}` lines):
//   - { type: "think", content: "..." }   -- reasoning tokens (DeepSeek-R1 / Hunyuan-T1)
//   - { type: "text",  msg: "..." }       -- answer tokens
//   - { ..., stopReason: "..." }          -- terminal marker
//
// Port notes (approximations vs OmniRoute, no behavioral difference intended):
//   - sanitizeErrorMessage() is a local approximation of OmniRoute's full
//     errorSanitization helper (control-char stripping + length cap).
//   - stripCookieInputPrefix()/extractCookieValue() are inlined from
//     OmniRoute's src/lib/providers/webCookieAuth.
//   - mergeAbortSignals()/mergeUpstreamExtraHeaders() are inlined from
//     OmniRoute's executor base helpers.
//   - FETCH_TIMEOUT_MS maps to 9router's FETCH_CONNECT_TIMEOUT_MS.
import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";

const YUANBAO_BASE = "https://yuanbao.tencent.com";
const CREATE_URL = `${YUANBAO_BASE}/api/user/agent/conversation/create`;
const CHAT_URL = `${YUANBAO_BASE}/api/chat`;

// Public default DeepSeek agent id used by the Yuanbao web app. Not a secret —
// it is the shared consumer agent every logged-in session addresses by default.
const DEFAULT_AGENT_ID = "naQivTmsDa";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const DEFAULT_MODEL = "deepseek-v3";

// OmniRoute model id -> Yuanbao internal chatModelId + optional supportFunctions.
const MODEL_MAP = {
  "deepseek-v3": { chatModelId: "deep_seek_v3" },
  "deepseek-r1": { chatModelId: "deep_seek" },
  "deepseek-v3-search": {
    chatModelId: "deep_seek_v3",
    supportFunctions: ["supportInternetSearch"],
  },
  "deepseek-r1-search": {
    chatModelId: "deep_seek",
    supportFunctions: ["supportInternetSearch"],
  },
  hunyuan: { chatModelId: "hunyuan_gpt_175B_0404" },
  "hunyuan-t1": { chatModelId: "hunyuan_t1" },
  "hunyuan-search": {
    chatModelId: "hunyuan_gpt_175B_0404",
    supportFunctions: ["supportInternetSearch"],
  },
  "hunyuan-t1-search": {
    chatModelId: "hunyuan_t1",
    supportFunctions: ["supportInternetSearch"],
  },
};

// ── Inlined helpers (from OmniRoute's base/webCookieAuth/error utils) ───────

function sanitizeErrorMessage(message) {
  return String(message ?? "")
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

function extractCookieValue(rawValue, cookieName) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  if (trimmed.includes(";")) {
    const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;\\s]+)"));
    return match ? match[1] : "";
  }

  const prefix = `${cookieName}=`;
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);

  return trimmed;
}

function mergeAbortSignals(primary, secondary) {
  const controller = new AbortController();
  const cleanup = () => {
    primary.removeEventListener("abort", onPrimaryAbort);
    secondary.removeEventListener("abort", onSecondaryAbort);
  };
  const abortFrom = (source) => {
    if (!controller.signal.aborted) {
      controller.abort(source.reason);
    }
    cleanup();
  };
  const onPrimaryAbort = () => abortFrom(primary);
  const onSecondaryAbort = () => abortFrom(secondary);
  if (primary.aborted) {
    abortFrom(primary);
    return controller.signal;
  }
  if (secondary.aborted) {
    abortFrom(secondary);
    return controller.signal;
  }
  primary.addEventListener("abort", onPrimaryAbort);
  secondary.addEventListener("abort", onSecondaryAbort);
  return controller.signal;
}

function mergeUpstreamExtraHeaders(headers, extra) {
  if (!extra) return;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof k === "string" && k.length > 0 && typeof v === "string") {
      if (k.toLowerCase() === "user-agent") {
        headers["User-Agent"] = v;
        continue;
      }
      headers[k] = v;
    }
  }
}

// ── Ported helpers ───────────────────────────────────────────────────────────

function isEncryptedCredentialBlob(value) {
  return typeof value === "string" && value.trim().startsWith("enc:v1:");
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part;
      if ((item.type === "text" || item.type === "input_text") && typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .filter((p) => p.length > 0)
    .join("\n");
}

/** Flatten OpenAI messages into the single-prompt shape Yuanbao expects. */
function buildPrompt(messages) {
  const parts = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    const text = extractText(msg.content).trim();
    if (!text) continue;
    parts.push({ role, content: text });
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].content;
  // Multi-turn: label each turn (matches the reference chat2api formatting).
  return parts.map((p) => `#[${p.role.trim()}]\n${p.content}`).join("\n\n");
}

/** Build the `hy_source=web; hy_user=...; hy_token=...` cookie from the pasted header. */
function buildYuanbaoCookie(rawApiKey) {
  const raw = stripCookieInputPrefix(rawApiKey || "");
  // Guard the extractCookieValue bare-value fallback: for input that is a single
  // FOREIGN pair (e.g. "some_other=abc") the helper returns the whole string, which
  // used to fool this validation into forwarding garbage upstream (the request only
  // failed when Tencent replied 401 — a live-network dependency). Yuanbao needs the
  // two distinct cookies, so only trust an extraction the input explicitly names.
  const hyUser = raw.includes("hy_user=") ? extractCookieValue(raw, "hy_user") : null;
  const hyToken = raw.includes("hy_token=") ? extractCookieValue(raw, "hy_token") : null;

  if (hyUser && hyToken) {
    return { cookie: `hy_source=web; hy_user=${hyUser}; hy_token=${hyToken}`, hasToken: true };
  }

  // Fall back to forwarding whatever the user pasted (may already be a full
  // Cookie header). Only usable if it plausibly carries the session token.
  const hasToken = raw.includes("hy_token=");
  return { cookie: raw, hasToken };
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

async function readUpstreamErrorDetails(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text().catch(() => "");
  if (!text) return { message: null, details: null };

  if (contentType.includes("json")) {
    try {
      const parsed = JSON.parse(text);
      const message =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : null;
      return { message: message ? sanitizeErrorMessage(message) : null, details: parsed };
    } catch {
      // fall through
    }
  }
  return { message: sanitizeErrorMessage(text), details: { body: text } };
}

// ── Executor ────────────────────────────────────────────────────────────────

export class YuanbaoWebExecutor extends BaseExecutor {
  constructor(provider = "yuanbao-web") {
    super(provider, { id: provider, baseUrl: CHAT_URL });
  }

  errorResponse(status, message, url, details) {
    const clean = sanitizeErrorMessage(message) || `Yuanbao error (HTTP ${status})`;
    const payload = {
      error: { message: clean, type: "upstream_error", code: `HTTP_${status}` },
    };
    if (details !== undefined && details !== null) payload.error.details = details;
    return {
      response: new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      url,
      headers: {},
      transformedBody: undefined,
    };
  }

  async execute(input) {
    const { model, body, stream, credentials, signal, log, upstreamExtraHeaders } = input;
    const messages = body?.messages;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return this.errorResponse(400, "Missing or empty messages array", CHAT_URL);
    }

    if (isEncryptedCredentialBlob(credentials.apiKey)) {
      return this.errorResponse(
        401,
        "Yuanbao credentials are encrypted but STORAGE_ENCRYPTION_KEY is not loaded. " +
          "Restore the encryption key or re-save the Yuanbao cookie.",
        CREATE_URL
      );
    }

    const { cookie, hasToken } = buildYuanbaoCookie(credentials.apiKey || "");
    if (!hasToken) {
      return this.errorResponse(
        401,
        "Yuanbao requires a session cookie. Log in to yuanbao.tencent.com, open " +
          "DevTools > Application > Cookies, and paste the full Cookie header " +
          "(it must contain hy_user and hy_token).",
        CREATE_URL
      );
    }

    const resolvedModel = model && MODEL_MAP[model] ? model : DEFAULT_MODEL;
    const modelSpec = MODEL_MAP[resolvedModel];
    const prompt = buildPrompt(messages);
    if (!prompt.trim()) {
      return this.errorResponse(400, "Empty prompt after processing messages", CHAT_URL);
    }

    const baseHeaders = {
      Cookie: cookie,
      "User-Agent": USER_AGENT,
      Origin: YUANBAO_BASE,
      Referer: `${YUANBAO_BASE}/chat/${DEFAULT_AGENT_ID}`,
      "X-Agentid": DEFAULT_AGENT_ID,
    };

    const timeoutSignal = AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS);
    const combinedSignal = signal ? mergeAbortSignals(signal, timeoutSignal) : timeoutSignal;

    // ── Step 1: create conversation ─────────────────────────────────────────
    let conversationId;
    try {
      const createRes = await fetch(CREATE_URL, {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: DEFAULT_AGENT_ID }),
        signal: combinedSignal,
      });

      if (!createRes.ok) {
        const status = createRes.status;
        const upstreamError = await readUpstreamErrorDetails(createRes);
        let message = `Yuanbao conversation creation failed (HTTP ${status})`;
        if (status === 401 || status === 403) {
          message =
            "Yuanbao auth failed — your hy_user/hy_token cookies may be missing or expired. " +
            "Log in to yuanbao.tencent.com and re-paste your Cookie header.";
        } else if (status === 429) {
          message = "Yuanbao rate limited. Wait a moment and retry.";
        }
        if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
        return this.errorResponse(status, message, CREATE_URL, upstreamError.details);
      }

      const createData = await createRes.json();
      conversationId = String(createData.id || "");
      if (!conversationId) {
        return this.errorResponse(502, "Yuanbao did not return a conversation id", CREATE_URL);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log?.error?.("YUANBAO-WEB", `Conversation creation failed: ${message}`);
      return this.errorResponse(
        502,
        `Yuanbao connection failed: ${sanitizeErrorMessage(message)}`,
        CREATE_URL
      );
    }

    // ── Step 2: send message ────────────────────────────────────────────────
    const messageUrl = `${CHAT_URL}/${conversationId}`;
    const chatBody = {
      model: "gpt_175B_0404",
      prompt,
      plugin: "Adaptive",
      displayPrompt: prompt,
      displayPromptType: 1,
      options: {
        imageIntention: {
          needIntentionModel: true,
          backendUpdateFlag: 2,
          intentionStatus: true,
        },
      },
      multimedia: [],
      agentId: DEFAULT_AGENT_ID,
      supportHint: 1,
      version: "v2",
      chatModelId: modelSpec.chatModelId,
    };
    if (modelSpec.supportFunctions) chatBody.supportFunctions = modelSpec.supportFunctions;

    const chatHeaders = {
      ...baseHeaders,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    mergeUpstreamExtraHeaders(chatHeaders, upstreamExtraHeaders);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(messageUrl, {
        method: "POST",
        headers: chatHeaders,
        body: JSON.stringify(chatBody),
        signal: combinedSignal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log?.error?.("YUANBAO-WEB", `Message send failed: ${message}`);
      return this.errorResponse(
        502,
        `Yuanbao connection failed: ${sanitizeErrorMessage(message)}`,
        messageUrl
      );
    }

    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status;
      const upstreamError = await readUpstreamErrorDetails(upstreamResponse);
      let message = `Yuanbao returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        message = "Yuanbao auth failed — session cookie may be expired.";
      } else if (status === 429) {
        message = "Yuanbao rate limited. Wait a moment and retry.";
      }
      if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
      return this.errorResponse(status, message, messageUrl, upstreamError.details);
    }

    if (!upstreamResponse.body) {
      return this.errorResponse(502, "Yuanbao returned empty response body", messageUrl);
    }

    // ── Step 3: translate SSE → OpenAI ──────────────────────────────────────
    const id = `chatcmpl-yuanbao-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      return {
        response: new Response(
          transformYuanbaoStream(upstreamResponse.body, resolvedModel, id, created, signal, log),
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "X-Accel-Buffering": "no",
            },
          }
        ),
        url: messageUrl,
        headers: chatHeaders,
        transformedBody: chatBody,
      };
    }

    const { content, reasoning } = await collectYuanbaoResponse(upstreamResponse.body, signal);
    const completionTokens = estimateTokens(content + reasoning);
    const messagePayload = { role: "assistant", content };
    if (reasoning) messagePayload.reasoning_content = reasoning;

    return {
      response: new Response(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model: resolvedModel,
          choices: [{ index: 0, message: messagePayload, finish_reason: "stop" }],
          usage: {
            prompt_tokens: estimateTokens(prompt),
            completion_tokens: completionTokens,
            total_tokens: estimateTokens(prompt) + completionTokens,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: messageUrl,
      headers: chatHeaders,
      transformedBody: chatBody,
    };
  }
}

// ── SSE translation helpers ───────────────────────────────────────────────────

function parseYuanbaoDataLine(line) {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (!payload || payload === "[DONE]" || !payload.startsWith("{")) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function transformYuanbaoStream(upstream, model, id, created, signal, log) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let roleEmitted = false;

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";

      const emit = (delta, finish) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta, finish_reason: finish ?? null }],
            })}\n\n`
          )
        );
      };

      const ensureRole = () => {
        if (!roleEmitted) {
          roleEmitted = true;
          emit({ role: "assistant", content: "" });
        }
      };

      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = parseYuanbaoDataLine(line);
            if (!event) continue;
            if (event.type === "think" && event.content) {
              ensureRole();
              emit({ reasoning_content: event.content });
            } else if (event.type === "text") {
              const text = event.msg ?? event.content;
              if (text) {
                ensureRole();
                emit({ content: text });
              }
            }
          }
        }
      } catch (err) {
        log?.error?.("YUANBAO-WEB", `Stream error: ${err}`);
      } finally {
        ensureRole();
        emit({}, "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

async function collectYuanbaoResponse(upstream, signal) {
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  let buffer = "";
  let content = "";
  let reasoning = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseYuanbaoDataLine(line);
        if (!event) continue;
        if (event.type === "think" && event.content) reasoning += event.content;
        else if (event.type === "text") {
          const text = event.msg ?? event.content;
          if (text) content += text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content, reasoning };
}

export default YuanbaoWebExecutor;
