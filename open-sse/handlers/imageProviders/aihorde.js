// AI Horde — async submit + check polling + status fetch (crowdsourced queue).
// No stored key → anonymous key "0000000000" (works, lowest queue priority).
import { sleep, nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["aihorde"]?.imageConfig?.baseUrl;
const ANON_KEY = "0000000000";
// Horde jobs sit in a public queue: poll gently, allow long waits.
const HORDE_POLL_INTERVAL_MS = 5000;
const HORDE_POLL_TIMEOUT_MS = 600000;

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
    // The horde is a flaky volunteer network (shared IPs get transient
    // 401/429/5xx on the check endpoint) — one bad poll must not kill a
    // generation that has been queueing for minutes. Tolerate a run of
    // consecutive failures, reset on any successful check.
    let consecutiveFailures = 0;
    while (Date.now() < deadline) {
      await sleep(HORDE_POLL_INTERVAL_MS);
      const checkRes = await fetch(`${BASE_URL}/generate/check/${id}`, { headers }).catch(() => null);
      if (!checkRes?.ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= 6) {
          throw new Error(`AI Horde check failed: ${checkRes?.status ?? "network error"}`);
        }
        continue;
      }
      consecutiveFailures = 0;
      const check = await checkRes.json();
      if (check.faulted) throw new Error("AI Horde generation faulted");
      if (check.done) {
        const statusRes = await fetch(`${BASE_URL}/generate/status/${id}`, { headers });
        if (!statusRes.ok) throw new Error(`AI Horde status failed: ${statusRes.status}`);
        return await statusRes.json();
      }
    }
    throw new Error("AI Horde polling timeout");
  },
  normalize: (responseBody) => ({
    created: nowSec(),
    data: (responseBody.generations || []).map((g) => ({ url: g.img })),
  }),
};
