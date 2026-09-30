// Ide #5c "Probe LLM" — unit test fungsi statistik JSD + normalisasi jawaban.
// Modul: open-sse/services/probe.js (kontrak dari worker backend).
// Test ditulis terhadap kontrak; modul di-import langsung via alias "open-sse/".
import { describe, it, expect } from "vitest";
import {
  normalizeAnswer,
  jsdBase2,
  distributionOf,
  jsdVsReference,
  splitHalfJsd,
} from "open-sse/services/probe.js";

describe("normalizeAnswer", () => {
  it('"  Blue! " → "blue" (trim, lowercase, buang tanda baca trailing)', () => {
    expect(normalizeAnswer("  Blue! ")).toBe("blue");
  });

  it('"GREY" → "gray" (kanonikalisasi warna)', () => {
    expect(normalizeAnswer("GREY")).toBe("gray");
  });

  it('full-width digit "４２" → "42" (NFKC)', () => {
    expect(normalizeAnswer("４２")).toBe("42");
  });

  it('"Red." → "red" (buang titik trailing)', () => {
    expect(normalizeAnswer("Red.")).toBe("red");
  });

  it("idempoten: normalisasi ganda hasilnya sama", () => {
    expect(normalizeAnswer(normalizeAnswer("  GREY! "))).toBe("gray");
  });
});

describe("jsdBase2", () => {
  it("distribusi identik (objek probabilitas) → 0", () => {
    const v = jsdBase2({ a: 0.5, b: 0.5 }, { a: 0.5, b: 0.5 });
    expect(v).toBeLessThan(1e-9);
  });

  it("distribusi identik (array counts, total beda) → 0", () => {
    // [2,2] dan [1,1] adalah distribusi yang sama → counts dinormalisasi.
    const v = jsdBase2([2, 2], [1, 1]);
    expect(v).toBeLessThan(1e-9);
  });

  it("distribusi disjoint → ~1 (maksimum JSD basis-2)", () => {
    const v = jsdBase2({ a: 1 }, { b: 1 });
    expect(v).toBeCloseTo(1, 6);
  });

  it("simetris: jsd(p,q) === jsd(q,p)", () => {
    const p = { a: 0.7, b: 0.2, c: 0.1 };
    const q = { a: 0.3, b: 0.3, c: 0.4 };
    expect(jsdBase2(p, q)).toBeCloseTo(jsdBase2(q, p), 10);
  });

  it("rentang 0–1 untuk 50 input acak", () => {
    for (let i = 0; i < 50; i += 1) {
      const len = 2 + Math.floor(Math.random() * 5);
      const acak = () =>
        Array.from({ length: len }, () => 1 + Math.floor(Math.random() * 50));
      const v = jsdBase2(acak(), acak());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("distributionOf", () => {
  it('["a","b","a"] → {a:2,b:1}', () => {
    expect(distributionOf(["a", "b", "a"])).toEqual({ a: 2, b: 1 });
  });

  it("array kosong → objek kosong", () => {
    expect(distributionOf([])).toEqual({});
  });
});

describe("jsdVsReference", () => {
  it("sampel identik dengan referensi → kecil (<0.05)", () => {
    const v = jsdVsReference(["a", "a", "b", "a"], { a: 3, b: 1 });
    expect(v).toBeLessThan(0.05);
  });

  it("sampel beda total dengan referensi → besar (>0.9)", () => {
    const v = jsdVsReference(["z", "z", "z"], { a: 3, b: 1 });
    expect(v).toBeGreaterThan(0.9);
  });
});

describe("splitHalfJsd", () => {
  it("sampel homogen → kecil (dua paruh mirip)", () => {
    const sampel = ["a", "a", "b", "a", "b", "a", "a", "b", "a", "a"];
    expect(splitHalfJsd(sampel)).toBeLessThan(0.2);
  });

  it("dua paruh beda distribusi → besar (simulasi backend rotation)", () => {
    const sampel = ["a", "a", "a", "a", "a", "b", "b", "b", "b", "b"];
    expect(splitHalfJsd(sampel)).toBeGreaterThan(0.9);
  });

  it("hasil selalu dalam rentang 0–1", () => {
    const v = splitHalfJsd(["a", "b", "a", "b", "a", "b"]);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
