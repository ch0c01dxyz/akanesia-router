// Magnific (Mystic) — async submit + poll image adapter.
// POST https://api.magnific.com/v1/ai/mystic → { data: { task_id } }
// GET  https://api.magnific.com/v1/ai/mystic/{task_id} → { data: { status, generated: [urls] } }
// Auth: x-magnific-api-key header.
import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base.js";

const BASE_URL = "https://api.magnific.com/v1/ai/mystic";

export default {
  async: true,
  buildUrl: (_model) => BASE_URL,
  buildHeaders: (creds) => ({
    "Content-Type": "application/json",
    "x-magnific-api-key": creds?.apiKey || creds?.accessToken || "",
  }),
  buildBody: (model, body) => {
    const req = { prompt: body.prompt, model };
    const size = String(body.size || "1024x1024");
    // Magnific aspect ratios are spelled out.
    if (size.includes("1792x1024") || size.includes("1536x1024")) {
      req.aspect_ratio = "widescreen_16_9";
    } else if (size.includes("1024x1792") || size.includes("1024x1536")) {
      req.aspect_ratio = "portrait_9_16";
    } else {
      req.aspect_ratio = "square_1_1";
    }
    req.resolution = "2k";
    if (body.image) req.image_url = body.image;
    return req;
  },
  async parseResponse(response, { headers }) {
    const submitted = await response.json();
    const taskId = submitted?.data?.task_id || submitted?.task_id;
    if (!taskId) throw new Error("Magnific: no task_id in submit response");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(`${BASE_URL}/${taskId}`, { headers });
      if (!r.ok) throw new Error(`Magnific status ${r.status}`);
      const s = await r.json();
      const data = s?.data || s;
      const status = String(data?.status || "").toUpperCase();
      if (status === "COMPLETED") {
        const generated = Array.isArray(data.generated) ? data.generated : [];
        return { data: generated.map((url) => ({ url })) };
      }
      if (status === "FAILED") throw new Error("Magnific generation failed");
    }
    throw new Error("Magnific polling timeout");
  },
  normalize: (responseBody) => {
    const images = Array.isArray(responseBody.data) ? responseBody.data : [];
    return { created: nowSec(), data: images.map((img) => ({ url: img.url || img })) };
  },
};
