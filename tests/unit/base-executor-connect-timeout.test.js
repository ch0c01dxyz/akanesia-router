// Regression test: connect timeout harus fail-fast (tanpa retry executor).
//
// Konteks: "fetch connect timeout" (upstream tidak mengembalikan response
// header dalam timeoutMs) sebelumnya masuk jalur tryRetry 502
// (attempts:3) → 4x60s + backoff = 249s retry buta ke upstream yang sama
// sebelum failover akun jalan. Perilaku baru: langsung throw agar caller
// failover ke akun berikutnya selagi budget timeout client masih ada.
//
// Error connect-timeout membawa reason Error("fetch connect timeout")
// (name="Error", BUKAN "AbortError") — terverifikasi empiris terhadap
// undici — sehingga chatCore memetakannya ke 502 (failover), bukan 499.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

const creds = { apiKey: "k" };

beforeEach(() => {
  fetchMock.mockReset();
});

// Meniru perilaku undici: saat signal di-abort, fetch reject dengan
// signal.reason (untuk timer kita: Error("fetch connect timeout")).
function mockHangingFetch() {
  fetchMock.mockImplementation(
    (url, { signal }) =>
      new Promise((_, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
  );
}

describe("BaseExecutor.execute — connect timeout fail-fast", () => {
  it("tidak retry saat connect timeout: 1x fetch lalu throw", async () => {
    const ex = new BaseExecutor("test", {
      baseUrl: "https://x/api",
      timeoutMs: 50,
      retry: { 502: { attempts: 3, delayMs: 0 } },
    });
    mockHangingFetch();

    let thrown = null;
    try {
      await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    } catch (e) {
      thrown = e;
    }

    // Kode lama: 4x fetch (1 + 3 retry). Kode baru: tepat 1x.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thrown).not.toBeNull();
    expect(thrown.message).toBe("fetch connect timeout");
    // name="Error" (bukan "AbortError") → chatCore memetakan ke 502,
    // bukan 499 → failover akun tetap berjalan.
    expect(thrown.name).toBe("Error");
  });

  it("network error biasa tetap retry sesuai config 502", async () => {
    const ex = new BaseExecutor("test", {
      baseUrl: "https://x/api",
      timeoutMs: 50,
      retry: { 502: { attempts: 1, delayMs: 0 } },
    });
    fetchMock
      .mockImplementationOnce(async () => {
        throw new Error("ECONNRESET");
      })
      .mockResolvedValueOnce({ status: 200, headers: { get: () => "" } });

    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("client abort (AbortError) diteruskan tanpa retry", async () => {
    const ex = new BaseExecutor("test", {
      baseUrl: "https://x/api",
      timeoutMs: 5000,
      retry: { 502: { attempts: 3, delayMs: 0 } },
    });
    const clientCtrl = new AbortController();
    fetchMock.mockImplementation(
      (url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
    );

    let thrown = null;
    const p = ex.execute({
      model: "m",
      body: {},
      stream: false,
      credentials: creds,
      signal: clientCtrl.signal,
    });
    // Client abort segera (sebelum timer 5000ms) dengan reason AbortError.
    clientCtrl.abort();
    try {
      await p;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
