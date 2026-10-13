import { isAnthropicCompatibleProvider } from "@/shared/constants/providers";

const FETCH_TIMEOUT_MS = 60000;

// Satu-satunya tempat yang tahu cara mengambil daftar model dari provider
// kompatibel dinamis (openai-compatible-*/anthropic-compatible-*):
// GET {baseUrl}/models dengan API key koneksi.
// Dipakai oleh: POST /api/providers/check-models, GET /api/v1/models,
// GET /api/providers/[id]/models, POST /api/providers/validate.
// Tidak pernah throw — selalu mengembalikan { ok, models, httpStatus, errorBody }
// atau { ok: false, models: [], error, httpStatus, errorBody }.
export async function fetchCompatibleModels({ provider, baseUrl, apiKey, extraHeaders = {}, fetchFn = fetch }) {
  const clean = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/$/, "") : "";
  if (!clean) {
    return { ok: false, models: [], error: "no baseUrl", httpStatus: 0, errorBody: "" };
  }
  let url = `${clean}/models`;
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (isAnthropicCompatibleProvider(provider)) {
    const base = clean.endsWith("/messages") ? clean.slice(0, -9) : clean;
    url = `${base}/models`;
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    // Default gaya OpenAI (dipakai juga untuk custom embedding nodes).
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  try {
    const res = await fetchFn(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errorBody = await res.text().then((t) => t.slice(0, 2000)).catch(() => "");
      return { ok: false, models: [], error: `HTTP ${res.status}`, httpStatus: res.status, errorBody };
    }
    const json = await res.json().catch(() => null);
    const raw = json?.data ?? json?.models ?? json;
    const ids = (Array.isArray(raw) ? raw : [])
      .map((m) => m?.id || m?.name || m?.model)
      .filter((id) => typeof id === "string" && id.trim() !== "");
    return { ok: true, models: [...new Set(ids)], httpStatus: res.status, errorBody: "" };
  } catch (err) {
    return { ok: false, models: [], error: err?.message || "request failed", httpStatus: 0, errorBody: "" };
  }
}
