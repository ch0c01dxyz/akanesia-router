// Cache in-memory untuk hasil "Check Models" (/api/providers/check-models).
// Tujuannya: mengurangi panggilan upstream berulang saat dashboard melakukan
// check-all, terutama karena tiap provider bisa memakan waktu hingga 15 detik
// (timeout fetch) dengan concurrency terbatas.
//
// Strategi: SWR-lite — data yang masih segar (fresh) dilayani dari cache,
// data yang kedaluwarsa (stale) tetap dilayani lalu di-refresh diam-diam di
// latar belakang (singleflight), dan data yang belum ada (miss) di-fetch
// secara singleflight agar request konkuren tidak menembak upstream dua kali.

const G = globalThis;
const KEY = "__9router_checkModelsCache__";

// Jitter TTL ±60 detik agar banyak provider tidak refresh serentak (thundering herd).
const JITTER_SECONDS = 60;
const TTL_DEFAULT_SECONDS = 3600;

// Singleton HMR-safe: Map + state disimpan di globalThis supaya tidak hilang
// saat Next.js dev melakukan hot module replacement.
function ambilState() {
  if (!G[KEY]) {
    G[KEY] = {
      entri: new Map(), // providerId -> { providerId, models, fetchedAt, latencyMs, status, hasil, ttlEffSeconds }
      penerbangan: new Map(), // providerId -> Promise hasil fetch yang sedang berjalan (singleflight)
      sedangSinkron: false, // flag global anti-overlap: true selama ada fetch yang berjalan
    };
  }
  return G[KEY];
}

// Hitung TTL efektif per provider: ttl + acak(-60..+60), minimal 1 detik.
function hitungTtlEfektif(ttlSeconds) {
  const jitter = Math.floor(Math.random() * (JITTER_SECONDS * 2 + 1)) - JITTER_SECONDS;
  return Math.max(1, ttlSeconds + jitter);
}

// Baca entry cache untuk satu provider.
// Mengembalikan { hit: "fresh" | "stale" | "miss", entry }.
// - fresh: umur entry < TTL efektif yang tersimpan saat entry ditulis.
// - stale: entry ada tapi kedaluwarsa → data basi dikembalikan, pemanggil
//   diharapkan me-refresh di latar belakang.
// - miss: belum ada entry sama sekali.
export function getCached(providerId, ttlSeconds) {
  const { entri } = ambilState();
  const entry = entri.get(providerId);
  if (!entry) return { hit: "miss", entry: null };
  const umur = (Date.now() - entry.fetchedAt) / 1000;
  if (umur < entry.ttlEffSeconds) return { hit: "fresh", entry };
  return { hit: "stale", entry };
}

// Tulis entry cache. data: { models, latencyMs, status }.
// ttlSeconds opsional (boleh disisipkan di data.ttlSeconds); default 3600.
// TTL efektif (beserta jitter) disimpan agar konsisten selama entry hidup.
export function setCached(providerId, data, ttlSeconds) {
  const ttl = ttlSeconds ?? data?.ttlSeconds ?? TTL_DEFAULT_SECONDS;
  const { entri } = ambilState();
  entri.set(providerId, {
    providerId,
    models: data?.models ?? [],
    fetchedAt: Date.now(),
    latencyMs: data?.latencyMs ?? null,
    status: data?.status ?? "ok",
    hasil: data?.hasil ?? null,
    ttlEffSeconds: hitungTtlEfektif(ttl),
  });
}

// Hapus entry satu provider (dipakai saat forceRefresh / provider berubah).
export function invalidate(providerId) {
  ambilState().entri.delete(providerId);
}

// Kosongkan seluruh cache.
export function clear() {
  ambilState().entri.clear();
}

// Jalan pintas utama: fresh → dari cache; stale → dari cache + refresh
// latar; miss → fetch singleflight. fetcher = async () => hasil upstream.
// opsi.bolehCache(hasil) menentukan apakah hasil fetch disimpan (default:
// hanya hasil { ok: true } yang di-cache; error/skip selalu di-fetch ulang).
// Bila ttlSeconds <= 0, cache mati total (bypass: tidak baca, tidak tulis).
export async function getOrRefresh(providerId, ttlSeconds, fetcher, opsi = {}) {
  const bolehCache = opsi.bolehCache || ((hasil) => hasil?.ok === true);
  if (!ttlSeconds || ttlSeconds <= 0) {
    return { result: await fetcher(), hit: "miss" };
  }

  const state = ambilState();
  const cek = getCached(providerId, ttlSeconds);

  if (cek.hit === "fresh") {
    return { result: cek.entry.hasil, hit: "fresh" };
  }

  if (cek.hit === "stale") {
    // Layani data basi, refresh di latar belakang (singleflight per provider,
    // skip bila fetch untuk provider ini sedang berjalan). Fire-and-forget;
    // error background tidak boleh mengganggu response yang sedang berjalan.
    if (!state.penerbangan.has(providerId)) {
      refreshLatar(providerId, state, fetcher, bolehCache, ttlSeconds).catch(() => {});
    }
    return { result: cek.entry.hasil, hit: "stale" };
  }

  // miss: fetch dengan singleflight — request konkuren menunggu promise yang sama.
  return { result: await ambilAtauFetch(providerId, state, fetcher, bolehCache, ttlSeconds), hit: "miss" };
}

// Fetch upstream dengan singleflight per provider + flag global anti-overlap.
async function ambilAtauFetch(providerId, state, fetcher, bolehCache, ttlSeconds) {
  let janji = state.penerbangan.get(providerId);
  if (!janji) {
    janji = (async () => {
      state.sedangSinkron = true;
      try {
        const hasil = await fetcher();
        if (bolehCache(hasil)) {
          setCached(providerId, {
            models: hasil?.models ?? [],
            latencyMs: hasil?.latencyMs ?? null,
            status: hasil?.ok ? "ok" : "error",
            hasil,
          }, ttlSeconds);
        }
        return hasil;
      } finally {
        // finally wajib: janji dihapus dan flag dilepas apa pun hasil fetch.
        state.penerbangan.delete(providerId);
        state.sedangSinkron = false;
      }
    })();
    state.penerbangan.set(providerId, janji);
  }
  return janji;
}

// Refresh latar belakang untuk entry stale. Timer tidak dipakai di sini;
// unref hanya dibutuhkan bila ada timer (saat ini tidak ada).
async function refreshLatar(providerId, state, fetcher, bolehCache, ttlSeconds) {
  await ambilAtauFetch(providerId, state, fetcher, bolehCache, ttlSeconds);
}
