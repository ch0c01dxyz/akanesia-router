// #4333: "Strict Proxy" tidak dipegang. Dengan pool strict terpasang dan semua
// proxy di dalamnya mati, request tetap keluar lewat IP langsung — persis
// kebocoran yang ingin dicegah pengaturan ini.
//
// Dua lapis, satu per layer:
//
// 1. resolveConnectionProxyConfig membuang strictProxy setiap kali pool tidak
//    bisa dipakai (nonaktif, atau tersimpan dengan proxyUrl kosong). isValidPool
//    meng-gate dua return yang membawa strictProxy, sehingga pool strict yang
//    tak-valid jatuh ke cabang legacy/none yang melaporkan strictProxy:false.
//
// 2. proxyAwareFetch hanya menghormati strictProxy di dalam catch dari upaya
//    proxy. Bila tidak ada URL proxy yang ter-resolve, tidak ada yang bisa
//    dicoba, sehingga ia mencapai `return` di akhir dan tersambung langsung.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

const { getProxyPoolById } = await import("@/models");
const { resolveConnectionProxyConfig } = await import("../../src/lib/network/connectionProxy.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

describe("pool strict mempertahankan strictProxy saat pool tak bisa dipakai (#4333)", () => {
  it("mempertahankan strictProxy untuk pool strict yang nonaktif", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    expect(cfg.strictProxy).toBe(true);
  });

  it("mempertahankan strictProxy untuk pool strict tanpa proxy url", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p2", isActive: true, proxyUrl: "", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p2" });
    expect(cfg.strictProxy).toBe(true);
  });

  it("tetap melaporkan strictProxy:false untuk pool non-strict", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p3", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: false,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p3" });
    expect(cfg.strictProxy).toBe(false);
  });

  it("tetap melaporkan strictProxy:false bila tidak ada pool terpasang", async () => {
    const cfg = await resolveConnectionProxyConfig({});
    expect(cfg.strictProxy).toBe(false);
  });
});

describe("strictProxy menolak koneksi langsung (#4333)", () => {
  // Dua test terakhir menyentuh network layer — bersihkan env proxy agar
  // hermetic (di VM dev ada egress proxy via env yang ikut ter-resolve).
  const PROXY_ENV_KEYS = [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
    "NO_PROXY", "no_proxy",
  ];
  const savedProxyEnv = {};
  const clearProxyEnv = () => {
    for (const k of PROXY_ENV_KEYS) {
      savedProxyEnv[k] = process.env[k];
      delete process.env[k];
    }
  };
  const restoreProxyEnv = () => {
    for (const k of PROXY_ENV_KEYS) {
      if (savedProxyEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedProxyEnv[k];
    }
  };

  it("throw bila pool terpasang tapi tidak ada proxy url yang ter-resolve", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { proxyPoolId: "p1", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("throw bila pool enabled tapi url-nya kosong", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { enabled: true, url: "", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("tidak memblokir pemanggil yang set strictProxy tanpa proxy terkonfigurasi", async () => {
    // Executor Qoder mengirim strictProxy:true dengan arti "jangan replay request
    // ini secara langsung bila proxy gagal" — signature COSY yang di-replay
    // mendapat 403. Bila tidak ada yang dikonfigurasi, ia harus tetap mencapai network.
    clearProxyEnv();
    try {
      await expect(
        proxyAwareFetch("https://nonexistent.invalid/v1/chat", {}, { strictProxy: true }),
      ).rejects.not.toThrow(/strictProxy/);
    } finally {
      restoreProxyEnv();
    }
  });

  it("tidak memblokir request bila strictProxy mati", async () => {
    // Tanpa proxy, tidak strict: call boleh mencapai network layer.
    // Ia gagal di DNS di sini — tidak masalah; yang penting penolakannya
    // BUKAN dari guard strictProxy.
    clearProxyEnv();
    try {
      await expect(
        proxyAwareFetch("https://nonexistent.invalid/v1/chat", {}, { strictProxy: false }),
      ).rejects.not.toThrow(/strictProxy/);
    } finally {
      restoreProxyEnv();
    }
  });
});
