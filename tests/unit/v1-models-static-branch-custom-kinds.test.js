import { describe, expect, it, vi, beforeEach } from "vitest";

// Regresi katalog /v1/models: saat TIDAK ada koneksi aktif berkredensial,
// buildModelsList memakai cabang statis. Cabang itu mempublikasikan custom
// model HANYA ke daftar LLM (dan hanya yang type-nya llm/tidak diset),
// sehingga custom model image/tts/stt/embedding yang dipin user hilang dari
// /v1/models/{kind} — padahal cabang berkoneksi memfilternya per-kind via
// getModelKind. Dengan nol koneksi, /v1/models/image harus tetap menampilkan
// custom model image (discovery, sama seperti model registry statis).
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => [
    { id: "my-img", type: "image", providerAlias: "myalias" },
    { id: "my-chat", type: "llm", providerAlias: "myalias" },
  ]),
  getModelAliases: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
  getDisabledModels: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

const { buildModelsList, invalidateModelsCache } = await import(
  "../../src/app/api/v1/models/route.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  invalidateModelsCache();
});

describe("/v1/models cabang statis (nol koneksi) + custom model per-kind", () => {
  it("menampilkan custom model image di /v1/models/image", async () => {
    const data = await buildModelsList(["image"]);
    const ids = data.map((m) => m.id);
    expect(ids).toContain("myalias/my-img");
    expect(ids).not.toContain("myalias/my-chat");
  });

  it("tetap menampilkan custom model llm di daftar llm", async () => {
    const data = await buildModelsList(["llm"]);
    const ids = data.map((m) => m.id);
    expect(ids).toContain("myalias/my-chat");
    expect(ids).not.toContain("myalias/my-img");
  });
});
