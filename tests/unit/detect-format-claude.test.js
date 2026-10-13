import { describe, it, expect } from "vitest";
import { detectFormat } from "../../open-sse/services/provider.js";

// Guard model.includes("/") dihapus: body.model selalu berbentuk
// "provider/model" di jalur live (src/sse/handlers/chat.js), jadi guard itu
// mematikan heuristik Claude sepenuhnya. Heuristik di dalam (system /
// anthropic_version / image source / tool_use) cukup membedakan.
describe("detectFormat tanpa guard '/'", () => {
  it("Claude dengan system + model ber-slash → claude", () => {
    expect(detectFormat({
      model: "anthropic/claude-opus-4-5",
      system: "kamu asisten",
      messages: [{ role: "user", content: [{ type: "text", text: "halo" }] }],
    })).toBe("claude");
  });

  it("Claude image (source base64) + model ber-slash → claude", () => {
    expect(detectFormat({
      model: "anthropic/claude-opus-4-5",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "apa ini?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
        ],
      }],
    })).toBe("claude");
  });

  it("OpenAI multimodal (image_url) + model ber-slash → tetap openai", () => {
    expect(detectFormat({
      model: "openai/gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "apa ini?" },
          { type: "image_url", image_url: { url: "https://x/y.png" } },
        ],
      }],
    })).toBe("openai");
  });

  it("Claude tool_result setelah text + model ber-slash → claude", () => {
    expect(detectFormat({
      model: "anthropic/claude-opus-4-5",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "lanjut" },
          { type: "tool_result", tool_use_id: "t1", content: "cerah" },
        ],
      }],
    })).toBe("claude");
  });
});
