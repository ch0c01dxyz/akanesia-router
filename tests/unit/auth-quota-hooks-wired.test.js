import { describe, expect, it, vi, beforeEach } from "vitest";

// Regresi untuk ReferenceError: recordFailure is not defined yang muncul di
// /api/v1/messages saat upstream gagal. auth.js memanggil recordFailure /
// recordSuccess dari ./quotaIncidents.js — import-nya sempat hilang sehingga
// modul ter-load normal tapi meledak tepat saat fungsi dipanggil (error path).
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
}));

const { markAccountUnavailable, clearAccountError } = await import(
  "../../src/sse/services/auth.js"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.js quota hooks ter-wire", () => {
  it("markAccountUnavailable tidak ReferenceError (recordFailure ter-import)", async () => {
    // "noauth" membuat recordFailure no-op sebelum menyentuh DB —
    // cukup untuk membuktikan referensinya terdefinisi.
    const result = await markAccountUnavailable("noauth", 500, "boom", "testprov", "testmodel");
    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("clearAccountError tidak ReferenceError (recordSuccess ter-import)", async () => {
    // clearAccountError memanggil recordSuccess di baris pertama.
    // Tanpa koneksi valid ia harus selesai tanpa throw ReferenceError.
    mocks.getProviderConnections.mockResolvedValueOnce([]);
    await expect(
      clearAccountError("noauth", "testmodel")
    ).resolves.not.toThrow();
  });
});
