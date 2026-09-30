// Auto Sync Check Models — scheduler server-side (ide #6).
// Menjalankan check models berkala untuk provider yang di-ON-kan user
// (settings.autoSyncProviderIds), memakai interval dari
// settings.checkModelsTtlSeconds. Hasil ditulis ke cache ide #3
// (satu sumber data dengan route /api/providers/check-models) via
// checkProviderModels({ forceRefresh: true }).
//
// Idiom: recursive setTimeout (self-scheduling) — jadwal berikutnya dipasang
// setelah tick selesai, jadi tidak ada overlap by construction. Singleton di
// globalThis agar HMR tidak menggandakan scheduler. Timer di-unref agar
// tidak menahan proses exit. Fail-open: error tick tidak membunuh loop.

import { getSettings } from "@/lib/db/repos/settingsRepo.js";

const G = globalThis;
const KEY = "__9router_checkModelsAutoSync__";

// Batas atas setTimeout Node: 2^31 - 1 ms (~24,8 hari); di atas itu overflow.
const MAX_DELAY_MS = 2147483647;
// Concurrency antar-provider per tick (route check-all memakai 5; auto-sync
// berjalan di latar sehingga lebih konservatif).
const PROVIDER_CONCURRENCY = 3;
// Jeda tick pertama setelah start — beri waktu server settle setelah boot.
const INITIAL_DELAY_MS = 60 * 1000;
// Interval fallback bila TTL tidak valid / <= 0 (cache mati): tick tetap
// dijadwalkan ulang agar perubahan setting nanti langsung berlaku.
const FALLBACK_INTERVAL_MS = 3600 * 1000;

function ambilState() {
  if (!G[KEY]) {
    G[KEY] = { berjalan: false, timer: null, tickBerjalan: false };
  }
  return G[KEY];
}

// --- Helper murni (di-export untuk unit test) ---------------------------------

/**
 * Clamp delay setTimeout: minimal 1 detik, maksimal 2^31-1 ms (anti overflow).
 * Nilai tidak valid / <= 0 -> interval fallback.
 */
export function clampDelayMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_INTERVAL_MS;
  return Math.min(Math.max(1000, Math.floor(n)), MAX_DELAY_MS);
}

/**
 * Normalisasi TTL detik dari settings. NaN/negatif/nol -> 0
 * (artinya: skip run, cache mati).
 */
export function normalisasiTtl(ttlSeconds) {
  const n = Number(ttlSeconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Normalisasi daftar provider ID dari settings. Bukan array -> []. */
export function normalisasiProviderIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * Batch sederhana: proses ids per kelompok `limit`, tiap batch via
 * Promise.allSettled (satu provider gagal tidak menghentikan yang lain).
 * Mengembalikan array hasil settled dengan urutan sesuai input.
 */
export async function jalankanBatch(ids, limit, fn) {
  const hasil = [];
  const n = Math.max(1, Math.floor(Number(limit)) || 1);
  for (let i = 0; i < ids.length; i += n) {
    const batch = ids.slice(i, i + n);
    const settled = await Promise.allSettled(batch.map((id) => fn(id)));
    hasil.push(...settled);
  }
  return hasil;
}

// --- Scheduler ----------------------------------------------------------------

async function intervalBerikutnyaMs() {
  try {
    const settings = await getSettings();
    const ttl = normalisasiTtl(settings?.checkModelsTtlSeconds);
    if (ttl > 0) return ttl * 1000;
  } catch { /* abaikan, pakai fallback */ }
  return FALLBACK_INTERVAL_MS;
}

async function runTick() {
  const s = ambilState();
  if (s.tickBerjalan) return; // anti-overlap lapis 2 (seharusnya tak terjadi)
  s.tickBerjalan = true;
  try {
    const settings = await getSettings().catch(() => ({}));
    const ttl = normalisasiTtl(settings?.checkModelsTtlSeconds);
    const ids = normalisasiProviderIds(settings?.autoSyncProviderIds);
    // Tidak ada provider ON atau TTL <= 0 (cache mati): skip run, tapi tick
    // tetap dijadwalkan ulang oleh pemanggil agar perubahan setting nanti
    // langsung berlaku tanpa restart.
    if (ids.length === 0 || ttl <= 0) return;
    // Lazy import: route membawa "next/server"; hanya ditarik saat tick
    // benar-benar berjalan, dan modul ini server-side only.
    const { checkProviderModels } = await import("@/app/api/providers/check-models/route.js");
    let ok = 0;
    await jalankanBatch(ids, PROVIDER_CONCURRENCY, async (pid) => {
      try {
        await checkProviderModels(pid, { forceRefresh: true });
        ok += 1;
      } catch (err) {
        console.warn(`[AutoSync] check ${pid} gagal:`, err?.message || err);
      }
    });
    console.log(`[AutoSync] tick selesai: ${ok}/${ids.length} provider ok`);
  } catch (err) {
    // Fail-open: error tick tidak boleh membunuh loop.
    console.warn("[AutoSync] tick error:", err?.message || err);
  } finally {
    s.tickBerjalan = false;
  }
}

function pasangTimerBerikutnya(delayMs) {
  const s = ambilState();
  if (!s.berjalan) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    runTick().finally(async () => {
      pasangTimerBerikutnya(await intervalBerikutnyaMs());
    });
  }, clampDelayMs(delayMs));
  if (s.timer.unref) s.timer.unref();
}

/**
 * Mulai scheduler. Idempotent + HMR-safe (singleton globalThis):
 * mengembalikan false bila sudah berjalan / bukan server-side.
 */
export function startAutoSync() {
  const s = ambilState();
  if (typeof window !== "undefined") return false; // server-side saja
  if (s.berjalan || s.timer) return false; // sudah berjalan
  s.berjalan = true;
  pasangTimerBerikutnya(INITIAL_DELAY_MS);
  console.log("[AutoSync] scheduler dimulai");
  return true;
}

/**
 * Hentikan scheduler (timer dibatalkan; tick yang sedang berjalan
 * dibiarkan selesai, dan tidak ada jadwal berikutnya yang dipasang).
 */
export function stopAutoSync() {
  const s = ambilState();
  s.berjalan = false;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
}

/** true bila scheduler aktif. */
export function isAutoSyncRunning() {
  const s = ambilState();
  return s.berjalan || !!s.timer;
}
