import { describe, expect, it, vi } from "vitest";

import geminiAdapter from "../../open-sse/handlers/imageProviders/gemini.js";

const RAW_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==".repeat(3);

describe("Gemini image reference input", () => {
  it("unshifts a data-URI reference image before the prompt part", () => {
    const body = geminiAdapter.buildBody("gemini-3.1-flash-image", {
      prompt: "edit this",
      image: "data:image/jpeg;base64,/9j/abc123",
    });
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "/9j/abc123" } });
    expect(parts[1]).toEqual({ text: "edit this" });
    expect(body.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
  });

  it("treats a long raw base64 string as PNG and reads images[0]", () => {
    const body = geminiAdapter.buildBody("gemini-3.1-flash-image", {
      prompt: "edit this",
      images: [RAW_B64],
    });
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: RAW_B64 } });
    expect(parts[1]).toEqual({ text: "edit this" });
  });

  it("ignores http URLs and missing input (prompt only)", () => {
    for (const input of [undefined, "https://example.com/cat.png", "short"]) {
      const body = geminiAdapter.buildBody("gemini-3.1-flash-image", { prompt: "draw", image: input });
      expect(body.contents[0].parts).toEqual([{ text: "draw" }]);
    }
  });
});

describe("image core error plumbing (executor path)", () => {
  it("passes upstream status and quota reset through instead of forcing 502", async () => {
    vi.resetModules();
    const resetsAtMs = Date.now() + 3600_000;
    vi.doMock("../../open-sse/handlers/imageProviders/index.js", () => ({
      getImageAdapter: () => ({
        useExecutor: true,
        executeViaExecutor: async () => {
          const err = new Error("quota exceeded");
          err.status = 429;
          err.resetsAtMs = resetsAtMs;
          throw err;
        },
      }),
    }));
    const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");
    const result = await handleImageGenerationCore({
      body: { prompt: "x" },
      modelInfo: { provider: "antigravity", model: "gemini-3.1-flash-image" },
      credentials: {},
      log: null,
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBe(resetsAtMs);
    vi.doUnmock("../../open-sse/handlers/imageProviders/index.js");
  });

  it("still returns 502 for plain errors without a status", async () => {
    vi.resetModules();
    vi.doMock("../../open-sse/handlers/imageProviders/index.js", () => ({
      getImageAdapter: () => ({
        useExecutor: true,
        executeViaExecutor: async () => { throw new Error("boom"); },
      }),
    }));
    const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");
    const result = await handleImageGenerationCore({
      body: { prompt: "x" },
      modelInfo: { provider: "antigravity", model: "gemini-3.1-flash-image" },
      credentials: {},
      log: null,
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.resetsAtMs).toBeUndefined();
    vi.doUnmock("../../open-sse/handlers/imageProviders/index.js");
  });
});

describe("Antigravity image adapter error enrichment", () => {
  it("attaches status and quota reset from Google error details", async () => {
    vi.resetModules();
    const resetIso = new Date(Date.now() + 3600_000).toISOString();
    vi.doMock("../../open-sse/executors/index.js", () => ({
      getExecutor: async () => ({
        execute: async () => ({
          response: {
            ok: false,
            status: 429,
            text: async () => JSON.stringify({
              error: { details: [{ metadata: { quotaResetTimeStamp: resetIso } }] },
            }),
          },
        }),
      }),
    }));
    const { default: antigravityAdapter } = await import("../../open-sse/handlers/imageProviders/antigravity.js");
    await expect(antigravityAdapter.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "x" },
      {},
      null,
    )).rejects.toMatchObject({ status: 429, resetsAtMs: Date.parse(resetIso) });
    vi.doUnmock("../../open-sse/executors/index.js");
  });
});
