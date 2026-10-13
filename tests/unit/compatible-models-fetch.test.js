import { describe, it, expect, vi } from "vitest";
import { fetchCompatibleModels } from "../../src/lib/compatibleModelsFetch.js";
import { mapPool } from "../../src/lib/mapPool.js";

function okFetch(json, capture) {
  return vi.fn(async (url, opts) => {
    capture?.({ url, opts });
    return { ok: true, status: 200, json: async () => json };
  });
}

describe("fetchCompatibleModels", () => {
  it("openai: GET {baseUrl}/models dengan Bearer", async () => {
    let got;
    const r = await fetchCompatibleModels({
      provider: "openai-compatible-chat-x",
      baseUrl: "https://llm.example.com/v1/",
      apiKey: "k1",
      fetchFn: okFetch({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] }, (c) => (got = c)),
    });
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["a", "b"]);
    expect(got.url).toBe("https://llm.example.com/v1/models");
    expect(got.opts.headers.Authorization).toBe("Bearer k1");
    expect(got.opts.signal).toBeDefined();
  });

  it("anthropic: strip /messages, pakai x-api-key", async () => {
    let got;
    const r = await fetchCompatibleModels({
      provider: "anthropic-compatible-chat-x",
      baseUrl: "https://proxy.example.com/v1/messages",
      apiKey: "k2",
      fetchFn: okFetch({ data: [{ id: "m1" }] }, (c) => (got = c)),
    });
    expect(r.ok).toBe(true);
    expect(got.url).toBe("https://proxy.example.com/v1/models");
    expect(got.opts.headers["x-api-key"]).toBe("k2");
    expect(got.opts.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("tanpa baseUrl → ok:false tanpa fetch", async () => {
    const fetchFn = vi.fn();
    const r = await fetchCompatibleModels({ provider: "openai-compatible-chat-x", baseUrl: "", apiKey: "k", fetchFn });
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("HTTP error → error/httpStatus/errorBody", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 401, text: async () => "bad key",
    }));
    const r = await fetchCompatibleModels({
      provider: "openai-compatible-chat-x", baseUrl: "https://x.example.com", apiKey: "k", fetchFn,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("HTTP 401");
    expect(r.httpStatus).toBe(401);
    expect(r.errorBody).toBe("bad key");
  });

  it("network error → tidak throw", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("boom"); });
    const r = await fetchCompatibleModels({
      provider: "openai-compatible-chat-x", baseUrl: "https://x.example.com", apiKey: "k", fetchFn,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("parse bentuk gemini {models:[{name}]} dan array mentah", async () => {
    const r1 = await fetchCompatibleModels({
      provider: "openai-compatible-chat-x", baseUrl: "https://x.example.com", apiKey: "k",
      fetchFn: okFetch({ models: [{ name: "models/g1" }] }),
    });
    expect(r1.models).toEqual(["models/g1"]);
    const r2 = await fetchCompatibleModels({
      provider: "openai-compatible-chat-x", baseUrl: "https://x.example.com", apiKey: "k",
      fetchFn: okFetch([{ id: "z1" }, { model: "z2" }]),
    });
    expect(r2.models).toEqual(["z1", "z2"]);
  });
});

describe("mapPool", () => {
  it("urutan hasil = urutan items", async () => {
    const r = await mapPool([1, 2, 3, 4], 2, async (x) => x * 10);
    expect(r).toEqual([10, 20, 30, 40]);
  });

  it("maksimal `limit` berjalan paralel", async () => {
    let running = 0, maxRunning = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async (x) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((res) => setTimeout(res, 10));
      running--;
      return x;
    });
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("input kosong → []", async () => {
    expect(await mapPool([], 5, async (x) => x)).toEqual([]);
  });
});
