// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft, venice, tokenrouter)
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageCfg = (id) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id) => imageCfg(id).baseUrl;

function buildAdapter(cfg, buildUrl) {
  return {
    buildUrl,
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model, body) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
      const full = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      // bodyFields whitelist (e.g. xAI accepts only model/prompt/n/response_format)
      if (Array.isArray(cfg.bodyFields)) {
        const req = {};
        for (const f of cfg.bodyFields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody) => responseBody,
  };
}

export default function createOpenAIAdapter(providerId) {
  const cfg = imageCfg(providerId);
  return buildAdapter(cfg, () => imageUrl(providerId));
}

// Custom OpenAI-compatible providers (openai-compatible-*) have no registry
// entry — the endpoint lives on the connection itself: providerSpecificData.baseUrl
// is the same base the connection uses for /models and /chat/completions.
export function createCompatibleOpenAIAdapter() {
  return buildAdapter({}, (model, credentials) => {
    const base = String(credentials?.providerSpecificData?.baseUrl || "").replace(/\/+$/, "");
    if (!base) throw new Error("Custom provider connection is missing providerSpecificData.baseUrl");
    return `${base}/images/generations`;
  });
}
