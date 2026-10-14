import { describe, it, expect } from "vitest";

import {
  clampMaxGlobalAttempts,
  QUOTA_DEFAULTS,
} from "../../open-sse/config/quotaErrorClasses.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("clampMaxGlobalAttempts (port OmniRoute #11134)", () => {
  it("default 30 bila settings tidak terbaca / tidak valid (fail-open)", () => {
    expect(clampMaxGlobalAttempts(undefined)).toBe(30);
    expect(clampMaxGlobalAttempts(NaN)).toBe(30);
    expect(clampMaxGlobalAttempts(Infinity)).toBe(30);
    expect(clampMaxGlobalAttempts("bukan-angka")).toBe(30);
    expect(clampMaxGlobalAttempts({})).toBe(30);
    // null → Number(null) === 0 → ikut clamp bawah (pola sama
    // seperti clampQuotaMaxFallbacks)
    expect(clampMaxGlobalAttempts(null)).toBe(1);
  });

  it("clamp bawah ke 1", () => {
    expect(clampMaxGlobalAttempts(0)).toBe(1);
    expect(clampMaxGlobalAttempts(-5)).toBe(1);
  });

  it("clamp atas ke 200 (hard cap anti runaway)", () => {
    expect(clampMaxGlobalAttempts(201)).toBe(200);
    expect(clampMaxGlobalAttempts(1000)).toBe(200);
  });

  it("nilai normal lolos apa adanya, desimal di-floor", () => {
    expect(clampMaxGlobalAttempts(1)).toBe(1);
    expect(clampMaxGlobalAttempts(50)).toBe(50);
    expect(clampMaxGlobalAttempts(200)).toBe(200);
    expect(clampMaxGlobalAttempts(30.7)).toBe(30);
    expect(clampMaxGlobalAttempts("42")).toBe(42);
  });

  it("QUOTA_DEFAULTS mirror DEFAULT_SETTINGS (30)", () => {
    expect(QUOTA_DEFAULTS.maxGlobalAttempts).toBe(30);
  });
});

describe("DEFAULT_SETTINGS.maxGlobalAttempts", () => {
  it("default 30 via mergeWithDefaults, nilai eksplisit dipertahankan", async () => {
    const { mergeWithDefaults } = await import(
      "@/lib/db/repos/settingsRepo.js"
    );
    expect(mergeWithDefaults({}).maxGlobalAttempts).toBe(30);
    expect(mergeWithDefaults({ maxGlobalAttempts: 10 }).maxGlobalAttempts).toBe(10);
    // undefined eksplisit tetap diisi default (backward compat)
    expect(
      mergeWithDefaults({ maxGlobalAttempts: undefined }).maxGlobalAttempts
    ).toBe(30);
  });
});

describe("handleComboChat menghormati maxGlobalAttempts", () => {
  const silentLog = { info() {}, debug() {}, warn() {} };
  const models = ["p/m1", "p/m2", "p/m3", "p/m4", "p/m5"];

  async function runCombo(maxGlobalAttempts) {
    let calls = 0;
    const opts = {
      body: {},
      models,
      handleSingleModel: async () => {
        calls++;
        throw new Error("boom");
      },
      log: silentLog,
      comboName: "test-combo",
    };
    if (maxGlobalAttempts !== undefined) opts.maxGlobalAttempts = maxGlobalAttempts;
    const res = await handleComboChat(opts);
    return { calls, status: res.status };
  }

  it("budget 2 → hanya 2 model dicoba lalu berhenti", async () => {
    const { calls, status } = await runCombo(2);
    expect(calls).toBe(2);
    expect(status).toBe(500);
  });

  it("budget melebihi jumlah model → semua model dicoba", async () => {
    const { calls } = await runCombo(200);
    expect(calls).toBe(5);
  });

  it("tanpa maxGlobalAttempts → perilaku default tidak berubah (semua model dicoba)", async () => {
    const { calls } = await runCombo(undefined);
    expect(calls).toBe(5);
  });

  it("nilai mentah di-clamp di titik konsumsi (0 → 1)", async () => {
    const { calls } = await runCombo(0);
    expect(calls).toBe(1);
  });
});
