import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyQuotaError, ERROR_CLASSES } from "../../open-sse/config/quotaErrorClasses.js";
import { isSuspensionSignal } from "../../open-sse/utils/accountSuspension.js";

vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  updateProviderConnection: vi.fn(async (id, data) => ({ id, ...data })),
}));
vi.mock("@/sse/services/quotaIncidents.js", () => ({
  recordFailure: vi.fn(async () => ({ errorClass: "suspended", retryable: false })),
}));

const { autoDisableSuspendedAccount } = await import("../../open-sse/utils/accountSuspension.js");
const { updateProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
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
});
