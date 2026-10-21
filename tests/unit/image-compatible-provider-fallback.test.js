// Custom OpenAI-compatible providers (openai-compatible-<uuid>) have no
// registry entry, so the static adapter map missed them and image
// generation was rejected with "does not support image generation" —
// even when the connection's upstream serves image models (e.g.
// gpt-image-2). getImageAdapter now falls back to a dynamic adapter
// whose endpoint is the connection's own baseUrl + /images/generations.
import { describe, it, expect } from "vitest";
import { getImageAdapter, isImageProvider } from "../../open-sse/handlers/imageProviders/index.js";

const CUSTOM_ID = "openai-compatible-123e4567-e89b-12d3-a456-426614174000";
const CREDS = {
  apiKey: "sk-custom",
  providerSpecificData: { baseUrl: "https://custom.example.com/v1/" },
};

describe("openai-compatible-* image fallback", () => {
  it("resolves an adapter for dynamic provider ids", () => {
    expect(isImageProvider(CUSTOM_ID)).toBe(true);
    expect(getImageAdapter(CUSTOM_ID)).not.toBeNull();
  });

  it("derives the image endpoint from the connection baseUrl", () => {
    const adapter = getImageAdapter(CUSTOM_ID);
    expect(adapter.buildUrl("gpt-image-2", CREDS)).toBe(
      "https://custom.example.com/v1/images/generations",
    );
  });

  it("fails loudly when the connection has no baseUrl", () => {
    const adapter = getImageAdapter(CUSTOM_ID);
    expect(() => adapter.buildUrl("gpt-image-2", { apiKey: "sk-x", providerSpecificData: {} }))
      .toThrow(/missing providerSpecificData\.baseUrl/);
  });

  it("authenticates with the connection key and builds an OpenAI body", () => {
    const adapter = getImageAdapter(CUSTOM_ID);
    expect(adapter.buildHeaders(CREDS).Authorization).toBe("Bearer sk-custom");
    expect(adapter.buildBody("gpt-image-2", { prompt: "a lighthouse", size: "1024x1024" }))
      .toEqual({ model: "gpt-image-2", prompt: "a lighthouse", n: 1, size: "1024x1024" });
  });

  it("static providers still win over the fallback, unknown ids stay unsupported", () => {
    expect(getImageAdapter("venice").buildUrl()).toBe("https://api.venice.ai/api/v1/images/generations");
    expect(getImageAdapter("anthropic-compatible-abc")).toBeNull();
    expect(isImageProvider("anthropic-compatible-abc")).toBe(false);
  });
});
