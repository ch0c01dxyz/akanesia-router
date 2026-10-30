// Registry port (upstream v0.5.109–v0.5.112): Runcrate as a new generic
// OpenAI-compatible provider, SenseNova catalog refreshed (6.8 + U1.5 image
// models + Kimi K3) with its image lane wired through the static adapter.
import { describe, it, expect } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getImageAdapter, isImageProvider } from "../../open-sse/handlers/imageProviders/index.js";

const byId = (id) => REGISTRY.find((e) => e.id === id);

describe("runcrate registry", () => {
  it("is registered with the billing validateUrl (public /v1/models cannot tell a bad key)", () => {
    const entry = byId("runcrate");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("runcrate");
    expect(entry.aliases).toContain("rc");
    expect(entry.transport.baseUrl).toBe("https://api.runcrate.ai/v1/chat/completions");
    expect(entry.transport.validateUrl).toBe("https://www.runcrate.ai/api/v1/billing/balance");
    expect(entry.models.map((m) => m.id)).toEqual([
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "deepseek-ai/DeepSeek-V4.1-Flash-1017",
      "zai-org/GLM-5.3",
      "zai-org/GLM-5.3-Flash",
      "Qwen/Qwen3.8-Flash",
      "openai/gpt-oss-120b",
    ]);
    expect(PROVIDERS["runcrate"]?.validateUrl).toBe(entry.transport.validateUrl);
  });
});

describe("sensenova registry refresh", () => {
  it("keeps the local models and adds 6.8, U1.5 image models and Kimi K3", () => {
    const entry = byId("sensenova");
    const ids = entry.models.map((m) => m.id);
    expect(ids).toContain("sensenova-6.7-flash-lite");
    expect(ids).toContain("sensenova-6.8-flash-lite");
    expect(ids).toContain("sensenova-u1.5-lite");
    expect(ids).toContain("sensenova-u1.5-fast");
    expect(ids).toContain("kimi-k3");
    const kinds = Object.fromEntries(entry.models.map((m) => [m.id, m.kind]));
    expect(kinds["sensenova-u1.5-lite"]).toBe("image");
    expect(kinds["sensenova-u1.5-fast"]).toBe("image");
  });

  it("exposes the image lane through serviceKinds + imageConfig + static adapter", () => {
    const entry = byId("sensenova");
    expect(entry.serviceKinds).toContain("image");
    expect(entry.imageConfig.baseUrl).toBe("https://token.sensenova.cn/v1/images/generations");
    expect(isImageProvider("sensenova")).toBe(true);
    expect(getImageAdapter("sensenova")).not.toBeNull();
  });
});
