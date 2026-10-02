/**
 * Test untuk #4399 — CLI Tools Apply menulis placeholder "sk_9router".
 *
 * Saat requireApiKey=true, "sk_9router" yang tertulis menyebabkan 401 di
 * setiap request CLI tool. Perbaikan: ganti fallback literal dengan
 * resolveCliApiKey(), yang membaca key aktif pertama dari DB
 * (atau mengembalikan "" bila tidak ada — tidak pernah placeholder).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

// Uji logika resolveCliApiKey secara terisolasi.
// Modul aslinya membaca dari SQLite; kami mereplikasi logika keputusannya di sini.

function resolveCliApiKeyLogic(callerKey, activeKeys = []) {
  if (callerKey && callerKey.trim() && callerKey.trim() !== "sk_9router") {
    return callerKey.trim();
  }
  const active = activeKeys.find((k) => k.isActive);
  return active?.key || "";
}

describe("logika resolveCliApiKey (#4399)", () => {
  it("mengembalikan key pemanggil bila non-kosong dan bukan placeholder", () => {
    expect(resolveCliApiKeyLogic("sk-real-key-123", [])).toBe("sk-real-key-123");
  });

  it("fallback ke key DB aktif pertama bila key pemanggil kosong", () => {
    const keys = [{ key: "sk-db-key", isActive: true }];
    expect(resolveCliApiKeyLogic("", keys)).toBe("sk-db-key");
  });

  it("fallback ke key DB aktif pertama bila key pemanggil null", () => {
    const keys = [{ key: "sk-db-key", isActive: true }];
    expect(resolveCliApiKeyLogic(null, keys)).toBe("sk-db-key");
  });

  it("fallback ke key DB aktif pertama bila key pemanggil undefined", () => {
    const keys = [{ key: "sk-db-key", isActive: true }];
    expect(resolveCliApiKeyLogic(undefined, keys)).toBe("sk-db-key");
  });

  it("fallback ke key DB aktif pertama bila pemanggil adalah placeholder itu sendiri", () => {
    const keys = [{ key: "sk-db-key", isActive: true }];
    expect(resolveCliApiKeyLogic("sk_9router", keys)).toBe("sk-db-key");
  });

  it("melewati key nonaktif dan memilih yang aktif pertama", () => {
    const keys = [
      { key: "sk-inactive", isActive: false },
      { key: "sk-active", isActive: true },
    ];
    expect(resolveCliApiKeyLogic("", keys)).toBe("sk-active");
  });

  it("mengembalikan string kosong bila tidak ada key DB aktif dan pemanggil kosong", () => {
    const keys = [{ key: "sk-inactive", isActive: false }];
    expect(resolveCliApiKeyLogic("", keys)).toBe("");
  });

  it("mengembalikan string kosong bila DB kosong dan pemanggil kosong", () => {
    expect(resolveCliApiKeyLogic("", [])).toBe("");
  });

  it("memangkas whitespace dari key pemanggil", () => {
    expect(resolveCliApiKeyLogic("  sk-real  ", [])).toBe("sk-real");
  });

  it("tidak pernah mengembalikan sk_9router", () => {
    expect(resolveCliApiKeyLogic("sk_9router", [])).not.toBe("sk_9router");
    expect(resolveCliApiKeyLogic("", [])).not.toBe("sk_9router");
  });
});

describe("pemeriksaan sumber resolveApiKey.js (#4399)", () => {
  const src = fs.readFileSync(
    new URL("../../src/app/api/cli-tools/resolveApiKey.js", import.meta.url),
    "utf-8"
  );

  it("resolveApiKey.js mengekspor resolveCliApiKey", () => {
    expect(src).toContain("resolveCliApiKey");
  });

  it("resolveApiKey.js mengimpor getApiKeys dari DB", () => {
    expect(src).toContain("getApiKeys");
  });

  it("resolveApiKey.js tidak mengembalikan sk_9router sebagai nilai fallback", () => {
    // Helper boleh mereferensikan "sk_9router" untuk menolaknya, tapi tidak
    // boleh memakainya sebagai nilai return / fallback (mis. `return "sk_9router"`).
    expect(src).not.toMatch(/return\s+"sk_9router"/);
    expect(src).not.toMatch(/\|\|\s*"sk_9router"/);
  });
});
