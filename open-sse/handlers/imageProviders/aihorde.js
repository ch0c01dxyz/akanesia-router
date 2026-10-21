// AI Horde — async submit + check polling + status fetch (crowdsourced queue).
// No stored key → anonymous key "0000000000" (works, lowest queue priority).
import { sleep, nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { HORDE_POLL_INTERVAL_MS, HORDE_POLL_TIMEOUT_MS, HORDE_HTTP_TIMEOUT_MS } from "../../config/hordeImageJobs.js";

const BASE_URL = PROVIDER_MEDIA["aihorde"]?.imageConfig?.baseUrl;
const ANON_KEY = "0000000000";
// Horde jobs sit in a public queue: poll gently, allow long waits.

// Horde requires width/height in multiples of 64, range 64–3072.
function parseSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(typeof size === "string" ? size : "");
  if (!m) return { width: 1024, height: 1024 };
  const snap = (v) => Math.min(3072, Math.max(64, Math.round(v / 64) * 64));
  return { width: snap(Number(m[1])), height: snap(Number(m[2])) };
}

export default {
  async: true,
  buildUrl: () => `${BASE_URL}/generate/async`,
  buildHeaders: (creds) => ({
    "Content-Type": "application/json",
    apikey: creds?.apiKey || creds?.accessToken || ANON_KEY,
    "Client-Agent": "akanesia-router:1.5.0:contact",
  }),
  buildBody: (model, body) => {
    const { width, height } = parseSize(body.size);
    return {
      prompt: body.prompt,
      params: {
        width,
        height,
        steps: 30,
        n: Math.min(10, Math.max(1, body.n || 1)),
        sampler_name: "k_euler_a",
        cfg_scale: 7,
      },
      models: [model],
      nsfw: false,
      censor_nsfw: true,
    };
  },
  async parseResponse(response, { headers }) {
    const { id } = await response.json();
    if (!id) throw new Error("AI Horde did not return a job id");
    const deadline = Date.now() + HORDE_POLL_TIMEOUT_MS;
    // A temporary check failure says nothing about the accepted generation.
    while (Date.now() < deadline) {
      await sleep(HORDE_POLL_INTERVAL_MS);
      const checkRes = await fetch(`${BASE_URL}/generate/check/${id}`, { headers, signal: AbortSignal.timeout(HORDE_HTTP_TIMEOUT_MS) }).catch(() => null);
      if (!checkRes?.ok) {
        await checkRes?.body?.cancel();
        if (checkRes?.status === 404 || checkRes?.status === 410) throw new Error("AI Horde generation expired");
        continue;
      }
      const check = await checkRes.json().catch(() => null);
      if (!check) continue;
      if (check.faulted) throw new Error("AI Horde generation faulted");
      if (check.done) {
        const statusRes = await fetch(`${BASE_URL}/generate/status/${id}`, { headers, signal: AbortSignal.timeout(HORDE_HTTP_TIMEOUT_MS) }).catch(() => null);
        if (!statusRes?.ok) {
          await statusRes?.body?.cancel();
          if (statusRes?.status === 404 || statusRes?.status === 410) throw new Error("AI Horde generation expired");
          continue;
        }
        const status = await statusRes.json().catch(() => null);
        if (status?.faulted) throw new Error("AI Horde generation faulted");
        if (status?.done === true) return status;
      }
    }
    throw new Error("AI Horde polling timeout");
  },
  normalize: (responseBody) => ({
    created: nowSec(),
    data: (responseBody.generations || []).map((g) => ({ url: g.img })),
  }),
};
