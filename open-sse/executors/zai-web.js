// ZaiWebExecutor — Z.ai consumer chat (chat.z.ai) (ported from OmniRoute's
// zai-web executor).
//
// The consumer frontend stores a Bearer JWT in localStorage and requires a
// browser-issued CAPTCHA proof for chat completions. The browser transport is
// the default in the source; callers with a short-lived proof can use the
// direct HTTP path.
//
// Completions go to /api/v2/chat/completions. Z.ai's CAPTCHA rejects true
// headless Chromium with F001, so the source's browser transport uses
// off-screen headed Chromium while retaining the shared browser pool.
//
// PORT STATUS: partial. 9router has no browser backend (no Playwright, no
// browserBackedChat equivalent — same gap as the ported chatgpt-web executor),
// so the browser transport is unavailable: execute() validates everything it
// can, then serves requests carrying a fresh `captcha_verify_param` through the
// fully-ported signed-API path (create chat → signed completion with CAPTCHA
// proof). Requests without a proof return a clear 502 explaining the browser
// gap. A deps seam (`deps.browserTransport.runTurn`) is preserved so a
// browser-backed transport can be plugged in later without touching the
// protocol layer; executors/zai-web/browserAutomation.js (the UI interaction
// steps) is ported alongside for that future backend.
import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import {
  buildZaiCompletionUrl,
  buildZaiHeaders,
  buildZaiNewChatBody,
  buildZaiRequestBody,
  buildZaiSignature,
  collectZaiImageUrls,
  extractZaiToken,
  extractZaiUserId,
  foldMessages,
  getZaiModelCapabilities,
  latestUserPrompt,
  parseZaiFrontendVersion,
  resolveZaiCaptchaVerifyParam,
  resolveZaiThinkingConfig,
  resolveZaiVlmConfig,
  unprefixedModelId,
  ZAI_BASE_URL,
  ZAI_CHAT_URL,
  ZAI_DEFAULT_FE_VERSION,
  ZAI_DEFAULT_MODEL,
  ZAI_FE_VERSION_CACHE_TTL_MS,
  ZAI_NEW_CHAT_URL,
  ZAI_USER_AGENT,
} from "./zai-web/protocol.js";
import {
  buildZaiStreamingBody,
  collectZaiNonStreaming,
  makeZaiChunkEmitter,
} from "./zai-web/stream.js";

let cachedFeVersion = null;

function sanitizeErrorMessage(message) {
  return String(message ?? "")
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function makeErrorResult(status, message, _body, url) {
  const clean = sanitizeErrorMessage(message) || `Z.ai error (HTTP ${status})`;
  return {
    response: new Response(
      JSON.stringify({
        error: { message: clean, type: "upstream_error", code: `HTTP_${status}` },
      }),
      { status, headers: { "Content-Type": "application/json" } }
    ),
    url,
  };
}

/**
 * The call-log body for a browser-transport turn. There is no real upstream
 * request payload to record here, so this reconstructs the equivalent shape the
 * signed-API path logs, from the settings the browser UI would be driven with.
 */
function buildZaiBrowserAuditBody(input) {
  const { thinkingConfig: thinking, vlmConfig: vlm } = input;
  return {
    browser_backed: true,
    image_count: input.imageCount,
    model: input.modelId,
    messages: foldMessages(input.messages),
    enable_thinking: thinking.enabled,
    auto_web_search: vlm.websiteModeEnabled ? false : vlm.webSearchEnabled,
    vlm_tools_enable: vlm.toolsEnabled,
    vlm_web_search_enable: vlm.websiteModeEnabled && vlm.webSearchEnabled,
    vlm_website_mode: vlm.websiteModeEnabled,
    ...(thinking.enabled && thinking.effortSupported ? { reasoning_effort: thinking.effort } : {}),
  };
}

/**
 * Validate the credential and body, and resolve everything both transports need.
 *
 * All four rejections are client errors that must never reach the upstream: no
 * usable session token, no user turn, an image sent to a text-only model, and a
 * JWT with no user id (which the signed-API path needs to build its signature).
 */
function resolveZaiRequest(input) {
  const { body, credentials, model } = input;
  const bodyObj = body || {};
  const fail = (message) => ({ errorResult: makeErrorResult(400, message, body, ZAI_CHAT_URL) });

  const rawCredential = String(credentials?.apiKey ?? credentials?.accessToken ?? "").trim();
  const token = extractZaiToken(rawCredential);
  if (!token) {
    return fail(
      'Missing Z.ai web-session credential — copy the "token" value from chat.z.ai Local Storage.'
    );
  }

  const messages = bodyObj.messages || [];
  const prompt = latestUserPrompt(messages);
  const imageUrls = collectZaiImageUrls(messages);
  if (!prompt && imageUrls.length === 0) {
    return fail("Z.ai requires at least one user message");
  }

  const modelId = bodyObj.model || model || ZAI_DEFAULT_MODEL;
  if (imageUrls.length > 0 && !getZaiModelCapabilities(modelId).vision) {
    return fail(
      `Z.ai model ${unprefixedModelId(modelId)} does not accept image input; use GLM-5.3-Flash.`
    );
  }

  const userId = extractZaiUserId(token);
  if (!userId) {
    return fail(
      "Invalid Z.ai web-session credential — its JWT payload does not contain the required user id."
    );
  }

  return {
    request: {
      captchaVerifyParam: resolveZaiCaptchaVerifyParam(credentials, bodyObj),
      imageUrls,
      messages,
      modelId,
      prompt,
      thinkingConfig: resolveZaiThinkingConfig(modelId, bodyObj),
      token,
      userId,
      vlmConfig: resolveZaiVlmConfig(modelId, bodyObj),
    },
  };
}

export class ZaiWebExecutor extends BaseExecutor {
  /**
   * @param {string} [provider] provider id
   * @param {object} [deps] injection seam for a future browser backend:
   *   deps.browserTransport.runTurn({ token, messages, modelId, thinkingConfig,
   *   vlmConfig, imageUrls, signal }) must resolve to
   *   { status, body (Buffer|Uint8Array), contentType }.
   */
  constructor(provider = "zai-web", deps = {}) {
    super(provider, { id: provider, baseUrl: ZAI_BASE_URL });
    this._browserTransport = deps.browserTransport || null;
  }

  async resolveFrontendVersion(signal) {
    if (cachedFeVersion && cachedFeVersion.expiresAt > Date.now()) {
      return cachedFeVersion.value;
    }
    let version = ZAI_DEFAULT_FE_VERSION;
    try {
      const response = await fetch(`${ZAI_BASE_URL}/`, {
        headers: { Accept: "text/html", "User-Agent": ZAI_USER_AGENT },
        signal,
      });
      if (response.ok) {
        version = parseZaiFrontendVersion(await response.text()) ?? version;
      }
    } catch {
      // The current verified version remains a safe fallback when homepage probing fails.
    }
    cachedFeVersion = {
      value: version,
      expiresAt: Date.now() + ZAI_FE_VERSION_CACHE_TTL_MS,
    };
    return version;
  }

  async createRemoteChat(input) {
    const { userMessageId, payload } = buildZaiNewChatBody(
      input.messages,
      input.modelId,
      input.enableThinking,
      input.reasoningEffort,
      input.vlmConfig
    );
    let response;
    try {
      response = await fetch(ZAI_NEW_CHAT_URL, {
        method: "POST",
        headers: buildZaiHeaders(input.token, { accept: "application/json" }),
        body: JSON.stringify(payload),
        signal: input.signal,
      });
    } catch (error) {
      const message = sanitizeErrorMessage(
        error instanceof Error ? error.message : "unknown network error"
      );
      return {
        errorResult: makeErrorResult(
          502,
          `Z.ai chat creation failed: ${message}`,
          input.originalBody,
          ZAI_NEW_CHAT_URL
        ),
      };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        errorResult: makeErrorResult(
          response.status,
          `Z.ai chat creation error: ${sanitizeErrorMessage(errorText)}`,
          input.originalBody,
          ZAI_NEW_CHAT_URL
        ),
      };
    }
    const result = await response.json().catch(() => null);
    const record = result && typeof result === "object" && !Array.isArray(result) ? result : null;
    const chatId = typeof record?.id === "string" ? record.id : "";
    if (!chatId) {
      return {
        errorResult: makeErrorResult(
          502,
          "Z.ai chat creation returned no chat id",
          input.originalBody,
          ZAI_NEW_CHAT_URL
        ),
      };
    }
    return { chatId, userMessageId };
  }

  async fetchUpstream(completionUrl, reqHeaders, reqBody, body, signal) {
    let upstream;
    try {
      upstream = await fetch(completionUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(reqBody),
        signal,
      });
    } catch (error) {
      const message = sanitizeErrorMessage(
        error instanceof Error ? error.message : "unknown network error"
      );
      return {
        errorResult: makeErrorResult(502, `Z.ai fetch failed: ${message}`, body, ZAI_CHAT_URL),
      };
    }

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "");
      return {
        errorResult: makeErrorResult(
          upstream.status,
          `Z.ai error: ${sanitizeErrorMessage(errorText)}`,
          body,
          ZAI_CHAT_URL
        ),
      };
    }
    return { upstream };
  }

  /**
   * Browser transport (the source's default). 9router has no Playwright browser
   * backend, so without an injected deps.browserTransport this returns a clear
   * 502; with one it drives the turn through the seam and reshapes the result
   * like the source's browserBackedChat result.
   */
  async fetchThroughBrowser(input) {
    if (!this._browserTransport) {
      return {
        errorResult: makeErrorResult(
          502,
          "Z.ai browser transport is unavailable in 9router (no Playwright browser backend is installed). " +
            "Either include a fresh captcha_verify_param with the request to use the direct signed-API path, " +
            "or wire a browser backend via the executor's deps.browserTransport seam.",
          input.body,
          ZAI_CHAT_URL
        ),
      };
    }

    let result;
    try {
      result = await this._browserTransport.runTurn({
        token: input.token,
        messages: input.messages,
        modelId: input.modelId,
        thinkingConfig: input.thinkingConfig,
        vlmConfig: input.vlmConfig,
        imageUrls: input.imageUrls,
        signal: input.signal,
      });
    } catch (error) {
      const message = sanitizeErrorMessage(
        error instanceof Error ? error.message : "browser transport unavailable"
      );
      return {
        errorResult: makeErrorResult(
          502,
          `Z.ai browser transport failed: ${message}`,
          input.body,
          ZAI_CHAT_URL
        ),
      };
    }

    if (result.status < 200 || result.status >= 300) {
      return {
        errorResult: makeErrorResult(
          result.status || 502,
          `Z.ai browser transport failed (status ${result.status || "unknown"})`,
          input.body,
          ZAI_CHAT_URL
        ),
      };
    }

    return {
      upstream: new Response(new Uint8Array(result.body), {
        status: result.status,
        headers: { "Content-Type": result.contentType || "text/event-stream" },
      }),
      auditHeaders: {
        Authorization: "Bearer [REDACTED]",
        "X-9Router-Transport": "browser",
      },
      auditBody: buildZaiBrowserAuditBody({
        messages: input.messages,
        modelId: input.modelId,
        thinkingConfig: input.thinkingConfig,
        vlmConfig: input.vlmConfig,
        imageCount: input.imageUrls.length,
      }),
    };
  }

  /**
   * Signed-API transport: create a chat server-side, then POST the completion with
   * a CAPTCHA proof and a per-request signature. Only reachable when the caller
   * supplied a proof and sent no images.
   */
  async fetchViaSignedApi(request, input) {
    const { body, signal } = input;
    const bodyObj = body || {};
    const { messages, modelId, prompt, thinkingConfig, token, userId, vlmConfig } = request;

    const frontendVersion = await this.resolveFrontendVersion(signal);
    const createdChat = await this.createRemoteChat({
      messages,
      modelId,
      token,
      enableThinking: thinkingConfig.enabled,
      reasoningEffort: thinkingConfig.effort,
      vlmConfig,
      signal,
      originalBody: body,
    });
    if ("errorResult" in createdChat) return createdChat;

    const timestamp = Date.now();
    const requestId = randomUUID();
    const signature = buildZaiSignature({ prompt, requestId, timestamp, userId });
    const completionUrl = buildZaiCompletionUrl({ requestId, timestamp, token, userId });
    const reqHeaders = buildZaiHeaders(token, {
      accept: "text/event-stream",
      frontendVersion,
      signature,
    });
    const reqBody = buildZaiRequestBody({
      body: bodyObj,
      captchaVerifyParam: request.captchaVerifyParam,
      chatId: createdChat.chatId,
      messages,
      modelId,
      prompt,
      userMessageId: createdChat.userMessageId,
      enableThinking: thinkingConfig.enabled,
      reasoningEffort: thinkingConfig.effort,
      reasoningEffortSupported: thinkingConfig.effortSupported,
      vlmConfig,
    });
    const fetched = await this.fetchUpstream(completionUrl, reqHeaders, reqBody, body, signal);
    if ("errorResult" in fetched) return fetched;

    return {
      upstream: fetched.upstream,
      auditHeaders: {
        ...reqHeaders,
        Authorization: "Bearer [REDACTED]",
        "X-Signature": "[REDACTED]",
      },
      auditBody: { ...reqBody, captcha_verify_param: "[REDACTED]" },
    };
  }

  async execute(input) {
    const { body, signal, stream: wantStream } = input;

    const resolved = resolveZaiRequest(input);
    if ("errorResult" in resolved) return resolved.errorResult;
    const request = resolved.request;
    const { imageUrls, messages, modelId, thinkingConfig, token, vlmConfig } = request;

    const useSignedApi = Boolean(request.captchaVerifyParam) && imageUrls.length === 0;
    const fetched = useSignedApi
      ? await this.fetchViaSignedApi(request, input)
      : await this.fetchThroughBrowser({
          body,
          imageUrls,
          messages,
          modelId,
          signal,
          thinkingConfig,
          token,
          vlmConfig,
        });
    if ("errorResult" in fetched) return fetched.errorResult;
    const { upstream, auditHeaders, auditBody } = fetched;

    const id = `chatcmpl-zai-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const sourceBody = upstream.body ?? new ReadableStream({ start: (c) => c.close() });
    const emitChunk = makeZaiChunkEmitter(id, created, modelId);
    if (wantStream) {
      const outStream = buildZaiStreamingBody(sourceBody, emitChunk, signal);
      return {
        response: new Response(outStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: ZAI_CHAT_URL,
        headers: auditHeaders,
        transformedBody: auditBody,
      };
    }

    let answer;
    let reasoning;
    try {
      ({ answer, reasoning } = await collectZaiNonStreaming(sourceBody));
    } catch (error) {
      const message = sanitizeErrorMessage(
        error instanceof Error ? error.message : "invalid upstream stream"
      );
      return makeErrorResult(502, `Z.ai stream failed: ${message}`, body, ZAI_CHAT_URL);
    }
    const message = { role: "assistant", content: answer };
    if (reasoning) message.reasoning_content = reasoning;
    const completion = {
      id,
      object: "chat.completion",
      created,
      model: modelId,
      choices: [{ index: 0, message, finish_reason: "stop" }],
    };
    return {
      response: new Response(JSON.stringify(completion), {
        headers: { "Content-Type": "application/json" },
      }),
      url: ZAI_CHAT_URL,
      headers: auditHeaders,
      transformedBody: auditBody,
    };
  }
}

export default ZaiWebExecutor;
