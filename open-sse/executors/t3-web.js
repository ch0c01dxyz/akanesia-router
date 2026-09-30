// T3ChatWebExecutor — T3 Chat web UI (t3.chat/api/chat) via the __Secure-next-auth.session-token cookie.
// Ported from OmniRoute's t3-web executor.
//
// Protocol: POST https://t3.chat/api/chat with JSON body { id, messageParts, model } where messageParts is
// the full conversation history, each message flattened to OpenAI content-parts { type: "text", text } or
// { type: "file", ... }. Streamed responses are SSE with event: message frames whose data is a JSON envelope
// { message: { role, parts }, [key]: delta }; [DONE] terminates the stream. Cookies are sent via `Cookie`
// header with the full browser cookie string pasted by the user.
//
// Model IDs are sent verbatim (source `MODEL_ID_MAP` in this snapshot is empty — no remapping).
// Model aliases: "t3-minimax-m2.1" (default), "t3-claude-opus-4-6", "t3-claude-sonnet-4-6",
// "t3-claude-sonnet-4-6-thinking", "t3-gpt-5.6", "t3-gpt-5.6-thinking",
// "t3-gpt-5.4", "t3-gpt-5.4-thinking", "t3-grok-4-1-fast", "t3-grok-4-1-thinking",
// "t3-gemini-3-pro", "t3-gemini-3-flash", "t3-deepseek-v3-2", "t3-deepseek-v3-2-thinking",
// "t3-kimi-k2.5", "t3-kimi-k2.5-thinking", "t3-qwen3-max", "t3-qwen3-max-thinking",
// "t3-minimax-m2.1-lightning" also select reasoning effort when the request carries one
// (via body.reasoning_effort / body.reasoningEffort; 9router's chatCore does not forward
// reasoningEffort into the executor input, so this only applies when the raw body has it).
//
// Tool calling: the web UI has no native function calling, so we use the text-protocol
// translator (local webTools.js port, same as embedded in adapta-web.js): the OpenAI `tools`
// array is serialized into a prompt contract, and the model's `<tool>{...}</tool>` text
// replies are parsed back into OpenAI `tool_calls`.
import { BaseExecutor } from "./base.js";
import { buildToolAwareResult, serializeToolsToPrompt } from "./t3-web/webTools.js";

const T3_BASE_URLS = [
  "https://t3.chat/api/chat",
  "https://t3chat-ai.vercel.app/api/chat",
  "https://t3chat-inky.vercel.app/api/chat",
];
const T3_SESSION_COOKIE_REGEX = /__Secure-next-auth\.session-token=[^;\s]+/;

// Source MODEL_ID_MAP (release/v3.8.51) is an empty record: no model remapping.
const MODEL_ID_MAP = {};

// Reasoning-capable model IDs that accept `reasoning: { effort }` in the request body.
const REASONING_MODELS = new Set([
  "t3-claude-sonnet-4-6-thinking",
  "t3-gpt-5.6-thinking",
  "t3-gpt-5.4-thinking",
  "t3-grok-4-1-thinking",
  "t3-deepseek-v3-2-thinking",
  "t3-kimi-k2.5-thinking",
  "t3-qwen3-max-thinking",
  "t3-minimax-m2.1-lightning",
  "o3",
  "o4-mini",
  "deepseek-r1",
  "qwen3-235b",
  "qwen3-32b",
  "grok-3-mini",
]);

function sanitizeErrorMessage(message) {
  return String(message ?? "")
    .replace(/__Secure-next-auth\.session-token=[^;\s&"']+/g, "__Secure-next-auth.session-token=[redacted]")
    .replace(/(session-token|Cookie|cookie)[^;\s]{0,24}=[^;\s&"']{8,}/gi, "$1=[redacted]")
    .trim();
}

/** Extract a usable T3 session cookie token from the pasted raw cookie value. */
export function extractSessionCookie(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "MISSING_COOKIE" };
  }
  const trimmed = raw.trim();

  // If it looks like a JSON blob (e.g., browser extension export), find the cookie inside.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const cookies = Array.isArray(parsed) ? parsed : parsed.cookies || [];
      for (const cookie of cookies) {
        if (
          cookie?.name === "__Secure-next-auth.session-token" &&
          typeof cookie?.value === "string" &&
          cookie.value
        ) {
          return { token: cookie.value };
        }
      }
    } catch {
      /* ignore malformed JSON, fall through to regex */
    }
  }

  const match = trimmed.match(T3_SESSION_COOKIE_REGEX);
  if (match) {
    return { token: match[0].split("=")[1] };
  }

  // Maybe they pasted the raw token alone.
  if (!trimmed.includes("=") && !trimmed.includes(";") && trimmed.length > 10) {
    return { token: trimmed };
  }

  return { error: "SESSION_COOKIE_NOT_FOUND" };
}

/** Resolve effective T3 credentials from 9router's credential record. */
export function resolveT3Credentials(credentials) {
  if (!credentials) return { error: "MISSING_COOKIE" };
  const raw =
    credentials.apiKey ||
    credentials.cookie ||
    credentials.cookieValue ||
    credentials.sessionToken ||
    credentials.accessToken ||
    "";
  return extractSessionCookie(raw);
}

/** Apply the model-ID mapping (empty in this snapshot — IDs pass through verbatim). */
export function applyT3ModelMapping(modelId) {
  return MODEL_ID_MAP[modelId] || modelId;
}

/** Flatten OpenAI message content to the T3 parts format. */
export function flattenMessages(messages) {
  return messages.map((msg) => {
    const role = msg.role === "developer" ? "system" : msg.role;
    const parts = [];

    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || typeof part !== "object") continue;
        if (part.type === "text" && part.text) {
          parts.push({ type: "text", text: part.text });
        } else if (part.type === "image_url" && (part.image_url?.url ?? part.url)) {
          const imageUrl = part.image_url?.url ?? part.url;
          if (imageUrl?.startsWith("data:")) {
            parts.push({ type: "file", mediaType: "image/png", url: imageUrl });
          } else {
            parts.push({ type: "text", text: `[Image: ${imageUrl}]` });
          }
        }
      }
    } else {
      parts.push({ type: "text", text: String(msg.content ?? "") });
    }

    return { role, parts };
  });
}

/**
 * Build the T3 request body. Accepts the full flattened message history plus
 * the resolved model ID, plus `reasoningEffort` (may be undefined).
 */
export function buildT3RequestBody(messages, model, stream, reasoningEffort) {
  const body = {
    id: crypto.randomUUID(),
    messageParts: flattenMessages(messages),
    model: applyT3ModelMapping(model),
  };
  if (reasoningEffort && REASONING_MODELS.has(applyT3ModelMapping(model))) {
    body.reasoning = { effort: reasoningEffort };
  }
  void stream;
  return body;
}

function errorResponse(message, status = 502) {
  return new Response(JSON.stringify({ error: { message: sanitizeErrorMessage(message) } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resolveSessionCookie(input) {
  const apiKey = input.apiKey ?? input.credentials?.apiKey ?? input.credentials?.cookie ?? "";
  return extractSessionCookie(apiKey);
}

function textChunk(model, content) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-t3-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

/** Parse the T3 SSE stream, forwarding plain-text content to the callback. */
async function streamT3Response(resp, onText, signal) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";

  const processLine = (line) => {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      return;
    }
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      throw { done: true };
    }
    if (!data) return;
    if (currentEvent === "message" || !currentEvent) {
      try {
        const parsed = JSON.parse(data);
        const msg = parsed.message;
        const msgRole = typeof msg?.role === "string" ? msg.role : undefined;
        const isMessageLike =
          msgRole === "assistant" ||
          (msgRole === undefined && typeof parsed.text === "string");
        if (!isMessageLike || !msg) return;
        let msgText = "";
        if (Array.isArray(msg.parts)) {
          msgText = msg.parts
            .filter((p) => p && p.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("");
        } else if (typeof msg.text === "string") {
          msgText = msg.text;
        }
        if (msgText) onText(msgText);
      } catch (e) {
        if (e?.done) throw e;
        /* skip malformed lines */
      }
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw new Error("Request aborted");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    }
    if (buffer.trim()) processLine(buffer.trim());
  } catch (e) {
    if (!e?.done) throw e;
  } finally {
    reader.releaseLock();
  }
}

/** POST to the T3 mirrors in order, returning the first success. */
async function fetchT3(urls, init, signal) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { ...init, signal });
      if (response.ok) return { response, url };
      const text = await response.text().catch(() => "");
      lastError = new Error(`T3 request failed with status ${response.status}: ${text.slice(0, 500)}`);
      if (response.status === 401 || response.status === 403) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("T3 request failed on all mirrors");
}

export class T3ChatWebExecutor extends BaseExecutor {
  constructor() {
    super("t3-web", { id: "t3-web", baseUrl: T3_BASE_URLS[0] });
  }

  async execute(input) {
    const model = input.model || input.body?.model || "t3-minimax-m2.1";
    const stream = input.stream !== false;
    const body = input.body ?? {};
    const session = resolveSessionCookie(input);
    if (session.error) {
      const message =
        session.error === "SESSION_COOKIE_NOT_FOUND"
          ? "Could not find __Secure-next-auth.session-token in the provided cookie value"
          : "Missing T3 session cookie";
      return {
        response: errorResponse(message, 400),
        url: T3_BASE_URLS[0],
        headers: {},
        transformedBody: null,
      };
    }

    const tools = Array.isArray(body.tools) ? body.tools : [];
    const requestedTools = tools.length > 0 ? tools : undefined;
    const reasoningEffort = body.reasoning_effort ?? body.reasoningEffort;

    // Request-side tool contract: serialize OpenAI `tools` into a prompt
    // contract the plain-text web UI can follow (text-protocol translation).
    let messages = Array.isArray(body.messages) ? body.messages : [];
    if (requestedTools) {
      const toolPrompt = serializeToolsToPrompt(requestedTools);
      if (toolPrompt) {
        messages = [{ role: "system", content: toolPrompt }, ...messages];
      }
    }

    const t3Body = buildT3RequestBody(messages, model, stream, reasoningEffort);
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Referer: "https://t3.chat/",
      Origin: "https://t3.chat",
      Cookie: `__Secure-next-auth.session-token=${session.token}`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    };

    try {
      const { response: resp } = await fetchT3(
        T3_BASE_URLS,
        { method: "POST", headers, body: JSON.stringify(t3Body) },
        input.signal
      );

      const id = `chatcmpl-t3-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);

      if (stream) {
        let fullText = "";
        const t3Stream = new ReadableStream({
          start: (controller) => {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
                })}\n\n`
              )
            );
            streamT3Response(resp, (text) => {
              fullText += text;
              controller.enqueue(encoder.encode(textChunk(model, text)));
            }, input.signal)
              .then(() => {
                // Response-side tool parsing: resolve <tool>{...}</tool> blocks.
                if (requestedTools) {
                  const parsed = buildToolAwareResult(fullText, requestedTools, `call-${Date.now()}`);
                  if (parsed.toolCalls?.length) {
                    for (let i = 0; i < parsed.toolCalls.length; i++) {
                      const tc = parsed.toolCalls[i];
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({
                            id,
                            object: "chat.completion.chunk",
                            created,
                            model,
                            choices: [
                              {
                                index: 0,
                                delta: {
                                  tool_calls: [
                                    {
                                      index: i,
                                      id: tc.id,
                                      type: tc.type,
                                      function: { name: tc.name, arguments: tc.arguments },
                                    },
                                  ],
                                },
                                finish_reason: null,
                              },
                            ],
                          })}\n\n`
                        )
                      );
                    }
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          id,
                          object: "chat.completion.chunk",
                          created,
                          model,
                          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
                        })}\n\n`
                      )
                    );
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                    return;
                  }
                }
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                    })}\n\n`
                  )
                );
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              })
              .catch((err) => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      error: { message: sanitizeErrorMessage(err.message) },
                    })}\n\n`
                  )
                );
                controller.close();
              });
          },
          cancel: () => {
            try {
              resp.body.cancel();
            } catch {
              /* ignore */
            }
          },
        });
        return {
          response: new Response(t3Stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          }),
          url: T3_BASE_URLS[0],
          headers: {},
          transformedBody: { model: applyT3ModelMapping(model) },
        };
      }

      let fullText = "";
      await streamT3Response(resp, (text) => {
        fullText += text;
      }, input.signal);

      // Response-side tool parsing for non-stream.
      if (requestedTools) {
        const parsed = buildToolAwareResult(fullText, requestedTools, `call-${Date.now()}`);
        if (parsed.toolCalls?.length) {
          return {
            response: new Response(
              JSON.stringify({
                id,
                object: "chat.completion",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: parsed.content?.trim() || null,
                      tool_calls: parsed.toolCalls.map((tc) => ({
                        id: tc.id,
                        type: tc.type,
                        function: { name: tc.name, arguments: tc.arguments },
                      })),
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
              }),
              { headers: { "Content-Type": "application/json" } }
            ),
            url: T3_BASE_URLS[0],
            headers: {},
            transformedBody: { model: applyT3ModelMapping(model), toolCalls: parsed.toolCalls.length },
          };
        }
        fullText = parsed.content;
      }

      return {
        response: new Response(
          JSON.stringify({
            id,
            object: "chat.completion",
            created,
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
          { headers: { "Content-Type": "application/json" } }
        ),
        url: T3_BASE_URLS[0],
        headers: {},
        transformedBody: { model: applyT3ModelMapping(model) },
      };
    } catch (err) {
      const message = sanitizeErrorMessage(
        err instanceof Error ? err.message : "T3 executor error"
      );
      return {
        response: errorResponse(message),
        url: T3_BASE_URLS[0],
        headers: {},
        transformedBody: { model },
      };
    }
  }
}

export default T3ChatWebExecutor;
