import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import kimi from "../../open-sse/providers/registry/kimi.js";
import { getModelUpstreamId, getProviderModels } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { CHAT_SEARCH_CONFIG, handleChatSearch } from "../../open-sse/handlers/search/chatSearch.js";

const ids = ["k3.1-pro", "k3.1-pro-highspeed", "k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"];

describe("official Kimi Code API", () => {
  it("lists the verified official model IDs and isolates Moonshot platform IDs", () => {
    const models = getProviderModels("kimi");
    expect(models.filter(m => !m.upstreamModelId).map(m => m.id)).toEqual(ids);
    expect(models.some(m => m.id === "kimi-k2.5" || m.id === "kimi-latest")).toBe(false);
    expect(kimi.display.notice.apiKeyUrl).toBe("https://www.kimi.com/code/console");
  });

  it("uses official overseas native endpoints for each wire protocol", () => {
    expect(PROVIDERS.kimi.baseUrl).toBe("https://api.kimi.ai/coding/v1/messages");
    for (const [format, path] of [["openai", "chat/completions"], ["openai-responses", "responses"], ["claude", "messages"]]) {
      const transport = PROVIDERS.kimi.transports.find(t => t.format === format);
      expect(transport.baseUrl).toBe(`https://api.kimi.ai/coding/v1/${path}`);
      expect(transport.urlSuffix).toBeUndefined();
      expect(transport.auth.header).toBe(format === "claude" ? "x-api-key" : "Authorization");
    }
  });

  it("resolves existing combo aliases to documented Code IDs", () => {
    expect(getModelUpstreamId("kimi", "kimi-k3")).toBe("k3");
    expect(getModelUpstreamId("kimi", "kimi-k3(high)")).toBe("k3(high)");
    expect(getModelUpstreamId("kimi", "kimi-k2.7-code-highspeed")).toBe("kimi-for-coding-highspeed");
  });

  it("declares context and thinking differences instead of using the generic model floor", () => {
    expect(getCapabilitiesForModel("kimi", "k3.1-pro")).toMatchObject({ reasoning: true, vision: true, contextWindow: 1048576, thinkingCanDisable: false });
    expect(getCapabilitiesForModel("kimi", "k3-256k")).toMatchObject({ contextWindow: 262144, videoInput: false });
    expect(getCapabilitiesForModel("kimi", "kimi-for-coding").contextWindow).toBe(1048576);
    expect(getThinkingLevels("kimi", "k3.1-pro-highspeed")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("kimi", "kimi-for-coding-highspeed")).toEqual(["none", "thinking"]);
  });

  it.each(["none", "concise"])("preserves native effort and maps Responses summary %s", summary => {
    const body = translateRequest("openai-responses", "openai-responses", "k3.1-pro", {
      input: "hello", reasoning: { effort: "max", summary }, stream: true,
    }, true, null, "kimi");
    expect(body.reasoning).toEqual(summary === "none" ? { effort: "max" } : { effort: "max", summary });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("uses Code Responses web search instead of sending Code keys to Moonshot", () => {
    const search = CHAT_SEARCH_CONFIG.kimi;
    expect(search.endpoint()).toBe("https://api.kimi.ai/coding/v1/responses");
    expect(search.buildBody("query", "k3.1-pro")).toMatchObject({
      model: "k3.1-pro", input: [{ role: "user", content: "query" }], tools: [{ type: "web_search" }], stream: false,
      reasoning: { effort: "low" }, max_output_tokens: 512,
    });
    expect(search.extractAnswer({ output: [{ type: "message", content: [{ type: "output_text", text: "answer",
      annotations: [{ type: "url_citation", url: "https://example.com", title: "source" }] }] }], usage: { total_tokens: 9 } }))
      .toMatchObject({ text: "answer", citations: [{ url: "https://example.com", title: "source" }], tokens: 9 });
  });

  it("allows Kimi's search tool to finish beyond the old 15-second timeout, with a finite deadline", async () => {
    vi.useFakeTimers();
    let signal;
    vi.stubGlobal("fetch", vi.fn((url, options) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    try {
      const pending = handleChatSearch({ provider: "kimi", query: "query", credentials: { apiKey: "test" } });
      await vi.advanceTimersByTimeAsync(15001);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(15000);
      expect(await pending).toMatchObject({ success: false, status: 504 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
