import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pencatat insiden #4: verifikasi dipanggil dengan argumen yang benar,
// tanpa menyentuh DB asli.
vi.mock("../../src/sse/services/quotaIncidents.js", () => ({
  recordFailure: vi.fn(async () => ({ errorClass: "quota_exhausted", retryable: false })),
}));

// Mock quota API upstream: tanpa network.
vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: vi.fn(),
}));

// Mock proxy config: tanpa side effect.
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
}));

import { handleAntigravityQuotaError } from "../../src/sse/services/antigravityQuota.js";
import { recordFailure } from "../../src/sse/services/quotaIncidents.js";
import { getAntigravityUsage } from "open-sse/services/usage/google.js";

const recordFailureMock = vi.mocked(recordFailure);
const getUsageMock = vi.mocked(getAntigravityUsage);

beforeEach(() => {
  vi.clearAllMocks();
});

function optimisticQuotas(model) {
  return { quotas: { [model]: { remainingPercentage: 80 } } };
}

describe("antigravity quota -> dashboard insiden #4", () => {
  it("strike ke-3 (blokir 15m) mencatat insiden quota_exhausted", async () => {
    const conn = `conn-strike-${Date.now()}`;
    const model = "gemini-3-pro";
    getUsageMock.mockResolvedValue(optimisticQuotas(model));

    expect(await handleAntigravityQuotaError(conn, 429, model, "tok", {})).toBeNull();
    expect(await handleAntigravityQuotaError(conn, 429, model, "tok", {})).toBeNull();
    expect(recordFailureMock).not.toHaveBeenCalled();

    const blockedUntil = await handleAntigravityQuotaError(conn, 429, model, "tok", {});
    expect(typeof blockedUntil).toBe("number");
    expect(blockedUntil).toBeGreaterThan(Date.now());

    expect(recordFailureMock).toHaveBeenCalledTimes(1);
    expect(recordFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: conn,
        model,
        provider: "antigravity",
        status: 429,
      })
    );
    const errorText = recordFailureMock.mock.calls[0][0].errorText;
    expect(errorText.toLowerCase()).toContain("quota");
  });

  it("upstream exhausted (0% + resetAt) mencatat insiden", async () => {
    const conn = `conn-exhausted-${Date.now()}`;
    const model = "gemini-3-pro";
    const resetAt = new Date(Date.now() + 3600_000).toISOString();
    getUsageMock.mockResolvedValue({
      quotas: { [model]: { remainingPercentage: 0, resetAt } },
    });

    const resetMs = await handleAntigravityQuotaError(conn, 429, model, "tok", {});
    expect(resetMs).toBe(new Date(resetAt).getTime());
    expect(recordFailureMock).toHaveBeenCalledTimes(1);
    expect(recordFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: conn, model, provider: "antigravity" })
    );
  });

  it("strike di bawah threshold tidak mencatat insiden", async () => {
    const conn = `conn-noblock-${Date.now()}`;
    const model = "gemini-3-pro";
    getUsageMock.mockResolvedValue(optimisticQuotas(model));

    expect(await handleAntigravityQuotaError(conn, 429, model, "tok", {})).toBeNull();
    expect(recordFailureMock).not.toHaveBeenCalled();
  });
});
