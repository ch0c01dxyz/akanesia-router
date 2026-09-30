// DeepAI — text-to-image via api.deepai.org.
// POST https://api.deepai.org/api/text2img with `api-key` header and
// form-encoded text param → { output_url }. Auth: api-key header.
import { nowSec } from "./_base.js";

const BASE_URL = "https://api.deepai.org/api/text2img";

export default {
  buildUrl: (_model) => BASE_URL,
  buildHeaders: (creds) => ({
    "api-key": creds?.apiKey || creds?.accessToken || "",
  }),
  buildBody: (_model, body) => {
    const params = new URLSearchParams();
    params.set("text", body.prompt || "");
    if (body.size) {
      const [w, h] = String(body.size).split("x").map(Number);
      if (w && h) {
        params.set("width", String(w));
        params.set("height", String(h));
      }
    }
    return params;
  },
  normalize: (responseBody) => {
    const url = responseBody.output_url || responseBody.outputUrl;
    if (!url) throw new Error("DeepAI: no output_url in response");
    return { created: nowSec(), data: [{ url }] };
  },
};
