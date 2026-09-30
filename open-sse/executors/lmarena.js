/**
 * LMArenaExecutor — Arena (formerly LMArena) web-session provider.
 * Ported from OmniRoute's lmarena executor (lmarena.ts + helpers).
 *
 * Routes requests through arena.ai create-evaluation with session cookies.
 * Upstream sits behind Cloudflare; traffic goes through a wreq-js Chrome
 * impersonation session with isolated ephemeral cookies (see ./lmarena/tlsClient.js).
 *
 * Helpers: ./lmarena/{cookie,models,stream,response,directModels,tlsClient,error}.js
 */
import { v7 as uuidv7 } from "uuid";
import { BaseExecutor } from "./base.js";
import { tlsFetchLMArena, TlsClientUnavailableError } from "./lmarena/tlsClient.js";
import { readLMArenaCookie, reconstructLMArenaCookie } from "./lmarena/cookie.js";
import { sanitizeLMArenaError } from "./lmarena/error.js";
import {
  LMARENA_STREAM_URL,
  LMARENA_USER_AGENT,
  buildLmarenaBrowserHeaders,
  markLMArenaCatalogModelDead,
  normalizeLMArenaModelsForCatalog,
  parseLMArenaInitialModels,
  pickLMArenaModelId,
  resolveLMArenaModelId,
} from "./lmarena/models.js";
import { formatArenaPrompt, parseArenaSSE } from "./lmarena/stream.js";
import {
  buildArenaUpstreamHttpResponse,
  createOpenAIArenaStream,
  handleNonStreamingArenaResponse,
  mapFailedTlsResult,
  mapNetworkError,
  mapTlsUnavailable,
  missingCookieResult,
} from "./lmarena/response.js";

export {
  reconstructLMArenaCookie,
  normalizeLMArenaModelsForCatalog,
  parseLMArenaInitialModels,
  pickLMArenaModelId,
  parseArenaSSE,
  markLMArenaCatalogModelDead,
  LMARENA_USER_AGENT,
};
export { clearLMArenaDeadCatalogModels } from "./lmarena/models.js";

function isTlsClientUnavailableError(error) {
  try {
    return error instanceof TlsClientUnavailableError;
  } catch {
    // A rejected Proxy may throw while instanceof walks its prototype chain.
    return false;
  }
}

/** Optional browser-issued reCAPTCHA v3 token (operator-supplied). */
function readRecaptchaToken(credentials, body) {
  const fromObj = (v) => {
    if (!v || typeof v !== "object") return null;
    const rec = v;
    const direct = rec.recaptchaV3Token ?? rec.recaptchaToken;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const psd = rec.providerSpecificData;
    if (psd && typeof psd === "object") {
      const t = psd.recaptchaV3Token ?? psd.recaptchaToken;
      if (typeof t === "string" && t.trim()) return t.trim();
    }
    return null;
  };
  return fromObj(credentials) ?? fromObj(body);
}

export class LMArenaExecutor extends BaseExecutor {
  constructor(providerConfig = {}) {
    super("lmarena", { format: "openai", ...providerConfig });
  }

  buildUrl(_model, _credentials) {
    return LMARENA_STREAM_URL;
  }

  buildRequestHeaders(_model, credentials, _body) {
    const cookie = readLMArenaCookie(credentials);
    const headers = buildLmarenaBrowserHeaders({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    });
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  transformRequest(body, model, credentials) {
    const openaiBody = body && typeof body === "object" ? body : {};
    const messages = Array.isArray(openaiBody.messages) ? openaiBody.messages : [];
    return {
      id: uuidv7(),
      mode: "direct-battle",
      modelAId: model,
      userMessageId: uuidv7(),
      modelAMessageId: uuidv7(),
      userMessage: {
        content: formatArenaPrompt(messages),
        experimental_attachments: [],
        metadata: {},
      },
      modality: "chat",
      recaptchaV3Token: readRecaptchaToken(credentials, body),
    };
  }

  async execute(input) {
    const { model, body, stream, credentials, signal, log } = input;
    const url = this.buildUrl(model, credentials);
    const headers = this.buildRequestHeaders(model, credentials, body);
    const cookie = readLMArenaCookie(credentials);

    if (!cookie) {
      return missingCookieResult(url, headers, this.transformRequest(body, model, credentials));
    }

    const arenaModelId = await resolveLMArenaModelId(model, log);
    const transformedBody = this.transformRequest(body, arenaModelId, credentials);

    log?.info?.(
      "LMArenaExecutor",
      arenaModelId === model
        ? `Executing request for model: ${model}`
        : `Executing request for model: ${model} (${arenaModelId})`
    );

    try {
      return await this.dispatchTls(url, headers, transformedBody, {
        model,
        arenaModelId,
        stream: !!stream,
        signal,
        log,
      });
    } catch (error) {
      if (isTlsClientUnavailableError(error)) {
        log?.error?.("LMArenaExecutor", `TLS client unavailable: ${sanitizeLMArenaError(error)}`);
        return mapTlsUnavailable(url, headers, transformedBody);
      }
      const logMessage = sanitizeLMArenaError(error);
      log?.error?.("LMArenaExecutor", `Request failed: ${logMessage}`);
      return mapNetworkError(url, headers, transformedBody);
    }
  }

  async dispatchTls(url, headers, transformedBody, ctx) {
    const tlsResult = await tlsFetchLMArena(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal: ctx.signal,
      stream: ctx.stream,
    });

    const failed = mapFailedTlsResult({
      status: tlsResult.status,
      text: tlsResult.text,
      hasRecaptcha: transformedBody.recaptchaV3Token != null,
      model: ctx.model,
      arenaModelId: ctx.arenaModelId,
      url,
      headers,
      transformedBody,
    });
    if (failed) return failed;

    const upstream = buildArenaUpstreamHttpResponse({
      stream: ctx.stream,
      status: tlsResult.status,
      text: tlsResult.text,
      body: tlsResult.body,
    });

    const response = ctx.stream
      ? await this.handleStreamingResponse(upstream, ctx.model, ctx.signal, ctx.log)
      : await handleNonStreamingArenaResponse(upstream, ctx.model);

    return { response, url, headers, transformedBody };
  }

  async handleStreamingResponse(response, model, signal, log) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const out = createOpenAIArenaStream({ reader, model, signal, log });
    return new Response(out, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
}

const lmArenaExecutor = new LMArenaExecutor();
export default lmArenaExecutor;
