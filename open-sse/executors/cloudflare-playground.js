// CloudflarePlaygroundExecutor — Cloudflare AI Playground (No Auth) provider
// (ported from OmniRoute's cloudflare-playground executor).
//
// Reverse-engineered access to the free, anonymous Cloudflare AI Playground
// (https://playground.ai.cloudflare.com). No account, no API key, no cookies:
// chat runs over a PartySocket WebSocket speaking Cloudflare's `cf_agent` RPC
// protocol, and the only gate is a browser-grade TLS fingerprint on the WS
// upgrade. This executor therefore drives a headless Chromium via Playwright,
// opens the WebSocket *inside the page context* (only a real browser TLS stack
// passes the upgrade), and translates the `cf_agent` frame stream into
// OpenAI-format chat completion chunks.
//
// Protocol (captured live 2026-08-15):
//   - Transport: wss://playground.ai.cloudflare.com/agents/playground/<room>?_pk=<uuid>
//   - Resume:    {"type":"cf_agent_stream_resume_request"}
//   - Config:    {"type":"rpc","method":"setConfig","args":[{model,temperature,stream}]}
//   - Chat:      {"id":<cid>,"init":{"method":"POST","body":{messages,trigger}},"type":"cf_agent_use_chat_request"}
//   - Stream:    start → start-step → (reasoning-start/delta/end)* → text-start →
//                text-delta* → finish-step → finish{messageMetadata.finishReason} → {done:true}
//   - Errors:    {"error":true,"body":"{message,details}","id":<cid>} — e.g.
//                "3021: rate limiting: inference request per min rate reached"
//
// Notes:
//   - The playground's system prompt is server-side (set via setConfig by the
//     app itself); client `system` messages are dropped. Tool calls are not
//     implemented (v1) — text-only chat.
//   - Upstream rate limits arrive in-band as `error:true` frames. Non-streaming
//     requests surface them as HTTP 429/502; streaming requests emit an SSE
//     error chunk before `[DONE]` (the response status is already committed).
//     A server-side chat timeout follows the same rule: streaming requests
//     emit a `timeout_error` chunk before `[DONE]` instead of silently
//     completing (#10494).
//   - Set CLOUDFLARE_PLAYGROUND_CHROME_PATH to point at a full desktop Chrome
//     binary when Playwright's bundled Chromium gets fingerprint-blocked.
//
// Gap vs OmniRoute: OmniRoute prefers a shared Obscura browser via
// `connectObscuraBrowser()` (services/obscura.ts); 9router has no obscura
// service, so this port tries a dynamic import of ../services/obscura.js and
// treats its absence as "unavailable", falling back to a direct Chromium
// launch exactly as the source does. 9router also has no `playwright`
// dependency installed, so requests currently fail with the same 502 the
// source produced when Playwright is missing ("Install it (npm i playwright
// && npx playwright install chromium) or set CLOUDFLARE_PLAYGROUND_CHROME_PATH
// to a Chrome binary."). Install playwright (and its browser) to enable.
import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";

export const PLAYGROUND_URL = "https://playground.ai.cloudflare.com/";
const PLAYGROUND_WS_BASE = "wss://playground.ai.cloudflare.com/agents/playground/";
const PLAYGROUND_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
];
const MODEL_PREFIX = "@cf/";
const DEFAULT_MODEL = "zai-org/glm-4.7-flash";
const DEFAULT_TEMPERATURE = 0.7;
const NAV_TIMEOUT_MS = 45_000;
const CHAT_TIMEOUT_MS = 120_000;
const BLOCKED_MESSAGE =
  "Cloudflare Playground blocked the headless browser (fingerprint check). Set CLOUDFLARE_PLAYGROUND_CHROME_PATH to a full desktop Chrome binary and retry.";

/** Local equivalent of OmniRoute's makeExecutorErrorResult (9router has no such util). */
function makeErrorResult(status, message, body, url) {
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message,
          type: "upstream_error",
          code: `HTTP_${status}`,
        },
      }),
      { status, headers: { "Content-Type": "application/json" } }
    ),
    url,
    headers: {},
    transformedBody: body,
  };
}

/**
 * OmniRoute prefers a shared Obscura browser (services/obscura.ts); 9router
 * has no such service, so resolve it opportunistically and return null when
 * absent — the transport then falls back to a direct Chromium launch.
 */
async function connectObscuraBrowser() {
  try {
    const mod = await import("../services/obscura.js");
    if (typeof mod.connectObscuraBrowser === "function") {
      return await mod.connectObscuraBrowser();
    }
  } catch {
    // no obscura service in 9router — fall through to direct launch
  }
  return null;
}

// ── Frame parsing & translation (pure — unit-tested against live captures) ──

/** Parse a raw WS frame. Returns null for non-JSON / unrelated frames. */
export function parseCfFrame(raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg === "object" && typeof msg.type === "string") return msg;
  } catch {
    /* non-JSON — ignore */
  }
  return null;
}

/**
 * Translates `cf_agent_use_chat_response` frames for one chat id into
 * OpenAI-format stream events. Frames for other ids (RPC responses such as
 * `setConfig` also carry `done:true`!) and non-chat frame types
 * (`cf_agent_identity`, `cf_agent_state`, ...) are ignored.
 */
export class CfStreamParser {
  constructor(chatId) {
    this.chatId = chatId;
    this.done = false;
    this.text = "";
    this.reasoningText = "";
    this.finishReason = null;
    this.error = null;
    this.seenStart = false;
  }

  /** Returns the SSE-relevant event, or null when the frame is ignorable. */
  push(raw) {
    const msg = parseCfFrame(raw);
    if (!msg || msg.type !== "cf_agent_use_chat_response" || msg.id !== this.chatId) return null;

    if (msg.error) {
      this.error = classifyError(msg.body);
      return null;
    }
    if (msg.done) {
      this.done = true;
      return null;
    }

    let body;
    try {
      body = typeof msg.body === "string" ? JSON.parse(msg.body) : msg.body;
    } catch {
      return null;
    }
    if (!body || typeof body.type !== "string") return null;

    switch (body.type) {
      case "start":
        if (this.seenStart) return null;
        this.seenStart = true;
        return { type: "role" };
      case "reasoning-delta": {
        const delta = typeof body.delta === "string" ? body.delta : "";
        if (!delta) return null;
        this.reasoningText += delta;
        return { type: "reasoning", value: delta };
      }
      case "text-delta": {
        const delta = typeof body.delta === "string" ? body.delta : "";
        if (!delta) return null;
        this.text += delta;
        return { type: "content", value: delta };
      }
      case "finish": {
        const meta = body.messageMetadata ?? {};
        const reason = typeof meta.finishReason === "string" ? meta.finishReason : "stop";
        this.finishReason = reason;
        return { type: "finish", value: reason };
      }
      default:
        // reasoning-start/end, start-step, finish-step, text-start/end, heartbeat — ignored.
        return null;
    }
  }
}

/** Map an in-band upstream error frame to an HTTP-ish status + clean message. */
function classifyError(body) {
  let detail = "";
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      detail = String(parsed.details || parsed.message || "");
    } catch {
      detail = body;
    }
  } else if (body && typeof body === "object") {
    const parsed = body;
    detail = String(parsed.details || parsed.message || "");
  }
  const status = /rate|limit|quota|throttl/i.test(detail) ? 429 : 502;
  return { status, message: detail || "Cloudflare Playground upstream error" };
}

// ── Message conversion ───────────────────────────────────────────────────────

/**
 * Convert OpenAI-format messages to the playground's chat body shape.
 * `system` messages are dropped (the playground's persona is server-side) and
 * tool/image parts are flattened to text — v1 is text-only chat.
 */
export function toCfMessages(messages) {
  const out = [];
  for (const message of messages ?? []) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    let text = "";
    if (typeof message.content === "string") {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      text = message.content
        .map((part) => (typeof part === "string" ? part : (part?.text ?? "")))
        .filter(Boolean)
        .join("\n");
    }
    if (!text) continue;
    out.push({ role: message.role, parts: [{ type: "text", text }], id: `m${out.length + 1}` });
  }
  return out;
}

// ── Transport ────────────────────────────────────────────────────────────────

/** Open the anonymous playground session inside the browser page context. */
function openPlaygroundSession(args) {
  const { chatId, model, messages, temperature, wsBase } = args;
  const pk = crypto.randomUUID();
  const room = "playground-" + crypto.randomUUID().replace(/-/g, "").slice(0, 25);
  const socket = new WebSocket(wsBase + room + "?_pk=" + pk);
  const push = (raw) => {
    try {
      window.__cfpPush(raw);
    } catch {
      /* page torn down */
    }
  };
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "cf_agent_stream_resume_request" }));
    socket.send(
      JSON.stringify({
        type: "rpc",
        id: "cfp-config",
        method: "setConfig",
        args: [{ model, temperature, stream: true }],
      })
    );
    socket.send(
      JSON.stringify({
        id: chatId,
        init: { method: "POST", body: JSON.stringify({ messages, trigger: "submit-message" }) },
        type: "cf_agent_use_chat_request",
      })
    );
  };
  socket.onmessage = (event) => push(String(event.data));
  socket.onerror = () =>
    push(
      JSON.stringify({
        id: chatId,
        type: "cf_agent_use_chat_response",
        error: true,
        body: JSON.stringify({
          message: "Playground WebSocket error",
          details: "ws transport failed",
        }),
      })
    );
}

export class PlaywrightCfTransport {
  constructor(chatId, chromeExecutablePath) {
    this.chatId = chatId;
    this.chromeExecutablePath = chromeExecutablePath;
    this.browser = null;
    this.page = null;
    this.pending = [];
    this.waiters = [];
    this.closed = false;
    this.abortSignal = null;
    this.abortListener = null;
  }

  async start(config) {
    try {
      // #12274: prefer the shared Obscura browser (browser-grade TLS fingerprint
      // on the WS upgrade, ~30MB) over a full Chromium per request; fall back to
      // a direct Chromium launch when Obscura is unavailable.
      const obscura = await connectObscuraBrowser();
      const playwright = await importPlaywright();
      if (obscura) {
        this.browser = obscura.browser;
      } else {
        const executablePath =
          this.chromeExecutablePath ?? process.env.CLOUDFLARE_PLAYGROUND_CHROME_PATH;
        this.browser = await playwright.chromium.launch({
          ...(executablePath ? { executablePath } : {}),
          headless: true,
          args: BROWSER_ARGS,
        });
      }
      const context = await this.browser.newContext({ userAgent: PLAYGROUND_UA });
      const page = await context.newPage();
      this.page = page;
      await page.goto(PLAYGROUND_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const title = await page.title().catch(() => "");
      if (title.includes("Attention Required")) {
        // #10494: this branch used to return without closing the browser it
        // just launched, leaking a Chromium process for every blocked
        // request. Close it on every non-success start path, same as the
        // catch block below.
        await this.close().catch(() => {});
        return { ok: false, status: 502, message: BLOCKED_MESSAGE };
      }
      await page.exposeFunction("__cfpPush", (raw) => {
        this.push(raw);
      });
      // Bundlers (esbuild/webpack keepNames) inject a `__name` helper call into
      // serialized function bodies; define it in the page context so
      // page.evaluate(openPlaygroundSession) doesn't throw ReferenceError.
      await page.evaluate(() => {
        window.__name = (fn) => fn;
      });
      await page.evaluate(openPlaygroundSession, {
        ...config,
        chatId: this.chatId,
        wsBase: PLAYGROUND_WS_BASE,
      });
      if (config.signal) {
        this.abortSignal = config.signal;
        this.abortListener = () => {
          void this.close();
        };
        config.signal.addEventListener("abort", this.abortListener, { once: true });
      }
      return { ok: true };
    } catch (error) {
      await this.close().catch(() => {});
      return {
        ok: false,
        status: 502,
        message: `Cloudflare Playground browser session failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  push(raw) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(raw);
    else this.pending.push(raw);
  }

  async *frames() {
    while (this.pending.length > 0 || !this.closed) {
      if (this.pending.length > 0) {
        yield this.pending.shift();
        continue;
      }
      const frame = await new Promise((resolve) => this.waiters.push(resolve));
      if (frame === null) return;
      yield frame;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.abortSignal && this.abortListener) {
      this.abortSignal.removeEventListener("abort", this.abortListener);
    }
    this.abortSignal = null;
    this.abortListener = null;
    for (const waiter of this.waiters.splice(0)) waiter(null);
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => {});
  }
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not available. Install it (npm i playwright && npx playwright install chromium) or set CLOUDFLARE_PLAYGROUND_CHROME_PATH to a Chrome binary."
    );
  }
}

// ── Executor ─────────────────────────────────────────────────────────────────

function sseChunk(cid, created, model, payload) {
  const base = { id: cid, object: "chat.completion.chunk", created, model };
  if (payload.error) {
    return `data: ${JSON.stringify({ ...base, error: payload.error })}\n\n`;
  }
  return `data: ${JSON.stringify({
    ...base,
    choices: [{ index: 0, delta: payload.delta ?? {}, finish_reason: payload.finish_reason ?? null }],
  })}\n\n`;
}

export class CloudflarePlaygroundExecutor extends BaseExecutor {
  constructor(
    transportFactory = (chatId) => new PlaywrightCfTransport(chatId),
    // Injectable so tests can force the timeout branch without waiting
    // CHAT_TIMEOUT_MS (120s) for a real timer to fire.
    chatTimeoutMs = CHAT_TIMEOUT_MS
  ) {
    super("cloudflare-playground", { id: "cloudflare-playground", baseUrl: PLAYGROUND_URL });
    this.transportFactory = transportFactory;
    this.chatTimeoutMs = chatTimeoutMs;
  }

  async execute(input) {
    const { body, signal, stream: wantStream } = input;
    const bodyObj = body || {};
    const rawModel = bodyObj.model || DEFAULT_MODEL;
    const model = rawModel.startsWith(MODEL_PREFIX) ? rawModel : MODEL_PREFIX + rawModel;
    const temperature =
      typeof bodyObj.temperature === "number" ? bodyObj.temperature : DEFAULT_TEMPERATURE;
    const chatId = `chatcmpl-cfp-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    const transport = this.transportFactory(chatId);
    const started = await transport.start({
      model,
      messages: toCfMessages(bodyObj.messages || []),
      temperature,
      signal,
    });
    if (started.ok !== true) {
      return makeErrorResult(started.status, started.message, body, PLAYGROUND_URL);
    }

    const timedOut = { current: false };
    const timer = setTimeout(() => {
      timedOut.current = true;
      void transport.close();
    }, this.chatTimeoutMs);

    try {
      if (!wantStream) {
        const parser = new CfStreamParser(chatId);
        for await (const raw of transport.frames()) {
          parser.push(raw);
          if (parser.error || parser.done) break;
        }
        if (parser.error) {
          return makeErrorResult(parser.error.status, parser.error.message, body, PLAYGROUND_URL);
        }
        if (timedOut.current && !parser.text) {
          return makeErrorResult(504, "Cloudflare Playground timed out", body, PLAYGROUND_URL);
        }
        const text = parser.text;
        const messagePayload = { role: "assistant", content: text };
        if (parser.reasoningText) {
          messagePayload.reasoning_content = parser.reasoningText;
        }
        return {
          response: new Response(
            JSON.stringify({
              id: chatId,
              object: "chat.completion",
              created,
              model: rawModel,
              choices: [
                {
                  index: 0,
                  message: messagePayload,
                  finish_reason: parser.finishReason ?? "stop",
                },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: Math.ceil((text.length + parser.reasoningText.length) / 4),
                total_tokens: 0,
              },
            }),
            { headers: { "Content-Type": "application/json" } }
          ),
          url: PLAYGROUND_URL,
          headers: {},
          transformedBody: body,
        };
      }

      // Streaming: translate cf_agent frames → OpenAI SSE chunks.
      const encoder = new TextEncoder();
      const responseStream = new ReadableStream({
        async start(controller) {
          const parser = new CfStreamParser(chatId);
          let roleSent = false;
          const enqueue = (payload) => {
            controller.enqueue(encoder.encode(sseChunk(chatId, created, rawModel, payload)));
          };
          try {
            for await (const raw of transport.frames()) {
              if (signal?.aborted) break;
              const event = parser.push(raw);
              if (event) {
                if (event.type === "role" && !roleSent) {
                  enqueue({ delta: { role: "assistant" }, finish_reason: null });
                  roleSent = true;
                } else if (event.type === "reasoning") {
                  enqueue({ delta: { reasoning_content: event.value }, finish_reason: null });
                } else if (event.type === "content") {
                  enqueue({ delta: { content: event.value }, finish_reason: null });
                } else if (event.type === "finish") {
                  enqueue({ delta: {}, finish_reason: event.value ?? "stop" });
                }
              }
              if (parser.error) {
                enqueue({
                  error: {
                    message: parser.error.message,
                    type: "upstream_error",
                    code: `HTTP_${parser.error.status}`,
                  },
                });
                break;
              }
              if (parser.done || timedOut.current) break;
            }
          } catch (error) {
            if (!signal?.aborted) controller.error(error);
          } finally {
            clearTimeout(timer);
            await transport.close().catch(() => {});
            // #10494: a timeout used to fall straight through to a bare
            // [DONE], so a client receiving an empty or partial stream saw
            // an ordinary successful completion. Emit an explicit error
            // chunk first (same shape as the parser.error branch above) so
            // the client can distinguish a timed-out/partial answer from a
            // real completion.
            if (timedOut.current) {
              try {
                enqueue({
                  error: {
                    message: "Cloudflare Playground timed out",
                    type: "timeout_error",
                    code: "HTTP_504",
                  },
                });
              } catch {
                /* stream already torn down */
              }
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        },
      });

      return {
        response: new Response(responseStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: PLAYGROUND_URL,
        headers: {},
        transformedBody: body,
      };
    } finally {
      if (!wantStream) {
        clearTimeout(timer);
        await transport.close().catch(() => {});
      }
    }
  }
}

export default CloudflarePlaygroundExecutor;
