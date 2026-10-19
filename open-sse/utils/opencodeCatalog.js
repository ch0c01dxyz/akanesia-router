/**
 * Live catalog model gratis OpenCode (P2).
 *
 * Sumber: https://models.opencode.ai/api.json — file yang sama dibaca CLI
 * resmi saat boot. Model dianggap free bila cost.input === 0 &&
 * cost.output === 0, tidak deprecated, dan tool_call !== false
 * (logika yang sama dipakai CLI: models-dev.ts).
 *
 * Cache in-memory TTL 24 jam + single-flight: request konkuren berbagi satu
 * fetch. Fail-open: bila fetch gagal, pakai cache basi; bila belum ada cache
 * sama sekali, kembalikan set kosong (caller fallback ke MODEL_MAP hardcoded).
 */

const CATALOG_URL = "https://models.opencode.ai/api.json";
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const FETCH_TIMEOUT_MS = 15_000;

let cache = null; // { freeIds: Set<string>, fetchedAt: number }
let inflight = null; // Promise<Set<string>> | null

function extractFreeIds(catalog) {
  const models = catalog?.opencode?.models;
  if (!models || typeof models !== "object") return null;
  const free = new Set();
  for (const [id, m] of Object.entries(models)) {
    const zeroCost = Number(m?.cost?.input) === 0 && Number(m?.cost?.output) === 0;
    const deprecated = m?.status === "deprecated";
    const usable = m?.tool_call !== false;
    if (zeroCost && !deprecated && usable) free.add(String(id));
  }
  return free;
}

async function fetchCatalog() {
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const json = await res.json();
  const freeIds = extractFreeIds(json);
  if (!freeIds) throw new Error("catalog shape tak dikenal");
  return freeIds;
}

/**
 * Kembalikan Set ID model free dari katalog live (cached 24 jam).
 * Selalu resolve — tidak pernah throw (fail-open).
 */
export async function getFreeModelIds() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CATALOG_TTL_MS) return cache.freeIds;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const freeIds = await fetchCatalog();
      cache = { freeIds, fetchedAt: Date.now() };
      return freeIds;
    } catch {
      // Fail-open: pakai cache basi bila ada, atau set kosong.
      return cache?.freeIds || new Set();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** True bila modelId ada di daftar free katalog live. */
export async function isCatalogFreeModel(modelId) {
  if (!modelId) return false;
  const freeIds = await getFreeModelIds();
  return freeIds.has(String(modelId));
}

/** Status cache untuk diagnostik. */
export function getCatalogStatus() {
  if (!cache) return { cached: false, ageMs: null, count: 0 };
  return { cached: true, ageMs: Date.now() - cache.fetchedAt, count: cache.freeIds.size };
}

/** Reset cache (untuk test). */
export function resetCatalogCache() {
  cache = null;
  inflight = null;
}
