// Per-provider rate-limit retry delay override (detik, dari
// settings.providerRetryDelaySeconds). Murni: tidak menyentuh DB, jadi
// mudah dites. null = tidak diatur ("Auto") -> backoff mesin yang ada.

export function normalizeRetryDelaySeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.floor(seconds);
}

// candidates: id provider yang dicoba berurutan (id kanonis dulu, lalu
// mentah) — pemenang pertama yang valid dipakai.
export function resolveProviderRetryDelayMs(retryDelayMap, candidates) {
  if (!retryDelayMap || typeof retryDelayMap !== "object") return null;
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    if (typeof candidate !== "string" || !candidate) continue;
    const seconds = normalizeRetryDelaySeconds(retryDelayMap[candidate]);
    if (seconds !== null) return seconds * 1000;
  }
  return null;
}
