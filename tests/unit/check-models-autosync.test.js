import { describe, it, expect, beforeEach } from "vitest";

import {
  clampDelayMs,
  normalisasiTtl,
  normalisasiProviderIds,
  jalankanBatch,
  startAutoSync,
  stopAutoSync,
  isAutoSyncRunning,
} from "../../src/lib/checkModelsAutoSync.js";

describe("clampDelayMs", () => {
  it("nilai normal lolos apa adanya", () => {
    expect(clampDelayMs(120000)).toBe(120000);
    expect(clampDelayMs(3600000)).toBe(3600000);
  });

  it("minimal 1 detik", () => {
    expect(clampDelayMs(500)).toBe(1000);
    expect(clampDelayMs(1)).toBe(1000);
  });

  it("maksimal 2^31-1 ms (anti overflow setTimeout)", () => {
    expect(clampDelayMs(10 ** 20)).toBe(2147483647);
    expect(clampDelayMs(2147483647)).toBe(2147483647);
    expect(clampDelayMs(2147483648)).toBe(2147483647);
  });

  it("nilai tidak valid -> interval fallback 3600000", () => {
    for (const v of [0, -5, NaN, Infinity, "abc", undefined, null]) {
      expect(clampDelayMs(v)).toBe(3600000);
    }
  });
});

describe("normalisasiTtl", () => {
  it("angka valid dibulatkan ke bawah", () => {
    expect(normalisasiTtl(3600)).toBe(3600);
    expect(normalisasiTtl("1800")).toBe(1800);
    expect(normalisasiTtl(1.9)).toBe(1);
  });

  it("nol/negatif/tidak valid -> 0 (skip run)", () => {
    for (const v of [0, -5, NaN, "x", undefined, null, Infinity]) {
      expect(normalisasiTtl(v)).toBe(0);
    }
  });
});

describe("normalisasiProviderIds", () => {
  it("array string lolos", () => {
    expect(normalisasiProviderIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("bukan array -> []", () => {
    expect(normalisasiProviderIds(null)).toEqual([]);
    expect(normalisasiProviderIds("x")).toEqual([]);
    expect(normalisasiProviderIds(undefined)).toEqual([]);
  });

  it("menyaring entri bukan string / kosong", () => {
    expect(normalisasiProviderIds(["a", 123, "", null, "b"])).toEqual(["a", "b"]);
  });
});

describe("jalankanBatch", () => {
  it("membatasi concurrency, menjaga urutan, allSettled", async () => {
    let aktif = 0;
    let maksAktif = 0;
    const fn = async (id) => {
      aktif += 1;
      maksAktif = Math.max(maksAktif, aktif);
      await new Promise((r) => setTimeout(r, 5));
      aktif -= 1;
      if (id === 3) throw new Error("gagal");
      return id * 2;
    };
    const hasil = await jalankanBatch([1, 2, 3, 4, 5], 2, fn);
    expect(maksAktif).toBeLessThanOrEqual(2);
    expect(hasil.map((h) => h.status)).toEqual([
      "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled",
    ]);
    expect(hasil[0].value).toBe(2);
    expect(hasil[2].reason.message).toBe("gagal");
  });

  it("limit tidak valid dianggap 1", async () => {
    const urutan = [];
    const hasil = await jalankanBatch(["a", "b"], 0, async (id) => {
      urutan.push(id);
      return id;
    });
    expect(urutan).toEqual(["a", "b"]);
    expect(hasil.every((h) => h.status === "fulfilled")).toBe(true);
  });

  it("daftar kosong -> []", async () => {
    expect(await jalankanBatch([], 3, async () => 1)).toEqual([]);
  });
});

describe("start/stop/isAutoSyncRunning", () => {
  beforeEach(() => {
    stopAutoSync();
  });

  it("start idempotent, stop menghentikan", () => {
    expect(isAutoSyncRunning()).toBe(false);
    expect(startAutoSync()).toBe(true);
    expect(isAutoSyncRunning()).toBe(true);
    // Start kedua: tidak menggandakan scheduler
    expect(startAutoSync()).toBe(false);
    expect(isAutoSyncRunning()).toBe(true);
    stopAutoSync();
    expect(isAutoSyncRunning()).toBe(false);
    // Bisa di-start ulang setelah stop
    expect(startAutoSync()).toBe(true);
    stopAutoSync();
    expect(isAutoSyncRunning()).toBe(false);
  });
});
