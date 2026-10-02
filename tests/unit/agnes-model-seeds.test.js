import { describe, expect, it } from "vitest";

import agnes from "../../open-sse/providers/registry/agnes.js";

// Seed untuk Agnes AI. Katalog live (apihub.agnes-ai.com/v1/models) menjawab
// 401 tanpa token, jadi id ini set awal kurasi dan passthroughModels tetap
// menerima id apapun yang dimiliki akun.

describe("agnes registry model seeds", () => {
  it("mendeklarasikan empat model 2.5/3.0", () => {
    expect(agnes.models.map((m) => m.id)).toEqual([
      "agnes-2.5-flash",
      "agnes-2.5-pro",
      "agnes-2.5-pro-beta",
      "agnes-3.0-flash",
    ]);
  });

  it("memberi setiap model nama tampilan", () => {
    for (const m of agnes.models) {
      expect(typeof m.name, m.id).toBe("string");
      expect(m.name.length, m.id).toBeGreaterThan(0);
    }
  });

  it("mempertahankan passthroughModels agar id baru tetap jalan", () => {
    expect(agnes.passthroughModels).toBe(true);
  });

  it("tidak mengklaim modelsFetcher untuk endpoint yang butuh token", () => {
    // /v1/models mengembalikan 401 "Token not provided" tanpa auth, jadi
    // modelsFetcher publik hanya akan menampilkan error, bukan daftar.
    expect(agnes.modelsFetcher).toBeUndefined();
  });

  it("membiarkan transport tidak berubah", () => {
    expect(agnes.transport.baseUrl).toBe("https://apihub.agnes-ai.com/v1/chat/completions");
    expect(agnes.transport.validateUrl).toBe("https://apihub.agnes-ai.com/v1/models");
  });
});
