// Cache module-level untuk hasil buildModelsList (/v1/models).
//
// Dipisah dari route module agar route ringan (mis. /api/models/alias) bisa
// meng-invalidate tanpa me-bundle seluruh dependency graph /v1/models.
// Catatan: singleton ini berlaku per proses — benar untuk deployment
// single-process (next start); tidak untuk multi-process/cluster.

const MODELS_CACHE_TTL_MS = 30_000;
const modelsCache = new Map(); // key -> { data, expiresAt }

export function modelsCacheKey(kindFilter, skipDynamicFetch) {
  const kinds = Array.isArray(kindFilter) ? [...kindFilter].sort().join(",") : "";
  return `${kinds}|${skipDynamicFetch ? 1 : 0}`;
}

/** Ambil dari cache; null bila miss/kedaluwarsa. */
export function getModelsCache(kindFilter, skipDynamicFetch) {
  const hit = modelsCache.get(modelsCacheKey(kindFilter, skipDynamicFetch));
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  return null;
}

/** Simpan ke cache dengan TTL 30 dtk. */
export function setModelsCache(kindFilter, skipDynamicFetch, data) {
  modelsCache.set(modelsCacheKey(kindFilter, skipDynamicFetch), {
    data,
    expiresAt: Date.now() + MODELS_CACHE_TTL_MS,
  });
}

/** Kosongkan seluruh cache — dipanggil setelah alias Route-Masking berubah. */
export function invalidateModelsCache() {
  modelsCache.clear();
}
