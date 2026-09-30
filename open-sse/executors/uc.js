// UcExecutor — UC (uncensored.com) un-metered "persona" chat as an
// OpenAI-compatible 9router provider.
// Ported from OmniRoute's open-sse/executors/uc.ts (types stripped).
//
// UC is a consumer subscription app with no public API on the persona path. This
// executor reproduces the web app's own persona WebSocket turn:
//   • mint a 60s Clerk `__session` JWT from the durable `__client` cookie
//     (see ./uc/clerkAuth.js), cached per session id and re-minted ~8s early,
//   • open `wss://internal-6.pubyar.com/ws/{uid}?token={jwt}` with only an
//     `Origin` header (see ./uc/ws.js),
//   • send ONE persona frame: current turn as `text` + prior turns as
//     `chat_history` (roles human/assistant), NO max_tokens/direct_params
//     (see ./uc/protocol.js),
//   • stream newline-delimited frames, splitting reasoning
//     (intermediary_message) from the answer (text deltas / raw_text) and
//     branching the explicit error/quota frames (see ./uc/stream.js).
//
// Tools: UC persona has no native function-calling, so tool schemas are injected
// as a prompted `<tool>` contract (the same shared shim the web-cookie providers
// use, ./uc/webTools.js) and parsed back into tool_calls.
//
// Auth refresh: the 60s JWT is minted on demand; when the mint 401/403s the
// durable ~30-day Clerk window has lapsed and the caller is prompted to re-run the
// browserless email login (see ./uc/emailLogin.js).
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { prepareToolMessages, parseToolCallsFromText } from "./uc/webTools.js";
import { buildToolModeResponse } from "./uc/chatgptWebTools.js";
import { UC_BASE_URL, UC_ORIGIN } from "./uc/constants.js";
import { resolveUcCredential } from "./uc/credentials.js";
import { mintUcSessionToken, ucTokenCache } from "./uc/clerkAuth.js";
import { assembleUcTurn } from "./uc/protocol.js";
import { detectUcSoftError, estimateUcTokens } from "./uc/stream.js";
import { runUcTurn } from "./uc/ws.js";
import {
  ucUsesCodestyle,
  ucLooksLikeRefusal,
  parseUcExtraDialects,
  UC_CODESTYLE_HEADER,
} from "./uc/toolDialect.js";
import { extractCurrentTurnMedia, uploadUcTurnMedia } from "./uc/media.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
};

/**
 * Redact bearer material / cookie payloads before they reach error strings.
 * Local equivalent of OmniRoute's sanitizeErrorMessage (9router's utils/error.js
 * has no equivalent).
 */
function sanitizeErrorMessage(msg) {
  if (msg == null) return "";
  let s = String(msg);
  s = s.replace(/("?(?:jwt|token|__client|__session|cookie)"?\s*[:=]\s*)["']?[^"',}\s;]+/gi, "$1[redacted]");
  s = s.replace(/(token=|jwt=)[^&\s"']+/gi, "$1[redacted]");
  s = s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[jwt]");
  return s.slice(0, 500);
}

function errorResponse(status, message, code) {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: sanitizeErrorMessage(message),
        type: status >= 500 ? "provider_error" : "invalid_request_error",
      },
    }),
    { status, headers: JSON_HEADERS }
  );
}

/**
 * Replace the standard `<tool>` contract that prepareToolMessages folded into the
 * assembled text with UC's natural code-style header for guardrailed models. The
 * shared shim always appends its `<tool>` block as the tail; we strip a trailing
 * "Available tools:"-style block only when present and re-lead with the code-style
 * header. Falls back to appending the code-style header when no block is found.
 */
function applyCodestylePreamble(text) {
  // The shared prepareToolMessages injects the tool contract as a system-message
  // that assembleUcTurn folds into `text`. We can't reliably surgically remove it,
  // so we PREPEND the code-style header — it re-frames tool use as prose, and the
  // model prefers the last/clearest instruction. Cheap and safe.
  return `${UC_CODESTYLE_HEADER}\n\n${text}`;
}

/**
 * If the shared `<tool_call>` JSON parser would find nothing but a UC extra dialect
 * (code-style `fn("x")` or Gemini `<tool_code>`) is present, rewrite those calls as
 * canonical `<tool_call>{json}</tool_call>` blocks appended to the answer so the
 * shared buildToolModeResponse parses them uniformly. No-op when the shared parser
 * already sees calls or no extra dialect is present.
 */
function injectExtraDialectCalls(answer, requestedTools, model) {
  const sharedHasCall = !!parseToolCallsFromText(answer, "probe", requestedTools).toolCalls;
  if (sharedHasCall) return answer;
  const extra = parseUcExtraDialects(answer, requestedTools, model);
  if (extra.length === 0) return answer;
  const blocks = extra
    .map(
      (c) =>
        `<tool_call>${JSON.stringify({ name: c.function.name, arguments: c.function.arguments })}</tool_call>`
    )
    .join("\n");
  return `${answer}\n${blocks}`;
}

/**
 * Wrap a Response into the executor wrapper contract
 * `{response, url, headers, transformedBody}` that chatCore requires.
 * `headers`/`transformedBody` are the ACTUAL upstream request capture
 * ("what we sent"); for UC that is the WS handshake headers + the persona
 * frame. Error paths that fail before a frame is assembled pass no capture.
 */
function wrap(response, url, capture) {
  return {
    response,
    url,
    headers: capture?.headers ?? {},
    transformedBody: capture?.transformedBody ?? null,
  };
}

/** Emit one OpenAI chat.completion.chunk. */
function chunk(controller, id, created, model, delta, finish = null) {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
}

/** Classify a UC turn error string into an HTTP status + OpenAI error code. */
function classifyTurnError(error) {
  const low = error.toLowerCase();
  if (low.includes("message_limit_exceeded"))
    return { status: 429, code: "uc_message_limit_exceeded" };
  if (low.includes("paywall_exceeded")) return { status: 429, code: "uc_paywall_exceeded" };
  if (low.includes("rate_limit_exceeded")) return { status: 429, code: "uc_rate_limit_exceeded" };
  if (low.includes("unauthorized") || low.includes("forbidden")) {
    return { status: 401, code: "uc_auth_error" };
  }
  if (low.includes("timed out")) return { status: 504, code: "uc_timeout" };
  if (low.includes("generation_failed")) return { status: 502, code: "uc_generation_failed" };
  return { status: 502, code: "uc_upstream_error" };
}

export class UcExecutor extends BaseExecutor {
  constructor() {
    super("uc", PROVIDERS.uc ?? { id: "uc", baseUrl: UC_BASE_URL });
  }

  async execute(input) {
    // The persona WS URL host is the wrapper `url` for every return path.
    const url = UC_BASE_URL;

    const cred = resolveUcCredential(input.credentials?.providerSpecificData);
    if (!cred) {
      return wrap(
        errorResponse(
          401,
          "UC connection is not configured (missing __client cookie, session id, or uid). Run the email login to bootstrap credentials.",
          "uc_unconfigured"
        ),
        url
      );
    }

    // Mint (or reuse a cached) 60s Clerk session JWT.
    let jwt;
    try {
      jwt = await this.ensureSessionToken(cred, input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /HTTP 40[13]|unauthorized|forbidden/i.test(msg) ? 401 : 502;
      return wrap(
        errorResponse(
          status,
          `UC auth failed: ${sanitizeErrorMessage(msg)}. If this persists the ~30-day Clerk session lapsed — re-run the email login.`,
          status === 401 ? "uc_auth_error" : "uc_upstream_error"
        ),
        url
      );
    }

    const body = input.body ?? {};
    const originalMessages = body.messages ?? [];

    // Vision + doc input (persona blob layer): extract inline images/docs from the
    // current turn, upload each via the presigned-URL flow, and carry the blob
    // refs in the frame. UC parses the blob server-side (image vision, PDF text).
    // Best-effort: upload failures are skipped and the chat proceeds text-only.
    let media = [];
    try {
      const { inline } = extractCurrentTurnMedia(originalMessages);
      if (inline.length) {
        media = await uploadUcTurnMedia(inline, {
          jwt,
          uid: cred.uid,
          signal: input.signal,
          log: input.log ?? undefined,
        });
      }
    } catch {
      media = [];
    }

    // Tool-calling (prompted protocol): inject the <tool> contract into the
    // messages so the model learns the client tools; response side parses the
    // <tool> blocks back into tool_calls. Same shim the web-cookie providers use.
    // For models UC wraps in a hard guardrail that refuses the <tool_call> markup
    // (e.g. gpt-5.5), swap to the natural code-style dialect that slips past it.
    const codestyle = ucUsesCodestyle(input.model);
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(body, originalMessages);

    const assembled = assembleUcTurn(effectiveMessages);
    const text = codestyle ? applyCodestylePreamble(assembled.text) : assembled.text;
    const history = assembled.history;
    if (!text) {
      return wrap(errorResponse(400, "No user message to send to UC.", "uc_empty_request"), url);
    }

    const id = `chatcmpl-uc-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const promptTokens = estimateUcTokens(text);
    const capture = {
      headers: { Origin: UC_ORIGIN },
      transformedBody: {
        model: input.model,
        text,
        chat_history: history,
        ...(media.length ? { media_blob_name: media[0].blobName } : {}),
      },
    };

    // Tool mode: the <tool> protocol is only parseable once the full reply is in
    // hand, so buffer the whole turn, build a chat.completion, and let the shared
    // shim parse <tool> blocks into tool_calls (with a terminal SSE replay for
    // streaming callers). Mirrors every web-cookie provider's tool path.
    if (hasTools) {
      const turn = await runUcTurn({
        jwt,
        uid: cred.uid,
        model: input.model,
        text,
        history,
        media,
        signal: input.signal,
      });
      const errResp = this.turnErrorResponse(turn, url);
      if (errResp) return errResp;

      let answer = turn.content;
      let reasoning = turn.reasoning;

      // AUTO-CURE: a guardrailed model (NOT already code-style) that REFUSED the
      // <tool_call> markup gets ONE retry with the natural code-style dialect,
      // which slips past the vendor guardrail. Only fires on an actual
      // refusal-with-tools, so the working models never take this path.
      const firstHasCall =
        !!parseToolCallsFromText(answer, "probe", requestedTools).toolCalls ||
        parseUcExtraDialects(answer, requestedTools, input.model).length > 0;
      if (!firstHasCall && !codestyle && ucLooksLikeRefusal(answer)) {
        const curedText = applyCodestylePreamble(assembled.text);
        const retry = await runUcTurn({
          jwt,
          uid: cred.uid,
          model: input.model,
          text: curedText,
          history,
          media,
          signal: input.signal,
        });
        if (!retry.error && retry.content) {
          const retryHasCall =
            !!parseToolCallsFromText(retry.content, "probe", requestedTools).toolCalls ||
            parseUcExtraDialects(retry.content, requestedTools, input.model).length > 0;
          if (retryHasCall) {
            answer = retry.content;
            reasoning = retry.reasoning;
            input.log?.debug?.("uc", "tool refusal recovered via code-style retry");
          }
        }
      }

      // Supplement the shared <tool> parser with UC's extra dialects (code-style
      // fn("x") + Gemini <tool_code>). If the shared JSON parser found no calls but
      // an extra dialect did, rewrite the answer's calls as <tool_call> JSON so the
      // shared buildToolModeResponse picks them up uniformly.
      answer = injectExtraDialectCalls(answer, requestedTools, input.model);

      const completionTokens = estimateUcTokens(reasoning + answer);
      const buffered = new Response(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model: input.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: answer,
                ...(reasoning ? { reasoning_content: reasoning } : {}),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        }),
        { status: 200, headers: JSON_HEADERS }
      );
      const response = await buildToolModeResponse(buffered, requestedTools, input.stream, {
        cid: id,
        created,
        model: input.model,
        idSeed: "uc",
      });
      return wrap(response, url, capture);
    }

    if (input.stream) {
      const stream = this.buildStream(input, jwt, cred, text, history, media, id, created);
      return wrap(new Response(stream, { status: 200, headers: SSE_HEADERS }), url, capture);
    }

    // Non-streaming: run the turn to completion, build a chat.completion.
    const turn = await runUcTurn({
      jwt,
      uid: cred.uid,
      model: input.model,
      text,
      history,
      media,
      signal: input.signal,
    });
    const errResp = this.turnErrorResponse(turn, url);
    if (errResp) return errResp;

    const answer = turn.content;
    const reasoning = turn.reasoning;
    const completionTokens = estimateUcTokens(reasoning + answer);
    const response = {
      id,
      object: "chat.completion",
      created,
      model: input.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: answer,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
    return wrap(
      new Response(JSON.stringify(response), { status: 200, headers: JSON_HEADERS }),
      url,
      capture
    );
  }

  /**
   * Convert a failed/soft-errored UC turn into an error Response, or null when
   * the turn is a usable answer. A soft-error apology (short transient capacity
   * message returned AS the answer) is surfaced as a retryable 502 so 9router
   * can fall back instead of handing the user a bogus reply.
   */
  turnErrorResponse(turn, url) {
    if (turn.error) {
      const { status, code } = classifyTurnError(turn.error);
      return wrap(errorResponse(status, `UC persona turn failed: ${turn.error}`, code), url);
    }
    const soft = detectUcSoftError(turn.content);
    if (soft) {
      return wrap(
        errorResponse(502, `UC returned a transient soft-error: ${soft}`, "uc_soft_error"),
        url
      );
    }
    if (!turn.content) {
      return wrap(errorResponse(502, "UC returned an empty response.", "uc_empty_response"), url);
    }
    return null;
  }

  /**
   * Build a live OpenAI SSE stream from a persona turn. Streams reasoning as
   * `reasoning_content` deltas and the answer as `content` deltas, then a
   * terminal `finish_reason: "stop"`. A mid-stream error frame ends the stream
   * with an error delta (best-effort; the tool path buffers instead).
   */
  buildStream(input, jwt, cred, text, history, media, id, created) {
    const model = input.model;
    const self = this;
    return new ReadableStream({
      start: async (controller) => {
        // Prime the stream with the role delta.
        chunk(controller, id, created, model, { role: "assistant" });
        let sawError = null;
        let streamed = "";
        const turn = await runUcTurn({
          jwt,
          uid: cred.uid,
          model,
          text,
          history,
          media,
          signal: input.signal,
          onEvent: (evt) => {
            if (evt.kind === "reasoning") {
              chunk(controller, id, created, model, { reasoning_content: evt.text });
            } else if (evt.kind === "delta") {
              streamed += evt.text;
              chunk(controller, id, created, model, { content: evt.text });
            } else if (evt.kind === "error") {
              sawError = evt.text;
            }
          },
        });

        const err = turn.error ?? sawError;
        // A soft-error apology returned AS the answer is not a real reply — treat
        // it as an error when nothing streamed.
        const soft = !err && !streamed ? detectUcSoftError(turn.content) : null;
        if ((err || soft) && !streamed) {
          const reason = err ?? `transient soft-error: ${soft}`;
          const { code } = classifyTurnError(String(reason));
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                error: {
                  code,
                  message: sanitizeErrorMessage(`UC persona turn failed: ${reason}`),
                  type: "provider_error",
                },
              })}\n\n`
            )
          );
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        // Flush the authoritative final content that wasn't already streamed.
        // Short answers arrive ONLY in the terminal `raw_text` (no text deltas),
        // so `turn.content` is the full answer while `streamed` is empty; emit the
        // remainder as one content delta. When deltas WERE streamed, turn.content
        // equals `streamed` and the remainder is empty (nothing extra emitted).
        const remainder = turn.content.startsWith(streamed)
          ? turn.content.slice(streamed.length)
          : turn.content;
        if (remainder) {
          chunk(controller, id, created, model, { content: remainder });
        }

        chunk(controller, id, created, model, {}, "stop");
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
  }

  /**
   * Return a valid 60s session JWT: reuse the per-session cache when fresh, else
   * mint a new one, persisting any rotated cookies back to the connection.
   * Throws on a hard mint failure (the caller maps it to a 401/502).
   */
  async ensureSessionToken(cred, input) {
    const cached = ucTokenCache.get(cred.sid);
    if (cached) return cached;

    const result = await mintUcSessionToken({
      sid: cred.sid,
      cookies: cred.cookies,
      signal: input.signal,
    });
    if (!result.ok || !result.token) {
      // Persist any rotated cookies even on failure (they may unstick next time).
      await this.persistRotatedCookies(cred, result.rotatedCookies, input);
      throw new Error(result.error || `Clerk mint HTTP ${result.status}`);
    }

    const token = result.token;
    ucTokenCache.set(cred.sid, token);
    await this.persistRotatedCookies(cred, result.rotatedCookies, input);
    return token.jwt;
  }

  /** Merge any rotated cookies into the stored connection credential. */
  async persistRotatedCookies(cred, rotated, input) {
    if (!rotated || Object.keys(rotated).length === 0) return;
    // Only persist when something actually changed vs the stored jar.
    let changed = false;
    const nextCookies = { ...cred.cookies };
    for (const [k, v] of Object.entries(rotated)) {
      if (nextCookies[k] !== v) {
        nextCookies[k] = v;
        changed = true;
      }
    }
    if (!changed) return;
    try {
      // 9router's chatCore does not currently pass onCredentialsRefreshed into
      // execute input; guard with optional chaining like the source does.
      await input.onCredentialsRefreshed?.({
        providerSpecificData: {
          ...(input.credentials?.providerSpecificData ?? {}),
          ucCookies: nextCookies,
          // Keep the durable cookie mirror in sync if it rotated (rare).
          ...(nextCookies.__client ? { ucClientCookie: nextCookies.__client } : {}),
        },
      });
    } catch (err) {
      input.log?.warn?.(
        "uc",
        `rotated-cookie persist failed: ${sanitizeErrorMessage(err instanceof Error ? err.message : err)}`
      );
    }
  }
}
