// ClovaStudioExecutor — ported from OmniRoute's clova-studio executor.
// Naver CLOVA Studio Chat Completions v3: the model goes in the URL path.
// Request/response translation is handled by the openai↔clova translators.
import { DefaultExecutor } from "./default.js";

export class ClovaStudioExecutor extends DefaultExecutor {
  constructor(provider = "clova-studio") {
    super(provider);
  }

  buildUrl(model) {
    return `${this.config.baseUrl}/${encodeURIComponent(model)}`;
  }
}

export default ClovaStudioExecutor;
