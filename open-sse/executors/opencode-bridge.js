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
 * API (verified):
 *   POST /api/session            → create session + pin model
 *   POST /api/session/:id/prompt → send prompt (async)
 *   GET  /api/session/:id/message → poll history + parts + tool calls
 *
 * Quirk: model override via prompt body is IGNORED unless pinned at session
 * create. Always pin model in POST /api/session.
 */

import { BaseExecutor } from "./base.js";
import { ensureBridgeRunning } from "../utils/opencodeBridgeSupervisor.js";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 120000; // 2 min max per request

/**
 * Extract text content from OpenAI-style messages array.
 * Returns { text, images } where images are data URLs.
 */
function extractPromptContent(body) {
  let text = "";
  const images = [];

  const messages = body.messages || [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // TODO: system prompt handling
    const content = msg.content;
    if (typeof content === "string") {
      text += (text ? "\n" : "") + content;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") {
          text += (text ? "\n" : "") + part.text;
        } else if (part.type === "image_url") {
          const url = part.image_url?.url;
          if (url) images.push(url);
        }
      }
    }
  }

  // Responses API format
  if (body.input && Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item.type === "message" && item.role === "user") {
        for (const part of item.content || []) {
          if (part.type === "input_text") {
            text += (text ? "\n" : "") + part.text;
          } else if (part.type === "input_image") {
            if (part.image_url) images.push(part.image_url);
          }
        }
      }
    }
  }

  return { text, images };
}

/**
 * Map akanesia-router model ID to opencode provider/model.
 * Strips provider prefix (e.g. "opencode/muse-spark-..." → "muse-spark-...").
 */
function toOpencodeModelId(model) {
  // Remove provider prefix if present
  const withoutProvider = model.includes("/") ? model.split("/").pop() : model;
  // Remove variant suffix like (xhigh)
  return withoutProvider.replace(/\(.*\)$/, "");
}

export class OpenCodeBridgeExecutor extends BaseExecutor {
  constructor(provider, config) {
    super(provider, config);
    this.noAuth = true; // Auth is via the local serve Basic password, not upstream
  }

  transformRequest(model, body, stream, credentials) {
    // Bridge handles the raw body; no upstream transformation needed.
    // We pass through so execute() can extract what it needs.
    return body;
  }

  buildUrl() {
    // Not used — bridge talks to local serve, not upstream directly.
    return "http://127.0.0.1:4096/api/session";
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const { baseUrl, password } = await ensureBridgeRunning();
    const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
    const headers = {
      "Content-Type": "application/json",
      "Authorization": auth,
    };

    const opencodeModelId = toOpencodeModelId(model);
    const { text, images } = extractPromptContent(body);

    if (!text && images.length === 0) {
      throw new Error("opencode-bridge: empty prompt (no text or images)");
    }

    // 1. Create session with pinned model (quirk: must pin at create)
    const sessionRes = await fetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: { providerID: "opencode", id: opencodeModelId },
      }),
      signal,
    });
    if (!sessionRes.ok) {
      const t = await sessionRes.text().catch(() => "");
      throw new Error(`opencode-bridge: session create failed ${sessionRes.status}: ${t.slice(0, 200)}`);
    }
    const sessionData = await sessionRes.json();
    const sessionId = sessionData.data?.id || sessionData.id;
    if (!sessionId) {
      throw new Error("opencode-bridge: no session id in create response");
    }

    // 2. Send prompt (async)
    const promptBody = { text };
    if (images.length > 0) promptBody.images = images;
    const promptRes = await fetch(`${baseUrl}/api/session/${sessionId}/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify(promptBody),
      signal,
    });
    if (!promptRes.ok) {
      const t = await promptRes.text().catch(() => "");
      throw new Error(`opencode-bridge: prompt failed ${promptRes.status}: ${t.slice(0, 200)}`);
    }

    // 3. Poll for completion (abort-aware)
    const startTime = Date.now();
    let lastMessageCount = 0;
    const abortableDelay = (ms) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("opencode-bridge: aborted"));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("opencode-bridge: aborted"));
      }, { once: true });
    });

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      if (signal?.aborted) throw new Error("opencode-bridge: aborted");

      const msgRes = await fetch(`${baseUrl}/api/session/${sessionId}/message`, {
        headers,
        signal,
      });
      if (!msgRes.ok) {
        const t = await msgRes.text().catch(() => "");
        throw new Error(`opencode-bridge: message poll failed ${msgRes.status}: ${t.slice(0, 200)}`);
      }
      const msgData = await msgRes.json();
      const messages = msgData.data || [];

      // Find the latest assistant message with text parts
      // Messages are in chronological order; we want the last one
      if (messages.length > lastMessageCount) {
        lastMessageCount = messages.length;
        const lastMsg = messages[messages.length - 1];
        // Check if it's a completed assistant message
        // The API returns parts; we look for text parts in assistant messages
        if (lastMsg.role === "assistant" || lastMsg.role === "system") {
          const parts = lastMsg.parts || [];
          const textParts = parts.filter((p) => p.type === "text" && p.text);
          // If we have text and no pending tool calls, we're done
          // (Simple heuristic: if the last message has text, consider it complete
          // after a short settle delay to catch multi-part responses)
          if (textParts.length > 0) {
            // Wait a bit to ensure no more parts are coming
            await abortableDelay(1000);
            // Re-fetch to get final state
            const finalRes = await fetch(`${baseUrl}/api/session/${sessionId}/message`, {
              headers,
              signal,
            });
            const finalData = await finalRes.json();
            const finalMessages = finalData.data || [];
            return this.buildResponse(finalMessages, stream, model, sessionId);
          }
        }
      }

      await abortableDelay(POLL_INTERVAL_MS);
    }

    throw new Error("opencode-bridge: poll timeout waiting for completion");
  }

  /**
   * Build a fetch Response with SSE stream from opencode messages.
   */
  buildResponse(messages, stream, model, sessionId) {
    // Extract all assistant text
    let fullText = "";
    let totalTokens = { input: 0, output: 0 };

    for (const msg of messages) {
      if (msg.role === "assistant") {
        for (const part of msg.parts || []) {
          if (part.type === "text" && part.text) {
            fullText += part.text;
          }
        }
        // Token usage if available
        if (msg.tokens) {
          totalTokens.input += msg.tokens.input || 0;
          totalTokens.output += msg.tokens.output || 0;
        }
      }
    }

    if (!stream) {
      // Non-streaming: return JSON
      const jsonBody = JSON.stringify({
        id: `chatcmpl-bridge-${sessionId}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: fullText },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: totalTokens.input,
          completion_tokens: totalTokens.output,
          total_tokens: totalTokens.input + totalTokens.output,
        },
      });
      return {
        response: new Response(jsonBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: "bridge://opencode",
        headers: {},
        transformedBody: {},
      };
    }

    // Streaming: build SSE
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        // Send content in chunks
        const chunkSize = 100;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          const chunk = fullText.slice(i, i + chunkSize);
          const sse = `data: ${JSON.stringify({
            id: `chatcmpl-bridge-${sessionId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
              index: 0,
              delta: { content: chunk },
              finish_reason: null,
            }],
          })}\n\n`;
          controller.enqueue(encoder.encode(sse));
        }
        // Done
        const done = `data: ${JSON.stringify({
          id: `chatcmpl-bridge-${sessionId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\ndata: [DONE]\n\n`;
        controller.enqueue(encoder.encode(done));
        controller.close();
      },
    });

    return {
      response: new Response(streamBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      url: "bridge://opencode",
      headers: {},
      transformedBody: {},
    };
  }
}
