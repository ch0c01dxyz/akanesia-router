// Retensi otomatis folder logs/: hanya N byte data paling baru disimpan,
// sesi/file terlama dihapus otomatis bila melebihi REQUEST_LOG_MAX_BYTES.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const origCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reqlog-retensi-"));
const logsDir = () => path.join(tmpRoot, "logs");

process.chdir(tmpRoot);
process.env.ENABLE_REQUEST_LOGS = "true";

const { createRequestLogger, __test__ } = await import(
  "../../open-sse/utils/requestLogger.js"
);

function totalBytes() {
  let total = 0;
  for (const d of fs.readdirSync(logsDir())) {
    const p = path.join(logsDir(), d);
    for (const f of fs.readdirSync(p)) total += fs.statSync(path.join(p, f)).size;
  }
  return total;
}

function bersih() {
  fs.rmSync(logsDir(), { recursive: true, force: true });
}

beforeAll(() => {
  fs.mkdirSync(logsDir(), { recursive: true });
});

afterAll(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("requestLogger: retensi logs/", () => {
  it("default 10MB; 0 = tanpa batas; nilai invalid = default", () => {
    delete process.env.REQUEST_LOG_MAX_BYTES;
    expect(__test__.requestLogMaxBytes()).toBe(10 * 1024 * 1024);
    process.env.REQUEST_LOG_MAX_BYTES = "0";
    expect(__test__.requestLogMaxBytes()).toBe(0);
    process.env.REQUEST_LOG_MAX_BYTES = "abc";
    expect(__test__.requestLogMaxBytes()).toBe(10 * 1024 * 1024);
    process.env.REQUEST_LOG_MAX_BYTES = "-5";
    expect(__test__.requestLogMaxBytes()).toBe(10 * 1024 * 1024);
  });

  it("menghapus sesi terlama hingga total <= batas", async () => {
    bersih();
    process.env.REQUEST_LOG_MAX_BYTES = String(1 * 1024 * 1024); // 1MB
    const dibuat = [];
    for (let i = 0; i < 4; i++) {
      const logger = await createRequestLogger("claude", "openai", "m" + i);
      fs.writeFileSync(path.join(logger.sessionPath, "big.json"), "x".repeat(400 * 1024));
      dibuat.push(logger.sessionPath);
      await new Promise((r) => setTimeout(r, 25)); // bedakan mtime
    }
    expect(totalBytes()).toBeGreaterThan(1 * 1024 * 1024);

    __test__.resetRetentionThrottle();
    await __test__.enforceLogRetention();

    expect(totalBytes()).toBeLessThanOrEqual(1 * 1024 * 1024);
    const sisa = fs.readdirSync(logsDir());
    expect(sisa.length).toBeLessThan(4);
    // Sesi terlama (m0) harus terhapus, sesi terbaru bertahan.
    const namaSisa = sisa.join(" ");
    expect(namaSisa).not.toContain("_m0_");
  });

  it("tidak menghapus apa pun bila masih di bawah batas", async () => {
    bersih();
    process.env.REQUEST_LOG_MAX_BYTES = String(100 * 1024 * 1024);
    for (let i = 0; i < 2; i++) {
      const logger = await createRequestLogger("claude", "openai", "k" + i);
      fs.writeFileSync(path.join(logger.sessionPath, "a.json"), "{}");
    }
    __test__.resetRetentionThrottle();
    await __test__.enforceLogRetention();
    expect(fs.readdirSync(logsDir()).length).toBe(2);
  });
});
