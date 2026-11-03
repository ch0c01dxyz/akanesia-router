import { describe, it, expect } from "vitest";

import { buildCombosExport, parseComboImportFile } from "../../src/lib/combosPortable.js";

describe("combos portable export/import (secret-free)", () => {
  it("export tidak membawa field sensitif walau objek combo mengandungnya", () => {
    const exported = buildCombosExport(
      [
        { name: "Main", kind: "llm", models: ["openai/gpt-5"], apiKey: "sk-harus-hilang", secret: "x" },
        { name: "Kedua", kind: null, models: [] },
      ],
      { Main: { fallbackStrategy: "fallback" } }
    );
    const text = JSON.stringify(exported);
    expect(text).not.toMatch(/sk-harus-hilang|apiKey|secret/);
    expect(exported.combos).toEqual([
      { name: "Main", kind: "llm", models: ["openai/gpt-5"], strategy: { fallbackStrategy: "fallback" } },
      { name: "Kedua", kind: null, models: [] },
    ]);
    expect(exported.version).toBe(1);
    expect(typeof exported.exportedAt).toBe("string");
  });

  it("round-trip export -> import menghasilkan combo yang sama", () => {
    const exported = buildCombosExport(
      [{ name: "A", kind: "llm", models: ["a/m1", "b/m2"] }],
      { A: { fallbackStrategy: "fallback", routerModel: "nace/drex-max" } }
    );
    const parsed = parseComboImportFile({ ...exported, mode: "merge" });
    expect(parsed.ok).toBe(true);
    expect(parsed.mode).toBe("merge");
    expect(parsed.combos).toEqual([
      { name: "A", kind: "llm", models: ["a/m1", "b/m2"], strategy: { fallbackStrategy: "fallback", routerModel: "nace/drex-max" } },
    ]);
  });

  it("import menolak file malformed", () => {
    expect(parseComboImportFile(null).ok).toBe(false);
    expect(parseComboImportFile({ combos: "bukan-array" }).ok).toBe(false);
    expect(parseComboImportFile({ combos: [{ name: "bad name!", models: [] }] }).ok).toBe(false);
    expect(parseComboImportFile({ combos: [{ name: "ok", models: "bukan-array" }] }).ok).toBe(false);
    expect(parseComboImportFile({ combos: [{ name: "ok", models: [] }], mode: "hapus" }).ok).toBe(false);
    expect(parseComboImportFile({ combos: [{ name: "a", models: [] }, { name: "a", models: [] }] }).ok).toBe(false);
  });

  it("import menolak field tak dikenal dan field sensitif (termasuk di dalam strategy)", () => {
    expect(parseComboImportFile({ combos: [{ name: "a", models: [], apiKey: "sk-x" }] }).ok).toBe(false);
    expect(parseComboImportFile({ combos: [{ name: "a", models: [], strategy: { token: "t" } }] }).ok).toBe(false);
    expect(parseComboImportFile({ combos: [{ name: "a", models: [], tidakDikenal: 1 }] }).ok).toBe(false);
    expect(parseComboImportFile({ combos: [{ name: "a", models: [] }], password: "p" }).ok).toBe(false);
  });
});
