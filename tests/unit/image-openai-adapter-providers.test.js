// Venice and TokenRouter declare an OpenAI-style imageConfig
// (/v1/images/generations) and "image" in serviceKinds, but had no
// registered image adapter — imageGenerationCore rejected them with
// "does not support image generation". They now share the generic
// OpenAI adapter like minimax/openrouter/recraft/xai.
import { describe, it, expect } from "vitest";
import { getImageAdapter, isImageProvider } from "../../open-sse/handlers/imageProviders/index.js";

describe.each([
  ["venice", "https://api.venice.ai/api/v1/images/generations"],
  ["tokenrouter", "https://api.tokenrouter.com/v1/images/generations"],
])("%s via the shared OpenAI image adapter", (provider, expectedUrl) => {
  it("is registered as an image provider", () => {
    expect(isImageProvider(provider)).toBe(true);
    expect(getImageAdapter(provider)).not.toBeNull();
  });

  it("targets the registry-declared image endpoint with bearer auth", () => {
    const adapter = getImageAdapter(provider);
    expect(adapter.buildUrl()).toBe(expectedUrl);
    const headers = adapter.buildHeaders({ apiKey: "sk-test" });
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("builds an OpenAI-shaped generation body", () => {
    const adapter = getImageAdapter(provider);
    const body = adapter.buildBody("some-image-model", { prompt: "a cat", n: 2, size: "512x512" });
    expect(body).toEqual({ model: "some-image-model", prompt: "a cat", n: 2, size: "512x512" });
  });
});
