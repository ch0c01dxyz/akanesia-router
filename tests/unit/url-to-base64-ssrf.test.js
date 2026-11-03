import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { urlToBase64 } from "../../open-sse/handlers/imageProviders/_base.js";

// Regression: urlToBase64 used to plain-fetch() any URL — a caller-supplied
// image URL could reach internal hosts, and the body was buffered unbounded.
describe("urlToBase64 SSRF + caps", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function streamBody(chunks) {
    let i = 0;
    return {
      getReader() {
        return {
          read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
          cancel: async () => {},
        };
      },
    };
  }

  it("rejects a loopback URL without fetching", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("must not fetch"); });
    await expect(urlToBase64("http://127.0.0.1:9/internal.png")).rejects.toThrow(/Blocked URL/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a multicast URL without fetching", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("must not fetch"); });
    await expect(urlToBase64("http://224.0.0.1/x.png")).rejects.toThrow(/Blocked URL/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a payload over the byte cap", async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: streamBody([new Uint8Array(150)]),
    }));
    await expect(urlToBase64("https://example.com/big.png", { maxBytes: 100 })).rejects.toThrow(/exceeds 100 bytes/);
  });

  it("still returns base64 for a small public payload", async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: streamBody([new Uint8Array([1, 2, 3])]),
    }));
    const b64 = await urlToBase64("https://example.com/small.png");
    expect(b64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });
});
