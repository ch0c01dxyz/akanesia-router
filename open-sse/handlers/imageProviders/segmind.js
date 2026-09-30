// Segmind image generation — POST {baseUrl}/{model}, x-api-key, JSON body,
// raw image bytes response (no JSON envelope).
//
// Wire shape verified 2026-09-30 against segmind-python README + segmind-media-skill:
//   POST https://api.segmind.com/v1/{model}
//   headers: { "x-api-key": KEY, "Content-Type": "application/json" }
//   body:    { prompt, aspect_ratio?, output_resolution?, output_format? }
// Docs: https://docs.segmind.com
import { nowSec, sizeToAspectRatio } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

function baseUrlOf(creds) {
  const override = creds?.providerSpecificData?.baseUrl;
  const raw = (typeof override === "string" && override.trim())
    ? override.trim()
    : (PROVIDER_MEDIA["segmind"]?.imageConfig?.baseUrl || "https://api.segmind.com/v1");
  return raw.replace(/\/+$/, "");
}

// The model id is client-controlled and lands in the URL path verbatim —
// reject traversal/query injection (mirrors huggingface adapter guard).
function assertSafeModel(model) {
  if (typeof model !== "string" || !model || model.includes("..") || model.includes("//") || /[?#]/.test(model)) {
    throw new Error(`Segmind: invalid model ID "${model}"`);
  }
}

export default {
  buildUrl: (model, creds) => {
    assertSafeModel(model);
    return `${baseUrlOf(creds)}/${model}`;
  },
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["x-api-key"] = key;
    return headers;
  },
  buildBody: (model, body) => {
    const payload = { prompt: body.prompt };
    // Segmind prefers aspect_ratio over raw size strings.
    const aspectRatio = sizeToAspectRatio(body.size);
    if (aspectRatio) payload.aspect_ratio = aspectRatio;
    return payload;
  },
  // Segmind returns raw image bytes — convert to b64_json
  async parseResponse(response) {
    const buf = await response.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { created: nowSec(), data: [{ b64_json: base64 }] };
  },
  normalize: (responseBody) => responseBody,
};
