import { describe, it, expect } from "vitest";

import {
  buildAvailableModels,
  hasActiveConnection,
  formatMs,
  parseSsePayload,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/playgroundUtils.js";

describe("buildAvailableModels", () => {
  const models = [
    { id: "m1", name: "Model Satu" },
    { id: "m2" }, // tanpa name → label fallback ke id
    { id: "" }, // tanpa id → dibuang
    null,
  ];

  it("memfilter model tanpa id dan yang di-disable", () => {
    const list = buildAvailableModels(models, [], ["m2"], "alias", "pid");
    expect(list).toEqual([{ id: "m1", label: "Model Satu" }]);
  });

  it("label fallback ke id bila name kosong", () => {
    const list = buildAvailableModels(models, [], [], "alias", "pid");
    expect(list.find((m) => m.id === "m2")).toEqual({ id: "m2", label: "m2" });
  });

  it("menggabung custom model yang cocok alias/providerId, hanya llm", () => {
    const custom = [
      { id: "c1", providerAlias: "alias", kind: "llm" },
      { id: "c2", providerAlias: "pid", type: "llm" },
      { id: "c3", providerAlias: "lain" }, // alias beda → skip
      { id: "c4", providerAlias: "alias", kind: "image" }, // bukan llm → skip
      { id: "m1", providerAlias: "alias" }, // duplikat → skip
      { id: "c5", providerAlias: "alias" }, // tanpa kind → dianggap llm
    ];
    const list = buildAvailableModels(models, custom, [], "alias", "pid");
    const ids = list.map((m) => m.id);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
    expect(ids).toContain("c5");
    expect(ids).not.toContain("c3");
    expect(ids).not.toContain("c4");
    expect(ids.filter((id) => id === "m1")).toHaveLength(1);
  });

  it("custom model yang di-disable ikut dibuang", () => {
    const list = buildAvailableModels([], [{ id: "c1", providerAlias: "alias" }], ["c1"], "alias", "pid");
    expect(list).toEqual([]);
  });

  it("aman terhadap input kosong", () => {
    expect(buildAvailableModels(null, null, null, "alias", "pid")).toEqual([]);
  });
});

describe("hasActiveConnection", () => {
  it("true bila ada koneksi aktif", () => {
    expect(hasActiveConnection([{ isActive: true }, { isActive: false }])).toBe(true);
    expect(hasActiveConnection([{}])).toBe(true); // isActive undefined → dianggap aktif
  });

  it("false bila tidak ada koneksi aktif", () => {
    expect(hasActiveConnection([{ isActive: false }])).toBe(false);
    expect(hasActiveConnection([])).toBe(false);
    expect(hasActiveConnection(null)).toBe(false);
  });
});

describe("formatMs", () => {
  it("memformat milidetik", () => {
    expect(formatMs(123)).toBe("123 ms");
    expect(formatMs(123.6)).toBe("124 ms");
    expect(formatMs(0)).toBe("0 ms");
  });

  it('"—" untuk nilai kosong', () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(undefined)).toBe("—");
    expect(formatMs(NaN)).toBe("—");
  });
});

describe("parseSsePayload", () => {
  it("[DONE] → done", () => {
    expect(parseSsePayload("[DONE]")).toEqual({ type: "done" });
  });

  it("delta content dari choices[0].delta", () => {
    const p = parseSsePayload('{"choices":[{"delta":{"content":"halo"}}]}');
    expect(p).toEqual({ type: "delta", content: "halo", usage: null });
  });

  it("fallback ke choices[0].message.content", () => {
    const p = parseSsePayload('{"choices":[{"message":{"content":"hai"}}]}');
    expect(p.content).toBe("hai");
  });

  it("usage top-level dari finish chunk", () => {
    const usage = { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 };
    const p = parseSsePayload(JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage }));
    expect(p.type).toBe("delta");
    expect(p.content).toBe("");
    expect(p.usage).toEqual(usage);
  });

  it("fallback usage di choices[0].usage", () => {
    const p = parseSsePayload('{"choices":[{"delta":{},"usage":{"prompt_tokens":1}}]}');
    expect(p.usage).toEqual({ prompt_tokens: 1 });
  });

  it("chunk malformed → ignore", () => {
    expect(parseSsePayload("bukan-json")).toEqual({ type: "ignore" });
    expect(parseSsePayload("")).toEqual({ type: "ignore" });
  });
});
