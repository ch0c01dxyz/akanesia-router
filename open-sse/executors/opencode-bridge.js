/**
 * OpenCode Bridge Executor — routes via local `opencode2 serve` subprocess.
 *
 * Architecture (proven by Egar's harness 2026-10-15):
 *   Client → Akanesia-Router → opencode2 serve (127.0.0.1:4096) → opencode.ai
 *
 * The free-tier gate checks that the request originates from the real client
 * process (decolua/9router#4845). This executor runs the real client locally
 * and drives it via its HTTP API, so the gate sees a genuine origin.
 *
 * API shapes verified by Egar's research (shim.js, 2026-10-16):
 *   POST /api/session            { title, model: { providerID, id } } → { data: { id } }
 *   POST /api/session/:id/prompt { text, files?: [{uri, name}] }      → async
 *   GET  /api/session/:id/message → { data: [{ type: "assistant", finish: "stop"|"tool-calls"|"error",
 *                                      content: [{type:"text", text}], tokens: {input,output,reasoning} }] }
 *
 * Quirk: model override via prompt body is IGNORED unless pinned at session
 * create. Always pin model in POST /api/session.
 */

import { BaseExecutor } from "./base.js";
import { ensureBridgeRunning, invalidateBridge } from "../utils/opencodeBridgeSupervisor.js";
import { isCatalogFreeModel } from "../utils/opencodeCatalog.js";

const POLL_INTERVAL_MS = 600;
const STREAM_TIMEOUT_MS = 600000; // 10 min for streaming (tool loops can run long)
const NON_STREAM_TIMEOUT_MS = 55000; // stay under router's 60s abort
const FETCH_TIMEOUT_MS = 30000; // per-call cap so a hung serve API can't stall the poll loop

/** Explicit free-model map (shim.js). Falls back to default if unknown. */
const MODEL_MAP = {
  "cat-jam-free": "cat-jam-free",
  "deepseek-v4.1-flash-free": "deepseek-v4.1-flash-free",
  "jev-1.13-free": "jev-1.13-free",
  "longcat-2.5-preview-free": "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free": "mimo-v2.6-flash-free",
  "muse-spark-1.3-contributor-free": "muse-spark-1.3-contributor-free",
  "nemotron-3-ultra-free": "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free": "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free": "nemotron-3.5-super-vl-free",
  "space-bunny-free": "space-bunny-free",
  "step-5-preview-free": "step-5-preview-free",
  "big-pickle": "big-pickle",
};
const DEFAULT_MODEL = "muse-spark-1.3-contributor-free";

/**
 * Map akanesia-router model ID to opencode model ID.
 * Strips provider prefix (e.g. "oc/mimo-..." → "mimo-...") and variant suffix.
 *
 * Urutan resolusi (P2):
 *  1. MODEL_MAP hardcoded (terverifikasi manual) — menang selalu.
 *  2. Katalog live (cache 24 jam): model free baru otomatis dikenali
 *     tanpa update kode.
 *  3. DEFAULT_MODEL sebagai fallback terakhir.
 */
async function resolveOpencodeModelId(model) {
  const withoutProvider = model.includes("/") ? model.split("/").pop() : model;
  const clean = withoutProvider.replace(/\(.*\)$/, "");
  if (MODEL_MAP[clean]) return MODEL_MAP[clean];
  if (await isCatalogFreeModel(clean)) return clean;
  return DEFAULT_MODEL;
}

/**
 * Flatten OpenAI messages into prompt text + image data URLs.
 * System messages are prefixed as [system instructions].
 */
function extractPrompt(body) {
  let text = "";
  const images = [];
  for (const msg of body.messages || []) {
    if (msg.role === "system") {
      const content = typeof msg.content === "string" ? msg.content : "";
      text += (text ? "\n" : "") + "[system instructions]\n" + content;
      continue;
    }
    if (typeof msg.content === "string") {
      text += (text ? "\n" : "") + msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") text += (text ? "\n" : "") + part.text;
        else if (part.type === "image_url" && part.image_url?.url) images.push(part.image_url.url);
      }
    }
  }
  // Responses API format
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item.type === "message" && item.role === "user") {
        for (const part of item.content || []) {
          if (part.type === "input_text") text += (text ? "\n" : "") + part.text;
          else if (part.type === "input_image" && part.image_url) images.push(part.image_url);
        }
      }
    }
  }
  return { text: text.trim(), images };
}

/** Extract text from a message's content parts. */
function textsOf(msg) {
  return (msg?.content || []).filter((p) => p.type === "text").map((p) => p.text).join("");
}

/** Build OpenAI usage from opencode tokens. */
function buildUsage(msg) {
  const t = msg?.tokens || {};
  return {
    prompt_tokens: t.input || 0,
    completion_tokens: (t.output || 0) + (t.reasoning || 0),
    total_tokens: (t.input || 0) + (t.output || 0) + (t.reasoning || 0),
  };
}

export class OpenCodeBridgeExecutor extends BaseExecutor {
  constructor(provider, config) {
    super(provider, config);
    this.noAuth = true; // Auth via local serve Basic password, not upstream
  }

  transformRequest(model, body, stream, credentials) {
    return body; // Bridge handles raw body in execute()
  }

  buildUrl() {
    return "bridge://opencode"; // Not a real URL; execute() talks to local serve
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const { baseUrl, password } = await ensureBridgeRunning();
    const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
    const headers = { "Content-Type": "application/json", "Authorization": auth };

    const opencodeModelId = await resolveOpencodeModelId(model);
    const { text, images } = extractPrompt(body);
    if (!text && images.length === 0) {
      throw new Error("opencode-bridge: empty prompt (no text or images)");
    }

    const ocFetch = (path, opts = {}) =>
      fetch(`${baseUrl}${path}`, {
        ...opts,
        headers: { ...headers, ...(opts.headers || {}) },
        signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)].filter(Boolean)),
      });

    // 1. Create session with pinned model
    let sessionRes = await ocFetch("/api/session", {
      method: "POST",
      body: JSON.stringify({
        title: "router-bridge",
        model: { providerID: "opencode", id: opencodeModelId },
      }),
    });
    if (sessionRes.status === 401 && password) {
      // Stale bridge (serve died or was killed externally): respawn once and retry.
      invalidateBridge();
      ({ baseUrl, password } = await ensureBridgeRunning());
      sessionRes = await ocFetch("/api/session", {
        method: "POST",
        body: JSON.stringify({
          title: "router-bridge",
          model: { providerID: "opencode", id: opencodeModelId },
        }),
      });
    }
    if (!sessionRes.ok) {
      const t = await sessionRes.text().catch(() => "");
      throw new Error(`opencode-bridge: session create ${sessionRes.status}: ${t.slice(0, 200)}`);
    }
    const sessionData = await sessionRes.json();
    const sessionId = sessionData.data?.id || sessionData.id;
    if (!sessionId) throw new Error("opencode-bridge: no session id in create response");

    // 2. Send prompt (async). Images go in `files` (v2.0.29 PromptInput.files).
    const promptBody = { text };
    if (images.length > 0) {
      promptBody.files = images.map((dataUrl, i) => ({ uri: dataUrl, name: `image-${i + 1}.png` }));
    }
    const promptRes = await ocFetch(`/api/session/${sessionId}/prompt`, {
      method: "POST",
      body: JSON.stringify(promptBody),
    });
    if (!promptRes.ok) {
      const t = await promptRes.text().catch(() => "");
      throw new Error(`opencode-bridge: prompt ${promptRes.status}: ${t.slice(0, 200)}`);
    }

    // 3. Poll until finish === "stop" (skip "tool-calls" — agent mid-loop)
    const timeoutMs = stream ? STREAM_TIMEOUT_MS : NON_STREAM_TIMEOUT_MS;
    const abortableDelay = (ms) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("opencode-bridge: aborted"));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("opencode-bridge: aborted"));
      }, { once: true });
    });

    const pollOnce = async () => {
      const r = await ocFetch(`/api/session/${sessionId}/message`);
      if (!r.ok) return null; // transient; keep polling
      const d = await r.json();
      const msgs = (d.data || [])
        .filter((m) => m.type === "assistant")
        .sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
      return msgs[msgs.length - 1] || null;
    };

    const waitCompletion = async (onProgress = null) => {
      const t0 = Date.now();
      let sentLen = 0;
      while (Date.now() - t0 < timeoutMs) {
        await abortableDelay(POLL_INTERVAL_MS);
        if (signal?.aborted) throw new Error("opencode-bridge: aborted");
        const last = await pollOnce();
        if (last?.finish) {
          if (last.finish === "stop") return last;
          if (last.finish === "error") {
            throw new Error(`opencode-bridge: ${last.error?.message || "upstream error"}`);
          }
          // "tool-calls" → agent mid-loop; keep polling
        }
        // Heartbeat: stream partial text or tick to keep router's SSE alive
        if (onProgress) {
          const partial = textsOf(last);
          const fresh = partial.slice(sentLen);
          if (fresh) {
            sentLen += fresh.length;
            onProgress({ type: "text", text: fresh });
          } else {
            onProgress({ type: "tick" });
          }
        }
      }
      throw new Error("opencode-bridge: poll timeout");
    };

    const responseId = `chatcmpl-ocbridge-${sessionId}`;
    const created = Math.floor(Date.now() / 1000);

    if (!stream) {
      // Non-streaming JSON (55s cap to stay under router's 60s abort)
      const finalMsg = await waitCompletion();
      const jsonBody = JSON.stringify({
        id: responseId, object: "chat.completion", created, model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: textsOf(finalMsg) },
          finish_reason: "stop",
        }],
        usage: buildUsage(finalMsg),
      });
      return {
        response: new Response(jsonBody, {
          status: 200, headers: { "Content-Type": "application/json" },
        }),
        url: "bridge://opencode", headers: {}, transformedBody: {},
      };
    }

    // Streaming SSE — poll inside the stream so heartbeats flow during tool loops
    const encoder = new TextEncoder();
    const sseSend = (controller, obj) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

    const streamBody = new ReadableStream({
      start: async (controller) => {
        try {
          // First event immediately (router opens client stream after first data)
          sseSend(controller, {
            id: responseId, object: "chat.completion.chunk", created, model,
            choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
          });

          let streamedLen = 0;
          const finalMsg = await waitCompletion((progress) => {
            if (progress.type === "text") streamedLen += progress.text.length;
            // Heartbeat as empty-delta event (SSE comments don't reach the client)
            sseSend(controller, {
              id: responseId, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: progress.type === "text" ? { content: progress.text } : {}, finish_reason: null }],
            });
          });

          // Emit text the heartbeats never saw (fast models finish between polls)
          const fullText = textsOf(finalMsg);
          const remainder = fullText.slice(streamedLen);
          if (remainder) {
            sseSend(controller, {
              id: responseId, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: { content: remainder }, finish_reason: null }],
            });
          }
          sseSend(controller, {
            id: responseId, object: "chat.completion.chunk", created, model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: buildUsage(finalMsg),
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          // Bridge error as SSE error event
          sseSend(controller, {
            error: { message: err.message || "bridge error", type: "bridge_error" },
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return {
      response: new Response(streamBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      url: "bridge://opencode", headers: {}, transformedBody: {},
    };
  }
}
