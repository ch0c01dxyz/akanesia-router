import { describe, expect, it, vi, beforeEach } from "vitest";

// Regresi race clearAccountError: snapshot kredensial (_connection) diambil
// saat seleksi akun, sementara kegagalan konkuren pada model lain bisa
// mengunci model itu + menulis testStatus/lastError/backoffLevel SETELAH
// snapshot. Kode lama menghitung dari snapshot basi sehingga me-reset
// error state (testStatus "active", lastError null, backoffLevel 0) dan
// menghapus jejak kegagalan konkuren tersebut — padahal lock-nya masih
// aktif di DB. Perbaikan: baca ulang koneksi segar sebelum memutuskan.
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(async () => null),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
  removeIncident: vi.fn(async () => true),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
}));

vi.mock("@/lib/db/repos/quotaIncidentsRepo.js", () => ({
  upsertIncident: vi.fn(),
  removeIncident: mocks.removeIncident,
  listIncidents: vi.fn(async () => []),
}));

const { clearAccountError } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("clearAccountError memakai state koneksi segar", () => {
  it("tidak me-reset error state bila DB segar masih punya lock aktif model lain", async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const past = new Date(Date.now() - 60000).toISOString();
    // Snapshot basi saat seleksi: model A sempat gagal dulu (lock kedaluwarsa,
    // error state masih menempel), model B belum terkunci.
    const staleSnapshot = {
      id: "conn-1",
      testStatus: "unavailable",
      lastError: "429 lama",
      errorCode: 429,
      lastErrorAt: past,
      backoffLevel: 2,
      modelLock_modelA: past,
    };
    // State DB segar saat sukses: kegagalan konkuren mengunci model B +
    // menulis error state baru. Lock B harus bertahan dan error state-nya
    // tidak boleh ditimpa jadi "active"/null/0.
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      testStatus: "unavailable",
      lastError: "503 konkuren",
      errorCode: 503,
      lastErrorAt: new Date().toISOString(),
      backoffLevel: 3,
      modelLock_modelA: past,
      modelLock_modelB: future,
    });

    await clearAccountError("conn-1", { _connection: staleSnapshot }, "modelA");

    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const clearObj = mocks.updateProviderConnection.mock.calls[0][1];
    // Lock model yang sukses boleh dibersihkan.
    expect(clearObj).toMatchObject({ modelLock_modelA: null });
    // Tapi error state milik kegagalan konkuren TIDAK boleh di-reset.
    expect(clearObj).not.toHaveProperty("testStatus");
    expect(clearObj).not.toHaveProperty("lastError");
    expect(clearObj).not.toHaveProperty("errorCode");
    expect(clearObj).not.toHaveProperty("backoffLevel");
  });

  it("tetap me-reset error state bila DB segar tidak punya lock aktif tersisa", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const staleSnapshot = {
      id: "conn-1",
      testStatus: "unavailable",
      lastError: "429 lama",
      errorCode: 429,
      lastErrorAt: past,
      backoffLevel: 2,
      modelLock_modelA: past,
    };
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      testStatus: "unavailable",
      lastError: "429 lama",
      errorCode: 429,
      lastErrorAt: past,
      backoffLevel: 2,
      modelLock_modelA: past,
    });

    await clearAccountError("conn-1", { _connection: staleSnapshot }, "modelA");

    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const clearObj = mocks.updateProviderConnection.mock.calls[0][1];
    expect(clearObj).toMatchObject({
      modelLock_modelA: null,
      testStatus: "active",
      lastError: null,
      errorCode: null,
      backoffLevel: 0,
    });
  });
});
