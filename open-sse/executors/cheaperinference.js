// CheaperInferenceExecutor — ported from OmniRoute's cheaperinference executor.
//
// The gateway is OpenAI-compatible on both surfaces. Two provider-specific facts:
//  1. `/v1/responses` is STATELESS and REQUIRES `store:false`. We re-add it here
//     after any upstream strip.
//  2. Chat and Responses live at DIFFERENT URLs. The per-model `targetFormat`
//     registry tag decides which surface a model uses.
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelTargetFormat, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";

export class CheaperInferenceExecutor extends BaseExecutor {
  constructor(provider = "cheaperinference") {
    super(provider, PROVIDERS[provider]);
  }

  usesResponsesEndpoint(model) {
    const alias = PROVIDER_ID_TO_ALIAS[this.provider] || this.provider;
    return getModelTargetFormat(alias, model) === "openai-responses";
  }

  buildUrl(model, stream, urlIndex = 0) {
    if (this.usesResponsesEndpoint(model)) {
      return this.config.responsesBaseUrl || this.config.baseUrl;
    }
    return this.config.baseUrl;
  }

  transformRequest(model, body, stream, credentials) {
    const cleanedBody = super.transformRequest(model, body, stream, credentials);
    if (!cleanedBody || typeof cleanedBody !== "object" || Array.isArray(cleanedBody)) {
      return cleanedBody;
    }
    if (!this.usesResponsesEndpoint(model)) {
      // Chat Completions rejects unknown params — never add `store` on that surface.
      return cleanedBody;
    }
    return { ...cleanedBody, store: false };
  }
}

export default CheaperInferenceExecutor;
