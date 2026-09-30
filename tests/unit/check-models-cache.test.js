// Ide #3 — cache hasil Check Models (/api/providers/check-models).
// Lock-in: modul cache in-memory HMR-safe (globalThis singleton) dengan
// strategi SWR-lite — fresh dilayani dari cache, stale dilayani basi +
// background refresh singleflight, miss di-fetch singleflight. Hanya hasil
// ok:true yang di-cache; ttlSeconds<=0 = bypass total; TTL efektif memakai
// jitter ±60 detik (clamp min 1 detik).
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCached,
  setCached,
  getOrRefresh,
  invalidate,
  clear,
} from "@/lib/checkModelsCache.js";

const KEY = "__9router_checkModelsCache__";

// State HMR-safe hidup di globalThis; reset penuh antar test agar tidak
// saling mengotori (vi.resetModules tidak cukup — singleton globalThis
// tetap terbaca ulang oleh modul yang di-import ulang).
beforeEach(() => {
  delete globalThis[KEY];
});

const ambilState = () => globalThis[KEY];

const hasilOk = (models = ["model-a", "model-b"]) => ({
  ok: true,
  provider: "prov-test",
  modelCount: models.length,
  models,
  latencyMs: 42,
});

// Tunggu hingga kondisi terpenuhi (untuk background refresh yang fire-and-forget).
async function tungguKondisi(kondisi, batasMs = 2000) {
  const mulai = Date.now();
  for (;;) {
    if (kondisi()) return;
    if (Date.now() - mulai > batasMs) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("getOrRefresh — fresh", () => {
  it("fetcher TIDAK dipanggil dan hit 'fresh' bila entry masih segar", async () => {
    const hasil = hasilOk();
    setCached("prov-fresh", { models: hasil.models, latencyMs: 42, status: "ok", hasil }, 3600);

    const fetcher = vi.fn(async () => hasilOk(["seharusnya-tidak-dipakai"]));
    const { result, hit } = await getOrRefresh("prov-fresh", 3600, fetcher);

    expect(hit).toBe("fresh");
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual(hasil);
  });
});

describe("getOrRefresh — singleflight", () => {
  it("5x getOrRefresh konkuren saat miss → fetcher dipanggil tepat 1x, semua hasil sama", async () => {
    const hasil = hasilOk(["model-x"]);
    let panggilan = 0;
    const fetcher = vi.fn(async () => {
      panggilan += 1;
      await new Promise((r) => setTimeout(r, 50)); // beri jeda agar overlap konkuren
      return hasil;
    });

    const janji = Array.from({ length: 5 }, () => getOrRefresh("prov-single", 3600, fetcher));
    const hasilSemua = await Promise.all(janji);

    expect(panggilan).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const { result, hit } of hasilSemua) {
      expect(hit).toBe("miss");
      expect(result).toEqual(hasil);
    }
    // Hasil ok:true ikut tersimpan di cache → panggilan berikutnya fresh.
    expect(getCached("prov-single", 3600).hit).toBe("fresh");
  });
});

describe("getOrRefresh — stale (SWR-lite)", () => {
  it("data basi dilayani (hit 'stale'), background refresh berjalan 1x, lalu 'fresh'", async () => {
    const hasilLama = hasilOk(["model-lama"]);
    setCached("prov-stale", { models: hasilLama.models, latencyMs: 42, status: "ok", hasil: hasilLama }, 3600);
    // Buat entry kedaluwarsa: majukan fetchedAt melewati TTL efektif yang tersimpan.
    const entry = ambilState().entri.get("prov-stale");
    entry.fetchedAt = Date.now() - (entry.ttlEffSeconds + 10) * 1000;
    expect(getCached("prov-stale", 3600).hit).toBe("stale");

    const hasilBaru = hasilOk(["model-baru"]);
    const fetcher = vi.fn(async () => hasilBaru);

    const { result, hit } = await getOrRefresh("prov-stale", 3600, fetcher);
    expect(hit).toBe("stale");
    expect(result).toEqual(hasilLama); // data basi tetap dilayani

    // Background refresh (fire-and-forget) berjalan tepat 1x...
    await tungguKondisi(() => fetcher.mock.calls.length === 1);
    // ...dan selesai menulis cache baru.
    await tungguKondisi(() => ambilState().penerbangan.size === 0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const berikutnya = await getOrRefresh("prov-stale", 3600, fetcher);
    expect(berikutnya.hit).toBe("fresh");
    expect(berikutnya.result).toEqual(hasilBaru);
    expect(fetcher).toHaveBeenCalledTimes(1); // tidak fetch ulang
  });
});

describe("invalidate", () => {
  it("getCached menjadi 'miss' setelah invalidate", async () => {
    const hasil = hasilOk();
    setCached("prov-inv", { models: hasil.models, latencyMs: 42, status: "ok", hasil }, 3600);
    expect(getCached("prov-inv", 3600).hit).toBe("fresh");

    invalidate("prov-inv");
    expect(getCached("prov-inv", 3600).hit).toBe("miss");
    expect(getCached("prov-inv", 3600).entry).toBeNull();
  });
});

describe("bypass ttlSeconds<=0", () => {
  it("fetcher selalu dipanggil dan tidak ada entry yang tersimpan", async () => {
    const fetcher = vi.fn(async () => hasilOk());

    const r1 = await getOrRefresh("prov-bypass", 0, fetcher);
    const r2 = await getOrRefresh("prov-bypass", 0, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r1.hit).toBe("miss");
    expect(r2.hit).toBe("miss");
    expect(getCached("prov-bypass", 3600).hit).toBe("miss");
    expect(ambilState().entri.has("prov-bypass")).toBe(false);
  });
});

describe("jitter TTL", () => {
  it("ttlEffSeconds berada dalam ttl±60 detik", () => {
    const hasil = hasilOk();
    setCached("prov-jitter", { models: hasil.models, status: "ok", hasil }, 3600);
    const entry = ambilState().entri.get("prov-jitter");
    expect(Math.abs(entry.ttlEffSeconds - 3600)).toBeLessThanOrEqual(60);
  });

  it("TTL kecil tetap di-clamp minimal 1 detik", () => {
    const hasil = hasilOk();
    setCached("prov-jitter-min", { models: hasil.models, status: "ok", hasil }, 1);
    const entry = ambilState().entri.get("prov-jitter-min");
    expect(entry.ttlEffSeconds).toBeGreaterThanOrEqual(1);
    expect(entry.ttlEffSeconds).toBeLessThanOrEqual(61);
  });
});

describe("HMR-safe globalThis singleton", () => {
  it("state tersimpan di globalThis.__9router_checkModelsCache__", () => {
    const hasil = hasilOk();
    setCached("prov-hmr", { models: hasil.models, status: "ok", hasil }, 3600);

    const state = globalThis[KEY];
    expect(state).toBeDefined();
    expect(state.entri).toBeInstanceOf(Map);
    expect(state.penerbangan).toBeInstanceOf(Map);
    expect(state.entri.get("prov-hmr")).toBeDefined();
  });

  it("clear() mengosongkan seluruh cache", () => {
    const hasil = hasilOk();
    setCached("prov-clear", { models: hasil.models, status: "ok", hasil }, 3600);
    expect(getCached("prov-clear", 3600).hit).toBe("fresh");

    clear();
    expect(getCached("prov-clear", 3600).hit).toBe("miss");
    expect(ambilState().entri.size).toBe(0);
  });
});
