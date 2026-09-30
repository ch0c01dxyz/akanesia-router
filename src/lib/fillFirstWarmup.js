// Warming koneksi fill-first (ide #2).
//
// Tujuan: hilangkan penalti cold-start (DNS + TCP + TLS ≈ 4 RTT) pada request
// pertama ke provider aktif. Warmup = 1 ping ringan TANPA auth ke origin
// provider — yang dihangatkan adalah TLS session + socket keep-alive ke
// origin yang sama, sehingga request pertama tidak membayar handshake penuh.
//
// Prinsip:
// - Selective lazy warm: hanya provider AKTIF (punya koneksi aktif DAN
//   terlihat dipakai N hari terakhir dari log SQLite), bukan 322 provider.
// - Berjalan SETELAH server listen, non-blocking: boot tidak pernah tertunda.
// - Concurrency ≤ 4, timeout 10 dtk/request, deadline total 30 dtk, maks 1
//   retry berjitter hanya untuk transient (timeout/429/503). Gagal = diam.
// - TIDAK mengirim auth header apa pun → tidak memicu token refresh dan
//   tidak menghabiskan kuota API key. Refresh proaktif sudah ditangani
//   backgroundTokenRefresh (jangan duplikasi di sini).
// - Anti-SSRF: URL hanya berasal dari registry provider / baseUrl kustom
//   koneksi milik user — tidak pernah URL arbitrary.
// - Satu undici Agent global via setGlobalDispatcher (keepAliveTimeout 60 dtk),
//   dipasang sekali dan fail-open, independen dari toggle warmup (P11):
//   toggle hanya mengendalikan traffic ping warmup, bukan pooling koneksi.
// - Singleton globalThis agar HMR tidak menggandakan warmup.

import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import REGISTRY from "open-sse/providers/registry/index.js";

const G = globalThis;
const KEY = "__9router_fillFirstWarmup__";

// --- Konfigurasi (sesuai spesifikasi ide #2) -----------------------------------
export const WARMUP_LOOKBACK_DAYS = 7; // "terlihat dipakai N hari terakhir"
export const WARMUP_CONCURRENCY = 4;
export const WARMUP_REQUEST_TIMEOUT_MS = 10_000;
export const WARMUP_TOTAL_DEADLINE_MS = 30_000;
export const WARMUP_MAX_RETRIES = 1;
export const WARMUP_KEEP_ALIVE_TIMEOUT_MS = 60_000;
export const WARMUP_RETRY_MIN_DELAY_MS = 500;
export const WARMUP_RETRY_MAX_DELAY_MS = 2000;

function ambilState() {
  if (!G[KEY]) {
    G[KEY] = {
      dimulai: false, // guard idempotensi (HMR-safe)
      dispatcherTerpasang: false,
      // Status untuk endpoint health: idle | berjalan | selesai | dimatikan
      status: "idle",
      enabled: null,
      warmedProviders: [],
      gagalProviders: [],
      durationMs: null,
      selesaiPada: null,
    };
  }
  return G[KEY];
}

/** Status warming untuk endpoint health internal. Tidak pernah throw. */
export function getWarmupStatus() {
  try {
    const s = ambilState();
    return {
      enabled: s.enabled,
      state: s.status,
      warmedProviders: [...s.warmedProviders],
      failedProviders: [...s.gagalProviders],
      durationMs: s.durationMs,
      finishedAt: s.selesaiPada,
    };
  } catch {
    return { enabled: null, state: "idle", warmedProviders: [], failedProviders: [], durationMs: null, finishedAt: null };
  }
}

// --- Helper murni (di-export untuk unit test) ----------------------------------

/**
 * Ambil origin (scheme + host + port) dari URL. Hanya http/https;
 * URL invalid / protokol lain -> null (anti-SSRF: tidak ada tebak-tebakan).
 */
export function ambilOrigin(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Tentukan target warmup: satu origin per provider — provider yang punya
 * koneksi aktif (prioritas terendah = target fill-first) DAN muncul di
 * log pemakaian. Dedup per provider. `registry` bisa di-inject untuk test.
 */
export function tentukanTarget(connections, usedProviders, registry = REGISTRY) {
  const target = [];
  const terlihat = new Set();
  const daftar = [...(connections || [])].sort(
    (a, b) => (a?.priority || 999) - (b?.priority || 999)
  );
  for (const c of daftar) {
    const pid = c?.provider;
    if (!pid || terlihat.has(pid)) continue;
    if (!usedProviders || !usedProviders.has(pid)) continue;
    const entry = (registry || []).find((r) => r?.id === pid);
    const origin =
      ambilOrigin(c?.providerSpecificData?.baseUrl) ||
      ambilOrigin(entry?.transport?.baseUrl);
    if (!origin) continue; // tidak bisa tentukan origin aman -> lewati
    terlihat.add(pid);
    target.push({ provider: pid, origin });
  }
  return target;
}

/**
 * Apakah error layak di-retry: timeout kita sendiri (AbortError) atau
 * status transient 429/503. Selain itu -> tidak (termasuk 401/404: TLS
 * sudah hangat, tidak perlu retry).
 */
export function apakahTransient(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  const status = error.status ?? error.statusCode;
  return status === 429 || status === 503;
}

/** Jitter retry: acak seragam dalam rentang konfigurasi. */
export function hitungJitterMs(
  minMs = WARMUP_RETRY_MIN_DELAY_MS,
  maxMs = WARMUP_RETRY_MAX_DELAY_MS
) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return lo + Math.random() * (hi - lo);
}

/**
 * Batasi konkurensi: proses items per kelompok `limit` via Promise.allSettled.
 */
export async function batasiKonkuren(items, limit, fn) {
  const n = Math.max(1, Math.floor(Number(limit)) || 1);
  const hasil = [];
  const daftar = [...(items || [])];
  for (let i = 0; i < daftar.length; i += n) {
    const batch = daftar.slice(i, i + n);
    const settled = await Promise.allSettled(batch.map((it) => fn(it)));
    hasil.push(...settled);
  }
  return hasil;
}

function tidur(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Bagian impure --------------------------------------------------------------

/**
 * Pasang satu undici Agent global (keepAliveTimeout ~60 dtk) agar socket
 * hasil warmup tetap hidup untuk pola single-user dengan jeda bermenit-menit.
 * Sekali saja, fail-open: gagal -> pakai dispatcher default.
 */
async function pasangDispatcherGlobal() {
  const s = ambilState();
  if (s.dispatcherTerpasang) return;
  try {
    const { Agent, setGlobalDispatcher } = await import("undici");
    const agent = new Agent({
      keepAliveTimeout: WARMUP_KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: WARMUP_KEEP_ALIVE_TIMEOUT_MS,
    });
    setGlobalDispatcher(agent);
    s.dispatcherTerpasang = true;
    console.log("[FillFirstWarmup] undici Agent global terpasang (keepAliveTimeout 60 dtk)");
  } catch (err) {
    console.warn("[FillFirstWarmup] dispatcher global gagal dipasang:", err?.message || err);
  }
}

/** Provider yang terlihat dipakai N hari terakhir (dari usageHistory SQLite). */
async function ambilProviderTerpakai() {
  try {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const cutoff = new Date(Date.now() - WARMUP_LOOKBACK_DAYS * 86400_000).toISOString();
    const rows = db.all(
      `SELECT DISTINCT provider FROM usageHistory WHERE timestamp >= ? AND provider IS NOT NULL AND provider != ''`,
      [cutoff]
    );
    return new Set(rows.map((r) => r.provider));
  } catch (err) {
    console.warn("[FillFirstWarmup] baca usage history gagal:", err?.message || err);
    return new Set();
  }
}

async function ambilKoneksiAktif() {
  try {
    const { getProviderConnections } = await import("@/lib/db/repos/connectionsRepo.js");
    return await getProviderConnections({ isActive: true });
  } catch (err) {
    console.warn("[FillFirstWarmup] baca koneksi gagal:", err?.message || err);
    return [];
  }
}

function catatHasil(provider, ok) {
  const s = ambilState();
  if (ok) s.warmedProviders.push(provider);
  else s.gagalProviders.push(provider);
}

/**
 * 1 ping ringan TANPA auth ke origin provider. Respons apa pun (200/401/404)
 * berarti TLS sudah hangat. Retry maks 1x berjitter hanya untuk transient.
 */
async function pingOrigin(target, signalLuar) {
  const { provider, origin } = target;
  let attempt = 0;
  while (true) {
    const ctrl = new AbortController();
    const teruskanAbort = () => ctrl.abort();
    if (signalLuar) {
      if (signalLuar.aborted) {
        catatHasil(provider, false);
        return;
      }
      signalLuar.addEventListener("abort", teruskanAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(new Error("warmup timeout")), WARMUP_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(origin, {
        method: "GET",
        signal: ctrl.signal,
        redirect: "manual",
      });
      // Konsumsi body kecil agar socket bisa dipakai ulang (keep-alive).
      await res.arrayBuffer().catch(() => {});
      if ((res.status === 429 || res.status === 503) && attempt < WARMUP_MAX_RETRIES && !signalLuar?.aborted) {
        attempt += 1;
        await tidur(hitungJitterMs());
        continue;
      }
      catatHasil(provider, true);
      return;
    } catch (err) {
      if (apakahTransient(err) && attempt < WARMUP_MAX_RETRIES && !signalLuar?.aborted) {
        attempt += 1;
        await tidur(hitungJitterMs());
        continue;
      }
      catatHasil(provider, false);
      return;
    } finally {
      clearTimeout(timer);
      if (signalLuar) signalLuar.removeEventListener("abort", teruskanAbort);
    }
  }
}

async function jalankanWarmup() {
  const s = ambilState();
  const t0 = Date.now();
  try {
    const settings = await getSettings().catch(() => ({}));
    const enabled = settings?.fillFirstWarmupEnabled !== false;
    s.enabled = enabled;
    // P11: dispatcher keep-alive 60 dtk dipasang SELALU, independen dari toggle
    // warmup. Pooling koneksi adalah kebutuhan jalur chat upstream (base.js
    // memakai proxyAwareFetch tanpa dispatcher eksplisit → memakai dispatcher
    // global); toggle hanya mengendalikan traffic ping warmup.
    await pasangDispatcherGlobal();
    if (!enabled) {
      // Guard OFF: nol traffic warmup sama sekali (dispatcher tetap aktif).
      s.status = "dimatikan";
      console.log("[FillFirstWarmup] dimatikan via pengaturan; tidak ada traffic warmup.");
      return;
    }
    s.status = "berjalan";

    const [connections, usedProviders] = await Promise.all([
      ambilKoneksiAktif(),
      ambilProviderTerpakai(),
    ]);
    const target = tentukanTarget(connections, usedProviders);
    if (target.length === 0) {
      console.log("[FillFirstWarmup] tidak ada provider aktif yang perlu di-warm.");
      return;
    }
    console.log(`[FillFirstWarmup] warming ${target.length} provider: ${target.map((t) => t.provider).join(", ")}`);

    // Deadline total: warmup tidak boleh berlarut-larut.
    const ctrl = new AbortController();
    const deadline = setTimeout(() => ctrl.abort(), WARMUP_TOTAL_DEADLINE_MS);
    try {
      await batasiKonkuren(target, WARMUP_CONCURRENCY, (t) => pingOrigin(t, ctrl.signal));
    } finally {
      clearTimeout(deadline);
    }

    console.log(
      `[FillFirstWarmup] selesai: ${s.warmedProviders.length} ok, ${s.gagalProviders.length} gagal ` +
      `(${Date.now() - t0} ms)`
    );
  } catch (err) {
    // Fail-open total: warmup tidak boleh mengganggu apa pun.
    console.warn("[FillFirstWarmup] error:", err?.message || err);
  } finally {
    if (s.status === "berjalan") s.status = "selesai";
    s.durationMs = Date.now() - t0;
    s.selesaiPada = new Date().toISOString();
  }
}

/**
 * Mulai warmup. Idempotent + HMR-safe (singleton globalThis).
 * Non-blocking: mengembalikan true segera; boot tidak pernah tertunda.
 * Mengembalikan false bila bukan server-side atau sudah dimulai.
 */
export function startFillFirstWarmup() {
  const s = ambilState();
  if (typeof window !== "undefined") return false; // server-side saja
  if (s.dimulai) return false; // sudah dimulai (termasuk HMR)
  s.dimulai = true;
  // Sengaja tidak di-await: warmup berjalan di latar.
  jalankanWarmup().catch(() => {});
  return true;
}

/**
 * Picu warmup ulang secara manual (mis. saat toggle ON dari UI setelah boot).
 * Me-reset guard idempotensi lalu menjalankan lagi, non-blocking.
 * Mengembalikan false bila bukan server-side.
 */
export function triggerFillFirstWarmup() {
  if (typeof window !== "undefined") return false; // server-side saja
  const s = ambilState();
  s.dimulai = false;
  return startFillFirstWarmup();
}
