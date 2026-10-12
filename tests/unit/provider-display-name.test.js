import { describe, it, expect } from "vitest";
import { providerDisplayName, enrichWithProviderName } from "../../src/lib/providerDisplayName.js";

describe("providerDisplayName", () => {
  it("nama koneksi menang atas segalanya", () => {
    expect(
      providerDisplayName("openai-compatible-chat-abc", { name: "LLM Kantorku" })
    ).toBe("LLM Kantorku");
  });

  it("fallback ke nama AI_PROVIDERS untuk provider registry", () => {
    const name = providerDisplayName("openai", null);
    expect(name).not.toBe("openai");
    expect(typeof name).toBe("string");
  });

  it("fallback ke id mentah bila tak dikenal", () => {
    expect(providerDisplayName("provider-asing", null)).toBe("provider-asing");
  });

  it("tanpa id → em dash", () => {
    expect(providerDisplayName(null, null)).toBe("—");
  });
});

describe("enrichWithProviderName", () => {
  const connections = [
    { id: "c1", provider: "openai-compatible-chat-abc", name: "LLM Kantorku" },
  ];
  const items = [
    { connectionId: "c1", provider: "openai-compatible-chat-abc", model: "m1" },
    { connectionId: "c-hilang", provider: "x-tak-dikenal", model: "m2" },
  ];

  it("tambah providerName per item", () => {
    const out = enrichWithProviderName(items, connections);
    expect(out[0].providerName).toBe("LLM Kantorku");
    expect(out[0].provider).toBe("openai-compatible-chat-abc"); // asli dipertahankan
    expect(out[1].providerName).toBe("x-tak-dikenal");
  });

  it("fail-open bila koneksi tak tersedia", () => {
    const out = enrichWithProviderName(items, null);
    expect(out[0].providerName).toBe("openai-compatible-chat-abc");
  });
});
