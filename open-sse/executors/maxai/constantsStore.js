/**
 * MaxAI signing-constants store + `ensure` gate (ported from OmniRoute's
 * executors/maxai/constantsStore.ts).
 *
 * This is the persistence + freshness layer around ./constants.js:
 *   - `ensureMaxaiConstants()` is the gate every signed path calls: it returns a
 *     usable constants object, extracting on a cold store, and is cheap
 *     (in-process memo) on the hot path.
 *   - `refreshMaxaiConstants()` force re-extracts so a MaxAI-side rotation is
 *     picked up within a day.
 *
 * Design: there is NO hardcoded fallback for the secret keys. If the store is
 * empty AND a live extraction cannot be validated, the signer has no keys and
 * MaxAI is simply unconfigured (callers surface a clear auth error) — we never
 * sign with a guessed/stale secret.
 *
 * PORT NOTE: OmniRoute persisted the extracted constants in its settings DB
 * (`@/lib/db/settings`). 9router has no equivalent settings store, so
 * `getStoredMaxaiConstants()` always returns null and `persistMaxaiConstants()`
 * is a no-op — the in-process memo + live extraction still work, meaning the
 * first request in a fresh process re-extracts from the public bundle (a few
 * extra unauthenticated fetches to www.maxai.co). If 9router gains a durable
 * settings store, wire it into those two functions.
 */
import {
  MAXAI_CONSTANTS_SETTINGS_KEY,
  fetchMaxaiConstants,
  validateMaxaiConstants,
  MAXAI_DEFAULT_HEADER_NAMES,
} from "./constants.js";

/** In-process memo so the hot signing path never touches the network. */
let memo = null;
let inflight = null;

/** Reset the in-process memo (tests + after a forced refresh). */
export function resetMaxaiConstantsMemo() {
  memo = null;
  inflight = null;
}

/**
 * Test seam: directly seed the in-process memo so unit tests that exercise the
 * signed network functions don't need to also mock the bundle fetch. Not used in
 * production paths.
 */
export function __setMaxaiConstantsForTest(constants) {
  memo = constants;
  inflight = null;
}

/** Shape-guard a persisted record before trusting it. */
function isUsableConstants(v) {
  if (!v || typeof v !== "object") return false;
  return (
    typeof v.hmacKey === "string" &&
    typeof v.aesKey === "string" &&
    typeof v.appVersion === "string" &&
    typeof v.ctxKey === "string" &&
    typeof v.docIdKey === "string" &&
    !!v.headerNames &&
    typeof v.headerNames === "object"
  );
}

/**
 * Read the persisted constants from settings (validated). Null when
 * absent/invalid. PORT: no settings DB in 9router — always null.
 */
export async function getStoredMaxaiConstants() {
  void MAXAI_CONSTANTS_SETTINGS_KEY;
  void isUsableConstants;
  void validateMaxaiConstants;
  void MAXAI_DEFAULT_HEADER_NAMES;
  return null;
}

/** Persist a freshly-extracted+validated constants set. PORT: no-op in 9router. */
export async function persistMaxaiConstants(constants) {
  void constants;
  // Non-fatal by design: a persist failure just means the next process re-extracts.
}

/**
 * Return usable MaxAI signing constants, extracting on a cold store.
 * Order: in-process memo → persisted store → live extraction (validated) → null.
 * Concurrent callers share a single in-flight extraction. Never throws.
 */
export async function ensureMaxaiConstants(opts = {}) {
  if (memo) return memo;

  const stored = await getStoredMaxaiConstants();
  if (stored) {
    memo = stored;
    return memo;
  }

  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fresh = await fetchMaxaiConstants(opts);
      if (fresh) {
        memo = fresh;
        await persistMaxaiConstants(fresh);
        return fresh;
      }
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Force a live re-extraction (used by the daily token refresh). If the fetched
 * set validates AND differs from what's memoized, it is persisted + memoized so
 * a MaxAI-side rotation is picked up. Returns the current-best constants (the
 * fresh set on success, else whatever was already memoized). Never throws.
 */
export async function refreshMaxaiConstants(opts = {}) {
  let fresh = null;
  try {
    fresh = await fetchMaxaiConstants(opts);
  } catch {
    fresh = null;
  }

  if (fresh) {
    const changed =
      !memo ||
      memo.hmacKey !== fresh.hmacKey ||
      memo.aesKey !== fresh.aesKey ||
      memo.appVersion !== fresh.appVersion ||
      memo.ctxKey !== fresh.ctxKey ||
      memo.docIdKey !== fresh.docIdKey;
    memo = fresh;
    if (changed) await persistMaxaiConstants(fresh);
    return fresh;
  }

  // Fetch failed — keep serving whatever we already have (memo or store).
  return memo ?? (await getStoredMaxaiConstants());
}
