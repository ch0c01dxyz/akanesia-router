import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(), markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true, cooldownMs: 30000 })),
  core: vi.fn(), settings: vi.fn(async () => ({ requireApiKey: false, quotaMaxFallbacks: 1 })),
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.settings }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials, markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(), extractApiKey: vi.fn(() => null), isValidApiKey: vi.fn(async () => true),
}));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: vi.fn(async () => ({ provider: "openai", model: "test-model" })), getComboModels: vi.fn(async () => null) }));
vi.mock("@/sse/services/keyAccess.js", () => ({ getKeyAccessContext: vi.fn(async () => ({})), enforceKeyAccess: vi.fn(async () => null), filterAdapterModels: vi.fn(async (key, models) => models) }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: vi.fn(async (provider, c) => c), updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.core }));
const { handleChat } = await import("../../src/sse/handlers/chat.js");

const request = (signal) => new Request("http://localhost/v1/chat/completions", {
  signal,
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "openai/test-model", messages: [{ role: "user", content: "hello" }], stream: false }),
});
beforeEach(() => {
  vi.clearAllMocks();
  let id = 0;
  mocks.getProviderCredentials.mockImplementation(async () => ({ connectionId: `account-${id++}`, providerSpecificData: {} }));
  mocks.core.mockImplementation(async () => ({ success: false, status: 429, error: "rate limited",
    response: Response.json({ error: { message: "rate limited" } }, { status: 429, headers: { "retry-after": "30" } }) }));
});

describe("bounded account fallback", () => {
  it("does not start a single-account request after the client aborts", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "only", activeAccountCount: 1 });
    expect((await handleChat(request(AbortSignal.abort()))).status).toBe(499);
    expect(mocks.core).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("stops an in-flight single-account abort without penalizing the account", async () => {
    const controller = new AbortController();
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "only", activeAccountCount: 1 });
    mocks.core.mockImplementationOnce(async ({ clientSignal }) => {
      controller.abort();
      expect(clientSignal.aborted).toBe(true);
      return { success: false, status: 499 };
    });
    expect((await handleChat(request(controller.signal))).status).toBe(499);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("preserves fallback after client abort for a multiple-account provider", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "multiple", activeAccountCount: 2 });
    mocks.core.mockResolvedValueOnce({ success: false, status: 502, error: "network", response: Response.json({}, { status: 502 }) })
      .mockResolvedValueOnce({ success: true, response: Response.json({ choices: [] }) });
    expect((await handleChat(request(AbortSignal.abort()))).status).toBe(200);
    expect(mocks.core).toHaveBeenCalledTimes(2);
    expect(mocks.core.mock.calls[0][0].clientSignal).toBeUndefined();
  });

  it("stops fallback when the shared connection budget expires without locking the account", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    mocks.core.mockImplementationOnce(async ({ upstreamDeadline }) => {
      now.mockReturnValue(upstreamDeadline);
      return { success: false, status: 504 };
    });
    try {
      expect((await handleChat(request())).status).toBe(504);
      expect(mocks.core).toHaveBeenCalledTimes(1);
      expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    } finally { now.mockRestore(); }
  });
  it("stops a large exhausted pool at one initial attempt plus the configured fallback count", async () => {
    const response = await handleChat(request());
    expect(mocks.core).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("can still succeed on the last permitted account", async () => {
    mocks.core.mockResolvedValueOnce({ success: false, status: 429, error: "limited", response: Response.json({}, { status: 429 }) })
      .mockResolvedValueOnce({ success: true, response: Response.json({ choices: [] }) });
    expect((await handleChat(request())).status).toBe(200);
    expect(mocks.core).toHaveBeenCalledTimes(2);
  });

  it("keeps a cached upstream rate-limit status and retry time", async () => {
    mocks.getProviderCredentials.mockResolvedValueOnce({ allRateLimited: true, lastErrorCode: 429,
      lastError: "rate limited", retryAfter: new Date(Date.now() + 30000).toISOString(), retryAfterHuman: "30s" });
    const response = await handleChat(request());
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(mocks.core).not.toHaveBeenCalled();
  });
});
