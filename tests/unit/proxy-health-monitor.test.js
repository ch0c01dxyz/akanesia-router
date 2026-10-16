// Proxy Relay Health Monitor: counter, auto-disable, monthly reset
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-health-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function repos() {
  return import("@/lib/db/repos/proxyPoolsRepo.js");
}

async function makePool(data = {}) {
  const repo = await repos();
  return repo.createProxyPool({
    name: "test-pool",
    proxyUrl: "http://127.0.0.1:7897",
    ...data,
  });
}

describe("recordProxyFailure", () => {
  it("counter bertambah 1, 2 tanpa disable", async () => {
    const repo = await repos();
    const pool = await makePool();
    const r1 = await repo.recordProxyFailure(pool.id, "timeout");
    expect(r1.consecutiveFailures).toBe(1);
    expect(r1.isActive).toBe(true);
    const r2 = await repo.recordProxyFailure(pool.id, "timeout");
    expect(r2.consecutiveFailures).toBe(2);
    expect(r2.isActive).toBe(true);
  });

  it("auto-disable tepat di kegagalan ke-3", async () => {
    const repo = await repos();
    const pool = await makePool();
    await repo.recordProxyFailure(pool.id, "e1");
    await repo.recordProxyFailure(pool.id, "e2");
    const r3 = await repo.recordProxyFailure(pool.id, "limit tercapai");
    expect(r3.consecutiveFailures).toBe(3);
    expect(r3.isActive).toBe(false);
    expect(r3.disabledReason).toBe("auto");
    expect(r3.disabledAt).toBeTruthy();
    expect(r3.lastError).toBe("limit tercapai");
  });

  it("pool tidak ada → null, tidak throw", async () => {
    const repo = await repos();
    expect(await repo.recordProxyFailure("tidak-ada", "x")).toBeNull();
  });
});

describe("recordProxySuccess", () => {
  it("reset counter ke 0 dan bersihkan reason", async () => {
    const repo = await repos();
    const pool = await makePool();
    await repo.recordProxyFailure(pool.id, "e1");
    await repo.recordProxyFailure(pool.id, "e2");
    const ok = await repo.recordProxySuccess(pool.id);
    expect(ok.consecutiveFailures).toBe(0);
    expect(ok.disabledReason).toBeNull();
    expect(ok.testStatus).toBe("active");
    expect(ok.lastError).toBeNull();
  });
});

describe("monthlyResetProxyPools", () => {
  it("aktifkan kembali pool auto-disable bulan lalu", async () => {
    const repo = await repos();
    const pool = await makePool();
    await repo.recordProxyFailure(pool.id, "e1");
    await repo.recordProxyFailure(pool.id, "e2");
    await repo.recordProxyFailure(pool.id, "e3");
    // Simulasikan disabled bulan lalu
    await repo.updateProxyPool(pool.id, { lastMonthlyReset: "2020-01" });
    const { reset } = await repo.monthlyResetProxyPools();
    expect(reset).toBe(1);
    const after = await repo.getProxyPoolById(pool.id);
    expect(after.isActive).toBe(true);
    expect(after.consecutiveFailures).toBe(0);
    expect(after.disabledReason).toBeNull();
  });

  it("skip bila sudah di-reset bulan ini", async () => {
    const repo = await repos();
    const pool = await makePool();
    await repo.recordProxyFailure(pool.id, "e1");
    await repo.recordProxyFailure(pool.id, "e2");
    await repo.recordProxyFailure(pool.id, "e3");
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await repo.updateProxyPool(pool.id, { lastMonthlyReset: monthKey });
    const { reset } = await repo.monthlyResetProxyPools();
    expect(reset).toBe(0);
  });

  it("skip pool yang di-disable manual", async () => {
    const repo = await repos();
    const pool = await makePool({ isActive: false });
    await repo.updateProxyPool(pool.id, { disabledReason: "manual", lastMonthlyReset: "2020-01" });
    const { reset } = await repo.monthlyResetProxyPools();
    expect(reset).toBe(0);
    const after = await repo.getProxyPoolById(pool.id);
    expect(after.isActive).toBe(false);
  });

  it("skip pool aktif normal", async () => {
    const repo = await repos();
    await makePool();
    const { reset } = await repo.monthlyResetProxyPools();
    expect(reset).toBe(0);
  });
});

describe("MAX_CONSECUTIVE_FAILURES", () => {
  it("bernilai 3", async () => {
    const repo = await repos();
    expect(repo.MAX_CONSECUTIVE_FAILURES).toBe(3);
  });
});
