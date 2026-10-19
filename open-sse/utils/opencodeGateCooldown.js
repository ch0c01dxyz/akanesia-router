/**
 * Gate cooldown tracker untuk OpenCode direct lanes (P4, diadopsi dari
 * opencode-free-bridge).
 *
 * Saat upstream melempar 403 beruntun (IP throttling / penalti), retry agresif
 * hanya memperpanjang penalti. Modul ini mencatat timestamp penolakan gate
 * per scope; consumer (readiness checker, log diagnostik) memakai statusnya
 * untuk membedakan "throttled" dari "broken".
 *
 * Catatan: executor kita tidak me-retry 403 secara otomatis (retryConfig hanya
 * 429/5xx), jadi modul ini bersifat observasional — titik penekanan untuk
 * logika retry masa depan.
 */

const COOLDOWN_MS = 30_000; // 30 detik, sesuai opencode-free-bridge

// scope -> timestamp penolakan terakhir (ms epoch)
const lastRejection = new Map();

/** Catat penolakan gate (403) untuk sebuah scope. */
export function recordGateRejection(scope = "opencode-direct") {
  lastRejection.set(scope, Date.now());
}

/** True bila scope sedang dalam masa cooldown (403 dalam 30 detik terakhir). */
export function isGateCoolingDown(scope = "opencode-direct") {
  const t = lastRejection.get(scope);
  if (!t) return false;
  return Date.now() - t < COOLDOWN_MS;
}

/** Status cooldown untuk diagnostik: { coolingDown, lastRejectionMsAgo }. */
export function getGateCooldownStatus(scope = "opencode-direct") {
  const t = lastRejection.get(scope);
  if (!t) return { coolingDown: false, lastRejectionMsAgo: null };
  const ago = Date.now() - t;
  return { coolingDown: ago < COOLDOWN_MS, lastRejectionMsAgo: ago };
}

/** Reset state (untuk test). */
export function resetGateCooldown(scope = "opencode-direct") {
  lastRejection.delete(scope);
}

export const GATE_COOLDOWN_MS = COOLDOWN_MS;
