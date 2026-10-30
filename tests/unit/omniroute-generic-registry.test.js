// 12 generic OpenAI-compatible providers ported from OmniRoute
// (origin/release/v3.8.53). Registry files are imported directly — NOT via
// registry/index.js, which is auto-generated and regenerated centrally by
// the parent (this test must pass before that regen lands).
import { describe, it, expect } from "vitest";
import apmix from "../../open-sse/providers/registry/apmix.js";
import beatapi from "../../open-sse/providers/registry/beatapi.js";
import bigmodel from "../../open-sse/providers/registry/bigmodel.js";
import daoxe from "../../open-sse/providers/registry/daoxe.js";
import demonroute from "../../open-sse/providers/registry/demonroute.js";
import nan from "../../open-sse/providers/registry/nan.js";
import onomeo from "../../open-sse/providers/registry/onomeo.js";
import tokenmarket from "../../open-sse/providers/registry/tokenmarket.js";
import unifically from "../../open-sse/providers/registry/unifically.js";
import yApi from "../../open-sse/providers/registry/y-api.js";
import ainetcafe from "../../open-sse/providers/registry/ainetcafe.js";
import gisoo from "../../open-sse/providers/registry/gisoo.js";

const ENTRIES = {
  apmix, beatapi, bigmodel, daoxe, demonroute, nan,
  onomeo, tokenmarket, unifically, "y-api": yApi, ainetcafe, gisoo,
};

const EXPECTED = {
  apmix: {
    baseUrl: "https://api.apmix.ai/v1/chat/completions",
    validateUrl: "https://api.apmix.ai/v1/models",
    fetcher: "https://api.apmix.ai/v1/models",
    passthrough: undefined,
    models: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-fable-5", "claude-sonnet-4-6", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.5", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6-luna-free", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro", "grok-4.5", "grok-4.6", "grok-4.7", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-v4-flash-free", "qwen3.8-flash", "qwen3.8-max", "glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-5-turbo", "kimi-k2.7-code", "kimi-k3", "mimo-v2.5-pro", "mimo-v2.5", "hy4-preview", "composer-2.5-fast", "minimax-m3", "muse-spark-1.3"],
  },
  beatapi: {
    baseUrl: "https://api.beatapi.io/v1/chat/completions",
    validateUrl: "https://api.beatapi.io/v1/models",
    fetcher: "https://api.beatapi.io/v1/models",
    passthrough: true,
    models: [],
  },
  bigmodel: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    validateUrl: undefined,
    fetcher: undefined,
    passthrough: true,
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1", "glm-5-turbo", "glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx", "glm-4.6", "glm-4.5-air", "glm-4.5-airx", "glm-4.5-flash", "glm-4-flash-250414", "glm-4-flashx-250414"],
  },
  daoxe: {
    baseUrl: "https://api.daoxe.com/v1/chat/completions",
    validateUrl: "https://api.daoxe.com/v1/models",
    fetcher: "https://api.daoxe.com/v1/models",
    passthrough: true,
    models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001", "gpt-5.5", "gpt-5.4", "gemini-3.1-pro-preview", "grok-4.5", "grok-4.3", "kimi-k2.5"],
  },
  demonroute: {
    baseUrl: "https://api.demonroute.com/v1/chat/completions",
    validateUrl: "https://api.demonroute.com/v1/models",
    fetcher: "https://api.demonroute.com/v1/models",
    passthrough: true,
    models: ["dphn/Dolphin3.0-Llama3.1-8B", "dphn/Dolphin-Mistral-24B-Venice-Edition", "TheDrummer/Artemis-31B-v1.2", "TheDrummer/Cydonia-24B-v4.3", "huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated", "huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2", "dphn/dolphin-2.9.3-mistral-nemo-12b"],
  },
  nan: {
    baseUrl: "https://api.nan.builders/v1/chat/completions",
    validateUrl: "https://api.nan.builders/v1/models",
    fetcher: "https://api.nan.builders/v1/models",
    passthrough: undefined,
    models: ["deepseek-v4-flash", "mimo-v2.5", "mimo-v2.6-flash", "qwen3.8-flash", "qwen3.6", "glm5.3", "glm5.3-flash", "gemma4"],
  },
  onomeo: {
    baseUrl: "https://onomeo.com/v1/chat/completions",
    validateUrl: "https://onomeo.com/v1/models",
    fetcher: "https://onomeo.com/v1/models",
    passthrough: true,
    models: [],
  },
  tokenmarket: {
    baseUrl: "https://api.tokensmarket.ai/v1/chat/completions",
    validateUrl: "https://api.tokensmarket.ai/v1/models",
    fetcher: "https://api.tokensmarket.ai/v1/models",
    passthrough: true,
    models: [],
  },
  unifically: {
    baseUrl: "https://api.unifically.com/v1/chat/completions",
    validateUrl: "https://api.unifically.com/v1/models?category=llm",
    fetcher: "https://api.unifically.com/v1/models?category=llm",
    passthrough: true,
    models: [],
  },
  "y-api": {
    baseUrl: "https://api.y-api.bestvirtualgoods.com/v1/chat/completions",
    validateUrl: "https://api.y-api.bestvirtualgoods.com/v1/models",
    fetcher: "https://api.y-api.bestvirtualgoods.com/v1/models",
    passthrough: true,
    models: [],
  },
  ainetcafe: {
    baseUrl: "https://microquickjs.com/v1/chat/completions",
    validateUrl: "https://microquickjs.com/v1/models",
    fetcher: "https://microquickjs.com/v1/models",
    passthrough: true,
    models: [],
  },
  gisoo: {
    baseUrl: "https://gisoo.pro/api/v1/chat/completions",
    validateUrl: "https://gisoo.pro/api/v1/models",
    fetcher: "https://gisoo.pro/api/v1/models",
    passthrough: true,
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "gpt-5.6-sol", "gpt-5.5", "gemini-3.8-flash", "gemini-3.1-pro-preview", "deepseek-v4-pro", "deepseek-flash"],
  },
};

describe("omniroute generic registry entries", () => {
  for (const [id, entry] of Object.entries(ENTRIES)) {
    it(`${id} matches its OmniRoute source verbatim`, () => {
      const exp = EXPECTED[id];
      expect(entry.id).toBe(id);
      expect(entry.alias).toBe(id);
      expect(entry.category).toBe("apikey");
      expect(entry.authType).toBe("apikey");
      expect(entry.transport.baseUrl).toBe(exp.baseUrl);
      expect(entry.transport.validateUrl).toBe(exp.validateUrl);
      expect(entry.models.map((m) => m.id)).toEqual(exp.models);
      expect(entry.modelsFetcher?.url).toBe(exp.fetcher);
      if (exp.fetcher) expect(entry.modelsFetcher?.type).toBe("openai");
      expect(entry.passthroughModels).toBe(exp.passthrough);
      // No website/apiKeyUrl was invented: the OmniRoute source declares none.
      expect(entry.display.website).toBeUndefined();
      expect(entry.display.notice).toBeUndefined();
      expect(entry.display.textIcon).toMatch(/^[A-Z]{2}$/);
    });
  }

  it("demonroute carries the 120s connect timeout", () => {
    expect(demonroute.transport.timeoutMs).toBe(120000);
  });

  it("apmix minimax-m3 keeps its source vision/context fields", () => {
    const m3 = apmix.models.find((m) => m.id === "minimax-m3");
    expect(m3.supportsVision).toBe(true);
    expect(m3.contextLength).toBe(1048576);
  });
});
