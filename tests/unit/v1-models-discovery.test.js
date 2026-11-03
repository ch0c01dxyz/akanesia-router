import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
}));
const discovery = vi.hoisted(() => vi.fn());
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/compatibleModelsFetch.js", () => ({ fetchCompatibleModels: discovery }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
const { buildModelsList, invalidateModelsCache } = await import("../../src/app/api/v1/models/route.js");

beforeEach(() => {
  invalidateModelsCache();
  discovery.mockReset();
  db.getProviderConnections.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({
    id: `connection-${i}`, provider: `openai-compatible-chat-audit-${i}`, apiKey: "test-key", isActive: true,
    providerSpecificData: { prefix: `audit${i}`, baseUrl: `https://audit${i}.example/v1` },
  })));
});

describe("model catalog discovery", () => {
  it("bounds concurrency, preserves order, and coalesces simultaneous catalog requests", async () => {
    let active = 0, peak = 0;
    discovery.mockImplementation(async ({ timeoutMs }) => {
      expect(timeoutMs).toBe(5000);
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return { ok: true, models: ["model"] };
    });
    const [a, b] = await Promise.all([buildModelsList(["llm"]), buildModelsList(["llm"])]);
    expect(a).toBe(b);
    expect(discovery).toHaveBeenCalledTimes(10);
    expect(peak).toBe(8);
    expect(a.filter(m => m.id.startsWith("audit")).map(m => m.id))
      .toEqual(Array.from({ length: 10 }, (_, i) => `audit${i}/model`));
  });

  it("does not discover compatible catalogs on recursive internal requests", async () => {
    await buildModelsList(["llm"], { skipDynamicFetch: true });
    expect(discovery).not.toHaveBeenCalled();
  });

  it("keeps healthy model catalogs when one provider times out", async () => {
    discovery.mockImplementation(async ({ provider }) => provider.endsWith("-0")
      ? { ok: false, models: [], error: "timeout" }
      : { ok: true, models: ["model"] });
    const models = await buildModelsList(["llm"]);
    expect(models.some(m => m.id === "audit0/model")).toBe(false);
    expect(models.some(m => m.id === "audit9/model")).toBe(true);
  });
});
