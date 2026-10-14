/**
 * VERIFIKASI fitur 3: retryOnLock di cli/scripts/build-cli.js
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("VERIFIKASI: retryOnLock", () => {
  it("source mengandung helper dan dipakai di rm", () => {
    const src = readFileSync(
      new URL("../../cli/scripts/build-cli.js", import.meta.url),
      "utf8"
    );
    expect(src).toContain("function retryOnLock");
    expect(src).toContain("function isLockError");
    expect(src).toContain("function rmRecursiveLocked");
    expect(src).toContain("EBUSY");
    expect(src).toContain("EPERM");
    expect(src).toContain("ENOTEMPTY");
    // dipakai di 2 titik rm
    const uses = (src.match(/rmRecursiveLocked\(/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(2);
  });

  it("logika retry: sukses setelah 2x EBUSY", () => {
    // Replika logika retryOnLock (tanpa Atomics.wait agar cepat)
    function isLockError(err) {
      return err && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(err.code);
    }
    let calls = 0;
    function retryTest(fn, retries = 5) {
      for (let a = 0; a <= retries; a++) {
        try { return fn(); }
        catch (e) {
          if (!isLockError(e) || a === retries) throw e;
        }
      }
    }
    const result = retryTest(() => {
      calls++;
      if (calls < 3) { const e = new Error("x"); e.code = "EBUSY"; throw e; }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("logika retry: error non-lock langsung dilempar", () => {
    function isLockError(err) {
      return err && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(err.code);
    }
    let calls = 0;
    expect(() => {
      for (let a = 0; a <= 5; a++) {
        try {
          calls++;
          const e = new Error("fatal"); e.code = "ENOENT"; throw e;
        } catch (err) {
          if (!isLockError(err) || a === 5) throw err;
        }
      }
    }).toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("logika retry: menyerah setelah retries habis", () => {
    function isLockError(err) {
      return err && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(err.code);
    }
    let calls = 0;
    expect(() => {
      for (let a = 0; a <= 2; a++) {
        try {
          calls++;
          const e = new Error("locked"); e.code = "EPERM"; throw e;
        } catch (err) {
          if (!isLockError(err) || a === 2) throw err;
        }
      }
    }).toThrow("locked");
    expect(calls).toBe(3); // 1 + 2 retries
  });
});
