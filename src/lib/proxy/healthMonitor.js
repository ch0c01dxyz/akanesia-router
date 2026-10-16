// Health Monitor Proxy Relay — auto health check berkala + auto-disable
// setelah 3x gagal beruntun + re-aktivasi awal bulan.
//
// Idiom: recursive setTimeout (self-scheduling) — jadwal berikutnya dipasang
// setelah tick selesai, jadi tidak ada overlap by construction. Singleton di
// globalThis agar HMR tidak menggandakan scheduler. Timer di-unref agar
// tidak menahan proses exit. Fail-open: error tick tidak membunuh loop.

import {
  getProxyPools,
  recordProxyFailure,
  recordProxySuccess,
  monthlyResetProxyPools,
} from "@/lib/db/repos/proxyPoolsRepo.js";
import { testProxyPool } from "./testPool.js";

const G = globalThis;
const KEY = "__akanesia_proxyHealthMonitor__";

// Interval health check: 12 jam (proxy jarang dipakai, hanya kondisi tertentu).
// Monthly reset check ikut di tick yang sama (murah + idempotent — hanya bandingkan YYYY-MM).
const HEALTH_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
// Jeda tick pertama setelah start — beri waktu server settle setelah boot.
const INITIAL_DELAY_MS = 60 * 1000;

function ambilState() {
  if (!G[KEY]) {
    G[KEY] = { berjalan: false, timer: null, tickBerjalan: false };
  }
  return G[KEY];
}

async function runTick() {
  const s = ambilState();
  if (s.tickBerjalan) return; // anti-overlap lapis 2 (seharusnya tak terjadi)
  s.tickBerjalan = true;
  try {
    // 1. Re-aktivasi awal bulan (idempotent)
    try {
      const { reset } = await monthlyResetProxyPools();
      if (reset > 0) console.log(`[ProxyHealth] monthly reset: ${reset} pool diaktifkan kembali`);
    } catch (err) {
      console.warn("[ProxyHealth] monthly reset error:", err?.message || err);
    }

    // 2. Health check semua pool aktif (sequential — lembut ke network)
    let pools = [];
    try {
      pools = await getProxyPools({ isActive: true });
    } catch (err) {
      console.warn("[ProxyHealth] ambil pools error:", err?.message || err);
      return;
    }
    let ok = 0, failed = 0, disabled = 0;
    for (const pool of pools) {
      try {
        const result = await testProxyPool(pool);
        if (result.ok) {
          await recordProxySuccess(pool.id);
          ok += 1;
        } else {
          const updated = await recordProxyFailure(pool.id, result.error || `status ${result.status}`);
          failed += 1;
          if (updated?.isActive === false && updated.disabledReason === "auto") {
            disabled += 1;
            console.log(`[ProxyHealth] pool "${pool.name}" dinonaktifkan otomatis (3x gagal)`);
          }
        }
      } catch (err) {
        failed += 1;
        try { await recordProxyFailure(pool.id, err?.message || String(err)); } catch {}
      }
    }
    if (pools.length > 0) {
      console.log(`[ProxyHealth] tick selesai: ${ok} ok, ${failed} gagal${disabled ? `, ${disabled} auto-disable` : ""}`);
    }
  } finally {
    s.tickBerjalan = false;
  }
}

function pasangTimerBerikutnya(delayMs) {
  const s = ambilState();
  if (!s.berjalan) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    runTick().finally(() => pasangTimerBerikutnya(HEALTH_CHECK_INTERVAL_MS));
  }, Math.max(1000, Math.floor(Number(delayMs) || HEALTH_CHECK_INTERVAL_MS)));
  if (s.timer.unref) s.timer.unref();
}

/**
 * Mulai scheduler. Idempotent + HMR-safe (singleton globalThis):
 * mengembalikan false bila sudah berjalan / bukan server-side.
 */
export function startProxyHealthMonitor() {
  const s = ambilState();
  if (typeof window !== "undefined") return false; // server-side saja
  if (s.berjalan || s.timer) return false; // sudah berjalan
  s.berjalan = true;
  pasangTimerBerikutnya(INITIAL_DELAY_MS);
  console.log("[ProxyHealth] scheduler dimulai");
  return true;
}

/** Hentikan scheduler (tick berjalan dibiarkan selesai). */
export function stopProxyHealthMonitor() {
  const s = ambilState();
  s.berjalan = false;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
}

/** true bila scheduler aktif. */
export function isProxyHealthMonitorRunning() {
  const s = ambilState();
  return s.berjalan || !!s.timer;
}
