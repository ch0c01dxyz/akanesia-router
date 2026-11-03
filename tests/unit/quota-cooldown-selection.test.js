import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(), getProviderConnectionById: vi.fn(), validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(async () => {}), getSettings: vi.fn(async () => ({})), getProxyPools: vi.fn(async () => []),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})), pickProxyPoolId: vi.fn() }));
vi.mock("@/sse/services/quotaIncidents.js", () => ({ recordFailure: vi.fn(), recordSuccess: vi.fn() }));
const { getProviderCredentials, markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const now = Date.parse("2026-11-03T10:00:00Z");
const at = seconds => new Date(now + seconds * 1000).toISOString();
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe("quota cooldown selection", () => {
  it("reports the first usable requested-model account, not an unrelated shorter lock", async () => {
    db.getProviderConnections.mockResolvedValue([
      { id: "slow", modelLock_requested: at(120), modelLock_other: at(1), errorCode: 402, lastError: "no credits" },
      { id: "soon", modelLock_requested: at(90), modelLock_other: at(2), errorCode: 429, lastError: "rate limited" },
    ]);
    const result = await getProviderCredentials("openai", null, "requested");
    expect(result).toMatchObject({ allRateLimited: true, retryAfter: at(90), lastErrorCode: 429, lastError: "rate limited" });
  });

  it("waits for an account-wide lock even when its requested-model lock expires sooner", async () => {
    db.getProviderConnections.mockResolvedValue([
      { id: "blocked", modelLock_requested: at(10), modelLock___all: at(120), errorCode: 429 },
    ]);
    expect((await getProviderCredentials("openai", null, "requested")).retryAfter).toBe(at(120));
  });

  it("persists an exact upstream reset instead of a shorter configured override", async () => {
    db.getProviderConnections.mockResolvedValue([{ id: "limited", backoffLevel: 0 }]);
    db.getSettings.mockResolvedValue({ providerRetryDelaySeconds: { openai: 1 } });
    const result = await markAccountUnavailable("limited", 429, "rate limited", "openai", "requested", now + 113000);
    expect(result).toMatchObject({ shouldFallback: true, cooldownMs: 113000 });
    expect(db.updateProviderConnection).toHaveBeenCalledWith("limited", expect.objectContaining({ modelLock_requested: at(113), errorCode: 429 }));
  });
});
