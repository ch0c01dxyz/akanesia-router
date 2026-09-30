// TencentAIStudioWebExecutor — Tencent AI Studio (aistudio.tencent.ai) Web Cookie Provider.
// Ported from OmniRoute's tencent-aistudio-web executor.
//
// Routes chat requests through Tencent AI Studio web session via cookie authentication.
// Cookie is read from credentials.apiKey. Model ids map to upstream model names:
//   hy3-g → HunyuanDefault, hunyuan-default → HunyuanDefault, hunyuan-3d → Hunyuan3D
import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { buildErrorBody } from "../utils/error.js";

const AISTUDIO_BASE = "https://aistudio.tencent.ai";

const MODEL_MAP = {
  "hy3-g": "HunyuanDefault",
  "hunyuan-default": "HunyuanDefault",
  "hunyuan-3d": "Hunyuan3D",
};

// Strip a leading "Cookie:" header-name prefix when the user pastes the raw
// header instead of just the cookie value. (Mirrors OmniRoute's
// normalizeCookie / webCookieAuth stripCookieInputPrefix.)
function stripCookieInputPrefix(raw) {
  return raw?.startsWith("Cookie:") ? raw.slice(7).trim() : raw || "";
}

function mergeAbortSignals(primary, secondary) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([primary, secondary]);
  const controller = new AbortController();
  const onAbort = () => controller.abort(primary?.reason ?? secondary?.reason);
  if (primary?.aborted || secondary?.aborted) {
    onAbort();
  } else {
    primary?.addEventListener?.("abort", onAbort, { once: true });
    secondary?.addEventListener?.("abort", onAbort, { once: true });
  }
  return controller.signal;
}

export class TencentAIStudioWebExecutor extends BaseExecutor {
  constructor() {
    super("tencent-aistudio-web", { id: "tencent-aistudio-web", baseUrl: AISTUDIO_BASE });
  }

  async execute(input) {
    const { model, body, credentials, signal, upstreamExtraHeaders } = input;
    const targetModelId = model || "hy3-g";
    const chatUrl = `${AISTUDIO_BASE}/api/chat/${MODEL_MAP[targetModelId] || "HunyuanDefault"}`;

    let cookie = credentials?.apiKey || "";
    if (!cookie) {
      return {
        response: new Response(
          JSON.stringify(
            buildErrorBody(
              401,
              "Tencent AI Studio Cookie is required. Log in to aistudio.tencent.ai and paste your Cookie header."
            )
          ),
          { status: 401, headers: { "Content-Type": "application/json" } }
        ),
        url: chatUrl,
        headers: {},
        transformedBody: body,
      };
    }
    cookie = stripCookieInputPrefix(cookie);

    const targetModel = MODEL_MAP[targetModelId] || "HunyuanDefault";
    const chatBody = body || {};
    const messages = chatBody.messages || [];

    const headers = {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: AISTUDIO_BASE,
      Referer: `${AISTUDIO_BASE}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (upstreamExtraHeaders) Object.assign(headers, upstreamExtraHeaders);

    const upstreamBody = JSON.stringify({ model: targetModel, messages });

    const controller = new AbortController();
    const primary = signal ?? new AbortController().signal;
    const mergedSignal = mergeAbortSignals(primary, controller.signal);
    const timeout = setTimeout(() => controller.abort(), FETCH_CONNECT_TIMEOUT_MS);

    let upstream;
    try {
      upstream = await fetch(chatUrl, {
        method: "POST",
        headers,
        body: upstreamBody,
        signal: mergedSignal,
      });
    } finally {
      clearTimeout(timeout);
    }

    return {
      response: new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      }),
      url: chatUrl,
      headers,
      transformedBody: upstreamBody,
    };
  }
}

const tencentAIStudioWebExecutor = new TencentAIStudioWebExecutor();
export default tencentAIStudioWebExecutor;
