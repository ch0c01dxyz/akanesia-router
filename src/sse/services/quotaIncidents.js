/**
 * Pencatat insiden kuota untuk ide #4 "Fill-first sadar kuota".
 *
 * Counter in-memory per pasangan koneksi+model, key `${connectionId}|${model}`
 * (sama seperti strike-breaker di antigravityQuota.js). Entri dashboard
 * dipersistensikan via src/lib/db/repos/quotaIncidentsRepo.js.
 *
 * KEPUTUSAN FINAL: modul ini HANYA mengatur visibilitas dashboard. Tidak ada
 * pemblokiran, cooldown, atau backoff di sini — setiap request tetap mencoba
 * koneksi sesuai urutan strategy. Threshold hanya menentukan kapan sebuah
 * pasangan koneksi+model muncul di dashboard.
 *
 * Fail-open: semua kegagalan repo/settings ditangkap dan di-log, tidak pernah
 * dilempar ke pemanggil (alur request tidak boleh rusak gara-gara pencatatan).
 */
import { getSettings } from "@/lib/localDb";
import {
  classifyQuotaError,
  ERROR_CLASSES,
  clampQuotaFailureThreshold,
} from "open-sse/config/quotaErrorClasses.js";
import * as log from "../utils/logger.js";

// Singleton HMR-safe: Map disimpan di globalThis supaya tidak hilang saat
// Next.js dev melakukan hot module replacement (pola checkModelsCache.js).
const G = globalThis;
const STATE_KEY = "__9router_quotaIncidents__";
if (!G[STATE_KEY]) {
  G[STATE_KEY] = {
    // `${connectionId}|${model}` → { count }
    counts: new Map(),
  };
}
const counts = G[STATE_KEY].counts;

function counterKey(connectionId, model) {
  return `${connectionId}|${model ?? ""}`;
}

// Import repo secara lazy di dalam fungsi: menghindari risiko circular import
// (repo berada di lapisan DB) dan aman bila modul repo belum termuat.
async function loadRepo() {
  try {
    return await import("@/lib/db/repos/quotaIncidentsRepo.js");
  } catch (e) {
    log.warn("QUOTA", `quotaIncidentsRepo tidak bisa dimuat, persistensi dashboard dilewati: ${e?.message || e}`);
    return null;
  }
}

// Re-export clamp untuk guard loop & threshold di handlers (chat.js).
export { clampQuotaMaxFallbacks, clampQuotaFailureThreshold } from "open-sse/config/quotaErrorClasses.js";

// Kelas yang menaikkan counter kegagalan beruntun.
const COUNTED_CLASSES = new Set([
  ERROR_CLASSES.RATE_LIMITED,
  ERROR_CLASSES.OVERLOADED,
  ERROR_CLASSES.SERVER_ERROR,
]);

// Kelas yang langsung masuk dashboard tanpa menunggu threshold.
const IMMEDIATE_CLASSES = new Set([
  ERROR_CLASSES.QUOTA_EXHAUSTED,
  ERROR_CLASSES.AUTH_ERROR,
  ERROR_CLASSES.SUSPENDED,
]);

// Kelas yang membuat pemanggil sebaiknya TIDAK retry pasangan ini
// (kredensial salah / payload tidak valid / ditolak kebijakan — retry sia-sia).
// Catatan: nilai ini hanya informatif di return value; perilaku retry/fallback
// existing TIDAK diubah oleh modul ini.
const NON_RETRYABLE_CLASSES = new Set([
  ERROR_CLASSES.AUTH_ERROR,
  ERROR_CLASSES.PAYLOAD_ERROR,
  ERROR_CLASSES.POLICY_REFUSAL,
  ERROR_CLASSES.SUSPENDED,
]);

/**
 * Catat satu kegagalan upstream untuk pasangan koneksi+model.
 * Dipanggil dari baris pertama markAccountUnavailable (src/sse/services/auth.js).
 *
 * Perilaku per kelas:
 * - rate_limited/overloaded/server_error → counter++; bila counter >= threshold
 *   → upsert entri dashboard (update bila sudah ada, jangan duplikat).
 * - quota_exhausted/auth_error → langsung upsert entri dashboard (tanpa threshold).
 * - policy_refusal/payload_error/ignored/unknown → no-op.
 *
 * @param {object} args
 * @param {string} args.connectionId
 * @param {string|null} args.model
 * @param {string|null} args.provider
 * @param {number|string} args.status
 * @param {string} args.errorText
 * @returns {Promise<{ errorClass: string, retryable: boolean }>}
 *   retryable=false berarti pemanggil sebaiknya skip retry untuk pasangan ini
 *   (dokumentatif; tidak mengubah alur existing).
 */
export async function recordFailure({ connectionId, model, provider, status, errorText }) {
  if (!connectionId || connectionId === "noauth") {
    return { errorClass: ERROR_CLASSES.IGNORED, retryable: true };
  }
  const settings = await safeGetSettings();
  const errorClass = classifyQuotaError(status, errorText, {
    provider,
    rules: settings?.providerErrorRules,
  });
  const retryable = !NON_RETRYABLE_CLASSES.has(errorClass);

  // Kelas netral: tidak hitung, tidak masuk dashboard.
  if (!COUNTED_CLASSES.has(errorClass) && !IMMEDIATE_CLASSES.has(errorClass)) {
    return { errorClass, retryable };
  }

  const key = counterKey(connectionId, model);
  const modelKey = model || "";
  const entry = counts.get(key) || { count: 0 };
  entry.count += 1;
  counts.set(key, entry);

  const threshold = clampQuotaFailureThreshold(settings?.quotaFailureThreshold);

  if (IMMEDIATE_CLASSES.has(errorClass) || entry.count >= threshold) {
    const repo = await loadRepo();
    if (repo?.upsertIncident) {
      try {
        await repo.upsertIncident({
          connectionId,
          model: modelKey,
          provider: provider || null,
          errorClass,
          lastError: String(errorText ?? "").slice(0, 500) || null,
          lastStatus: Number.isFinite(Number(status)) ? Number(status) : null,
          failureCount: entry.count,
        });
      } catch (e) {
        log.warn("QUOTA", `upsertIncident gagal untuk ${key}: ${e?.message || e}`);
      }
    }
  }

  return { errorClass, retryable };
}

/**
 * Catat satu keberhasilan untuk pasangan koneksi+model: reset counter dan
 * hapus entri dashboard-nya. Dipanggil dari baris pertama clearAccountError
 * (src/sse/services/auth.js) dan dari hook test provider.
 *
 * @param {string} connectionId
 * @param {string|null} [model] - bila null/undefined, hapus SEMUA counter &
 *   entri dashboard untuk koneksi ini (dipakai test provider yang tidak
 *   terikat satu model).
 */
export async function recordSuccess(connectionId, model = null) {
  if (!connectionId || connectionId === "noauth") return;

  // model null/undefined (mis. test provider, search) → bersihkan SEMUA
  // counter & entri koneksi ini; string (termasuk "") → hanya pasangan itu.
  if (model != null) {
    const modelKey = model || "";
    counts.delete(counterKey(connectionId, modelKey));
  } else {
    const prefix = `${connectionId}|`;
    for (const k of [...counts.keys()]) {
      if (k.startsWith(prefix)) counts.delete(k);
    }
  }

  const repo = await loadRepo();
  if (!repo) return;
  try {
    if (model != null) {
      if (repo.removeIncident) await repo.removeIncident(connectionId, model || "");
    } else if (repo.listIncidents && repo.removeIncident) {
      // Test provider sukses → koneksi sehat lagi: bersihkan semua entrinya.
      const incidents = await repo.listIncidents();
      for (const inc of incidents) {
        if (inc.connectionId === connectionId) {
          await repo.removeIncident(inc.connectionId, inc.model);
        }
      }
    }
  } catch (e) {
    log.warn("QUOTA", `removeIncident gagal untuk ${connectionId}: ${e?.message || e}`);
  }
}

async function safeGetSettings() {
  try {
    return await getSettings();
  } catch (e) {
    log.warn("QUOTA", `getSettings gagal, pakai default: ${e?.message || e}`);
    return null;
  }
}
