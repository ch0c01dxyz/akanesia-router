import { describe, expect, it, vi, afterEach } from "vitest";

import {
  getFreeModelIds,
  isCatalogFreeModel,
  getCatalogStatus,
  resetCatalogCache,
} from "../../open-sse/utils/opencodeCatalog.js";

const FAKE_CATALOG = {
  opencode: {
    models: {
      "brand-new-free": { cost: { input: 0, output: 0 }, status: "active", tool_call: true },
      "paid-model": { cost: { input: 1, output: 2 }, status: "active" },
      "old-deprecated": { cost: { input: 0, output: 0 }, status: "deprecated" },
      "no-tools": { cost: { input: 0, output: 0 }, status: "active", tool_call: false },
    },
  },
};

function mockFetch(json, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => json,
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetCatalogCache();
});

describe("opencode live catalog (P2)", () => {
  it("hanya model free yang masuk (bukan paid/deprecated/tanpa tool)", async () => {
    mockFetch(FAKE_CATALOG);
    const ids = await getFreeModelIds();
    expect(ids.has("brand-new-free")).toBe(true);
    expect(ids.has("paid-model")).toBe(false);
    expect(ids.has("old-deprecated")).toBe(false);
    expect(ids.has("no-tools")).toBe(false);
  });

  it("fail-open: fetch gagal → set kosong, tidak throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const ids = await getFreeModelIds();
    expect(ids.size).toBe(0);
    expect(await isCatalogFreeModel("brand-new-free")).toBe(false);
  });

  it("fail-open: shape tak dikenal → set kosong", async () => {
    mockFetch({ nonsense: true });
    const ids = await getFreeModelIds();
    expect(ids.size).toBe(0);
  });

  it("cache dipakai untuk panggilan kedua (fetch sekali)", async () => {
    const spy = vi.fn(async () => ({
      ok: true, status: 200, json: async () => FAKE_CATALOG,
    }));
    vi.stubGlobal("fetch", spy);
    await getFreeModelIds();
    await getFreeModelIds();
    expect(spy).toHaveBeenCalledTimes(1);
    const st = getCatalogStatus();
    expect(st.cached).toBe(true);
    expect(st.count).toBe(1);
  });

  it("single-flight: request konkuren berbagi satu fetch", async () => {
    const spy = vi.fn(async () => ({
      ok: true, status: 200, json: async () => FAKE_CATALOG,
    }));
    vi.stubGlobal("fetch", spy);
    const [a, b] = await Promise.all([getFreeModelIds(), getFreeModelIds()]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.has("brand-new-free")).toBe(true);
    expect(b.has("brand-new-free")).toBe(true);
  });
});
