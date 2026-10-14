import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyQuotaError, ERROR_CLASSES } from "../../open-sse/config/quotaErrorClasses.js";
import {
  isSuspensionSignal,
  normalizeAutoDisableBannedScope,
  isSubscriptionStyleAuthType,
  shouldAutoDisableForScope,
} from "../../open-sse/utils/accountSuspension.js";

vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnectionById: vi.fn(async () => null),
  updateProviderConnection: vi.fn(async (id, data) => ({ id, ...data })),
}));
vi.mock("@/lib/db/repos/settingsRepo.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getSettings: vi.fn(async () => ({})) };
});
vi.mock("@/sse/services/quotaIncidents.js", () => ({
  recordFailure: vi.fn(async () => ({ errorClass: "suspended", retryable: false })),
}));

const { autoDisableSuspendedAccount } = await import("../../open-sse/utils/accountSuspension.js");
const { getProviderConnectionById, updateProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
const { recordFailure } = await import("@/sse/services/quotaIncidents.js");

const KIRO_MSG =
  'Kiro ListAvailableModels 403: {"message":"Your User ID (94d8e4d8) temporarily is suspended. We\'ve locked your account as a security precaution."}';

describe("isSuspensionSignal", () => {
  it("403 + 'suspended' → true (kasus Kiro)", () => {
    expect(isSuspensionSignal(403, KIRO_MSG)).toBe(true);
  });
  it("401 + 'suspended' → false (key salah bukan suspend)", () => {
    expect(isSuspensionSignal(401, "suspended account")).toBe(false);
  });
  it("403 tanpa kata suspend → false", () => {
    expect(isSuspensionSignal(403, "permission denied")).toBe(false);
  });
  it("423 + 'suspend' → true", () => {
    expect(isSuspensionSignal(423, "account suspend")).toBe(true);
  });
  it("500 + 'suspended' → false (status tidak cocok)", () => {
    expect(isSuspensionSignal(500, "suspended")).toBe(false);
  });
});

describe("classifyQuotaError", () => {
  it("403 + pesan suspend → suspended (bukan auth_error)", () => {
    expect(classifyQuotaError(403, KIRO_MSG)).toBe(ERROR_CLASSES.SUSPENDED);
    expect(classifyQuotaError(403, KIRO_MSG)).toBe("suspended");
  });
  it("403 biasa → tetap auth_error", () => {
    expect(classifyQuotaError(403, "permission denied")).toBe(ERROR_CLASSES.AUTH_ERROR);
  });
});

describe("autoDisableSuspendedAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nonaktifkan koneksi + catat insiden saat suspend terdeteksi", async () => {
    const log = { errorLine: vi.fn() };
    const ok = await autoDisableSuspendedAccount({
      connectionId: "conn-1",
      provider: "kiro",
      model: "m1",
      status: 403,
      message: KIRO_MSG,
      credentials: { connectionName: "Kiro Saya" },
      log,
    });
    expect(ok).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", { isActive: false });
    expect(recordFailure).toHaveBeenCalledOnce();
    expect(log.errorLine).toHaveBeenCalledOnce();
  });

  it("tidak melakukan apa-apa bila bukan sinyal suspend", async () => {
    const ok = await autoDisableSuspendedAccount({
      connectionId: "conn-1",
      provider: "kiro",
      status: 401,
      message: "invalid api key",
      log: { errorLine: vi.fn() },
    });
    expect(ok).toBe(false);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("tidak melakukan apa-apa tanpa connectionId", async () => {
    const ok = await autoDisableSuspendedAccount({
      status: 403,
      message: KIRO_MSG,
    });
    expect(ok).toBe(false);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("fail-open bila DB gagal", async () => {
    updateProviderConnection.mockRejectedValueOnce(new Error("db down"));
    const ok = await autoDisableSuspendedAccount({
      connectionId: "conn-1",
      provider: "kiro",
      status: 403,
      message: KIRO_MSG,
    });
    expect(ok).toBe(false);
  });
});

describe("settings default", () => {
  it("suspendAutoDisableOnCheck default OFF", async () => {
    const { mergeWithDefaults } = await import("@/lib/db/repos/settingsRepo.js");
    expect(mergeWithDefaults({}).suspendAutoDisableOnCheck).toBe(false);
    expect(mergeWithDefaults({ suspendAutoDisableOnCheck: true }).suspendAutoDisableOnCheck).toBe(true);
  });

  it("autoDisableBannedScope default 'all' (backward compatible)", async () => {
    const { mergeWithDefaults } = await import("@/lib/db/repos/settingsRepo.js");
    expect(mergeWithDefaults({}).autoDisableBannedScope).toBe("all");
    expect(mergeWithDefaults({ autoDisableBannedScope: "oauth-only" }).autoDisableBannedScope).toBe("oauth-only");
  });
});

describe("normalizeAutoDisableBannedScope", () => {
  it("'oauth-only' dipertahankan", () => {
    expect(normalizeAutoDisableBannedScope("oauth-only")).toBe("oauth-only");
  });
  it("nilai tak dikenal → 'all'", () => {
    expect(normalizeAutoDisableBannedScope("all")).toBe("all");
    expect(normalizeAutoDisableBannedScope(undefined)).toBe("all");
    expect(normalizeAutoDisableBannedScope("subscription")).toBe("all");
  });
});

describe("isSubscriptionStyleAuthType", () => {
  it("oauth/access_token/cookie → true", () => {
    expect(isSubscriptionStyleAuthType("oauth")).toBe(true);
    expect(isSubscriptionStyleAuthType("access_token")).toBe(true);
    expect(isSubscriptionStyleAuthType("cookie")).toBe(true);
    expect(isSubscriptionStyleAuthType("OAuth")).toBe(true);
  });
  it("apikey → false", () => {
    expect(isSubscriptionStyleAuthType("apikey")).toBe(false);
    expect(isSubscriptionStyleAuthType(undefined)).toBe(false);
  });
});

describe("shouldAutoDisableForScope", () => {
  it("scope 'all' → selalu true", () => {
    expect(shouldAutoDisableForScope({ scope: "all", authType: "apikey" })).toBe(true);
    expect(shouldAutoDisableForScope({ scope: undefined, authType: "apikey" })).toBe(true);
  });
  it("scope 'oauth-only' + apikey → false", () => {
    expect(shouldAutoDisableForScope({ scope: "oauth-only", authType: "apikey" })).toBe(false);
  });
  it("scope 'oauth-only' + oauth → true", () => {
    expect(shouldAutoDisableForScope({ scope: "oauth-only", authType: "oauth" })).toBe(true);
  });
  it("scope 'oauth-only' + authType tak dikenal → true (konservatif)", () => {
    expect(shouldAutoDisableForScope({ scope: "oauth-only", authType: undefined })).toBe(true);
    expect(shouldAutoDisableForScope({ scope: "oauth-only", authType: "" })).toBe(true);
  });
});

describe("autoDisableSuspendedAccount — cakupan oauth-only", () => {
  beforeEach(() => vi.clearAllMocks());

  const suspendInput = {
    connectionId: "conn-1",
    provider: "openai",
    status: 403,
    message: KIRO_MSG,
    log: { errorLine: vi.fn() },
  };

  it("melewatkan koneksi apikey saat scope=oauth-only", async () => {
    getSettings.mockResolvedValueOnce({ autoDisableBannedScope: "oauth-only" });
    getProviderConnectionById.mockResolvedValueOnce({ id: "conn-1", authType: "apikey" });
    const ok = await autoDisableSuspendedAccount(suspendInput);
    expect(ok).toBe(false);
    expect(updateProviderConnection).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("tetap menonaktifkan koneksi oauth saat scope=oauth-only", async () => {
    getSettings.mockResolvedValueOnce({ autoDisableBannedScope: "oauth-only" });
    getProviderConnectionById.mockResolvedValueOnce({ id: "conn-1", authType: "oauth" });
    const ok = await autoDisableSuspendedAccount(suspendInput);
    expect(ok).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", { isActive: false });
  });

  it("fail-open ke 'all' bila getSettings gagal", async () => {
    getSettings.mockRejectedValueOnce(new Error("db down"));
    const ok = await autoDisableSuspendedAccount(suspendInput);
    expect(ok).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", { isActive: false });
  });

  it("konservatif (tetap disable) bila koneksi tak ditemukan", async () => {
    getSettings.mockResolvedValueOnce({ autoDisableBannedScope: "oauth-only" });
    getProviderConnectionById.mockResolvedValueOnce(null);
    const ok = await autoDisableSuspendedAccount(suspendInput);
    expect(ok).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", { isActive: false });
  });
});
