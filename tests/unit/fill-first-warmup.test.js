import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock lapisan DB + undici agar test hermetic (tanpa SQLite / network).
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(),
}));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: vi.fn(),
}));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: vi.fn(),
}));
vi.mock("undici", () => ({
  Agent: vi.fn().mockImplementation(() => ({})),
  setGlobalDispatcher: vi.fn(),
}));

import {
  ambilOrigin,
  tentukanTarget,
  apakahTransient,
  hitungJitterMs,
  batasiKonkuren,
  startFillFirstWarmup,
  getWarmupStatus,
  WARMUP_LOOKBACK_DAYS,
  WARMUP_CONCURRENCY,
  WARMUP_REQUEST_TIMEOUT_MS,
  WARMUP_TOTAL_DEADLINE_MS,
  WARMUP_MAX_RETRIES,
  WARMUP_KEEP_ALIVE_TIMEOUT_MS,
} from "../../src/lib/fillFirstWarmup.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";

const STATE_KEY = "__9router_fillFirstWarmup__";

beforeEach(() => {
  // Reset singleton globalThis agar tiap test mulai bersih.
  delete globalThis[STATE_KEY];
  vi.clearAllMocks();
  getSettings.mockResolvedValue({ fillFirstWarmupEnabled: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("konstanta konfigurasi", () => {
  it("sesuai spesifikasi ide #2", () => {
    expect(WARMUP_LOOKBACK_DAYS).toBe(7);
    expect(WARMUP_CONCURRENCY).toBe(4);
    expect(WARMUP_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(WARMUP_TOTAL_DEADLINE_MS).toBe(30_000);
    expect(WARMUP_MAX_RETRIES).toBe(1);
    expect(WARMUP_KEEP_ALIVE_TIMEOUT_MS).toBe(60_000);
  });
});

describe("ambilOrigin", () => {
  it("mengembalikan origin untuk http/https", () => {
    expect(ambilOrigin("https://api.openai.com/v1/chat/completions")).toBe("https://api.openai.com");
    expect(ambilOrigin("http://localhost:8080/api")).toBe("http://localhost:8080");
    expect(ambilOrigin("  https://x.test/y  ")).toBe("https://x.test");
  });

  it("menolak URL invalid / protokol non-http", () => {
    expect(ambilOrigin("bukan url")).toBeNull();
    expect(ambilOrigin("ftp://x.test/f")).toBeNull();
    expect(ambilOrigin("")).toBeNull();
    expect(ambilOrigin(null)).toBeNull();
    expect(ambilOrigin(undefined)).toBeNull();
  });
});

describe("tentukanTarget", () => {
  const registry = [
    { id: "openai", transport: { baseUrl: "https://api.openai.com/v1/chat/completions" } },
    { id: "anthropic", transport: { baseUrl: "https://api.anthropic.com/v1/messages" } },
    { id: "rusak", transport: { baseUrl: "bukan url" } },
  ];

  it("hanya provider aktif + terpakai, dedup per provider, prioritas terendah menang", () => {
    const connections = [
      { provider: "openai", priority: 2, providerSpecificData: {} },
      // duplikat prioritas 1 dengan baseUrl kustom -> yang ini dipakai
      { provider: "openai", priority: 1, providerSpecificData: { baseUrl: "https://custom.openai.test/v9" } },
      { provider: "anthropic", priority: 1, providerSpecificData: {} },
      { provider: "zed", priority: 1, providerSpecificData: {} }, // tidak terpakai
      { provider: "rusak", priority: 1, providerSpecificData: {} }, // origin invalid
    ];
    const used = new Set(["openai", "anthropic", "zed", "rusak"]);
    const target = tentukanTarget(connections, used, registry);
    expect(target).toHaveLength(2);
    const byProvider = Object.fromEntries(target.map((t) => [t.provider, t.origin]));
    // baseUrl kustom koneksi menang atas registry
    expect(byProvider.openai).toBe("https://custom.openai.test");
    expect(byProvider.anthropic).toBe("https://api.anthropic.com");
  });

  it("provider tak terpakai / tanpa koneksi dilewati", () => {
    const connections = [{ provider: "openai", priority: 1, providerSpecificData: {} }];
    expect(tentukanTarget(connections, new Set(), registry)).toEqual([]);
    expect(tentukanTarget([], new Set(["openai"]), registry)).toEqual([]);
    expect(tentukanTarget(null, new Set(["openai"]), registry)).toEqual([]);
  });
});

describe("apakahTransient", () => {
  it("timeout (AbortError) dan 429/503 -> transient", () => {
    const abort = new Error("warmup timeout");
    abort.name = "AbortError";
    expect(apakahTransient(abort)).toBe(true);
    expect(apakahTransient({ status: 429 })).toBe(true);
    expect(apakahTransient({ statusCode: 503 })).toBe(true);
  });

  it("selain itu tidak di-retry", () => {
    expect(apakahTransient({ status: 401 })).toBe(false);
    expect(apakahTransient({ status: 404 })).toBe(false);
    expect(apakahTransient({ status: 500 })).toBe(false);
    expect(apakahTransient(new Error("boom"))).toBe(false);
    expect(apakahTransient(null)).toBe(false);
  });
});

describe("hitungJitterMs", () => {
  it("selalu dalam rentang", () => {
    for (let i = 0; i < 200; i++) {
      const v = hitungJitterMs();
      expect(v).toBeGreaterThanOrEqual(500);
      expect(v).toBeLessThanOrEqual(2000);
    }
    const v = hitungJitterMs(100, 200);
    expect(v).toBeGreaterThanOrEqual(100);
    expect(v).toBeLessThanOrEqual(200);
  });
});

describe("batasiKonkuren", () => {
  it("membatasi konkurensi, menjaga urutan, allSettled", async () => {
    let aktif = 0;
    let maksAktif = 0;
    const fn = async (x) => {
      aktif += 1;
      maksAktif = Math.max(maksAktif, aktif);
      await new Promise((r) => setTimeout(r, 5));
      aktif -= 1;
      if (x === 3) throw new Error("gagal");
      return x * 2;
    };
    const hasil = await batasiKonkuren([1, 2, 3, 4, 5], 2, fn);
    expect(maksAktif).toBeLessThanOrEqual(2);
    expect(hasil.map((h) => h.status)).toEqual([
      "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled",
    ]);
    expect(hasil[0].value).toBe(2);
  });
});

describe("startFillFirstWarmup", () => {
  it("idempotent: start kedua mengembalikan false", () => {
    expect(startFillFirstWarmup()).toBe(true);
    expect(startFillFirstWarmup()).toBe(false);
  });

  it("guard OFF: tidak ada traffic warmup sama sekali", async () => {
    getSettings.mockResolvedValue({ fillFirstWarmupEnabled: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(startFillFirstWarmup()).toBe(true);
    await vi.waitFor(() => {
      expect(getWarmupStatus().state).toBe("dimatikan");
    });

    expect(getWarmupStatus().enabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getProviderConnections).not.toHaveBeenCalled();
  });

  it("ON: ping origin provider aktif + terpakai, catat status", async () => {
    getSettings.mockResolvedValue({ fillFirstWarmupEnabled: true });
    getProviderConnections.mockResolvedValue([
      { provider: "openai", priority: 1, providerSpecificData: {} },
    ]);
    getAdapter.mockResolvedValue({
      all: vi.fn().mockReturnValue([{ provider: "openai" }]),
    });
    const fetchMock = vi.fn(async () => ({
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(startFillFirstWarmup()).toBe(true);
    await vi.waitFor(() => {
      expect(getWarmupStatus().state).toBe("selesai");
    });

    const status = getWarmupStatus();
    expect(status.enabled).toBe(true);
    expect(status.warmedProviders).toEqual(["openai"]);
    expect(status.failedProviders).toEqual([]);
    expect(status.durationMs).toBeGreaterThanOrEqual(0);
    expect(status.finishedAt).toBeTruthy();
    // Ping ke origin registry (tanpa auth header tambahan)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com");
    expect(opts.method).toBe("GET");
    expect(opts.headers === undefined || !("authorization" in (opts.headers || {}))).toBe(true);
  });
});
