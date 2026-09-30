// PollinationsExecutor — ported from OmniRoute's pollinations executor.
// Pollinations (gen.pollinations.ai) is OpenAI-compatible; anonymous (keyless)
// requests work for free models, premium models need an API key.
// NOTE: OmniRoute's version routes anonymous traffic through a fingerprint
// session pool to soften upstream rate limits; 9router has no such pool, so
// anonymous requests go direct (functional, may hit upstream 429 sooner).
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/** Premium Pollinations models — upstream answers 401 UNAUTHORIZED without a key. */
const PREMIUM_MODELS = new Set([
  "claude",
  "claude-fast",
  "claude-large",
  "gemini",
  "gemini-fast",
  "midijourney",
  "midijourney-large",
]);

function premiumModelRequiresKeyError(model) {
  const err = new Error(
    `Pollinations model "${model}" requires an API key. ` +
      `Free keyless models: openai, openai-fast, openai-large, qwen-coder, mistral, deepseek, grok, gemini-flash-lite-3.1, perplexity-fast, perplexity-reasoning. ` +
      `Get a Pollinations API key at https://enter.pollinations.ai and add it in Settings → API Keys.`
  );
  err.status = 401;
  err.type = "authentication_error";
  return err;
}

export class PollinationsExecutor extends BaseExecutor {
  constructor(provider = "pollinations") {
    super(provider, PROVIDERS[provider] || { format: "openai" });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || "https://gen.pollinations.ai/v1/chat/completions";
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (stream) headers.Accept = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    if (body && typeof body === "object") {
      body.model = model;
      body.stream = stream;
      // Pollinations treats jsonMode=true as "the model MUST return JSON" and
      // rejects (HTTP 400) requests whose messages don't mention "json".
      // Only enable it when the caller actually asked for JSON output.
      const responseFormatType = body.response_format?.type;
      if (responseFormatType === "json_object" || responseFormatType === "json_schema") {
        body.jsonMode = true;
      }
    }
    return body;
  }

  async execute(input) {
    const isAnonymous = !input.credentials?.apiKey && !input.credentials?.accessToken;
    if (!isAnonymous) return super.execute(input);

    // Fail fast with guidance instead of dispatching an anonymous request whose
    // 401 would be recorded against the keyless connection's health.
    const requestedModel = input.model || "";
    if (PREMIUM_MODELS.has(requestedModel)) {
      throw premiumModelRequiresKeyError(requestedModel);
    }

    try {
      return await super.execute(input);
    } catch (err) {
      if (err?.status === 401 || err?.statusCode === 401) {
        const model = input.model || "";
        if (PREMIUM_MODELS.has(model)) throw premiumModelRequiresKeyError(model);
      }
      throw err;
    }
  }
}

export default PollinationsExecutor;
