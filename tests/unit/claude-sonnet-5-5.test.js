import { describe, expect, it } from "vitest";

import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../translator/registerAll.js";

// Sonnet 5.5 memakai tarif API Sonnet 5 ($2 / $10 per 1M) dan keluarga
// adaptive-thinking 5.x. Tanpa baris eksplisit keduanya jatuh ke pola
// generik claude-sonnet-*: $3 / $15 dan budget thinking.
describe("Claude Sonnet 5.5", () => {
  it("terdaftar untuk provider claude", () => {
    expect(getModelsByProviderId("claude").some((model) => model.id === "claude-sonnet-5-5")).toBe(true);
  });

  it("resolve ke adaptive thinking dengan konteks 1M", () => {
    expect(getCapabilitiesForModel("claude", "claude-sonnet-5-5")).toMatchObject({
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
    });
  });

  it.each(["claude-sonnet-5-5", "claude-sonnet-5"])("tarif %s mengikuti tarif Sonnet 5", (model) => {
    expect(getPricingForModel("claude", model)).toEqual({ input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5 });
  });
});

// Sonnet 5.5 mengembalikan 400 untuk thinking.type "disabled" dan tool use paksa.
describe("Bentuk request Claude Sonnet 5.5", () => {
  const prepare = (body) => prepareClaudeRequest({ max_tokens: 1024, messages: [{ role: "user", content: "hi" }], ...body }, "claude");

  it("mematikan thinking via between_tools, effort di-clamp ke high", () => {
    const body = prepare({ model: "claude-sonnet-5-5", thinking: { type: "disabled" }, output_config: { effort: "max" } });
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body.output_config.effort).toBe("high");
  });

  it("memetakan tool_choice paksa ke auto", () => {
    expect(prepare({ model: "claude-sonnet-5-5", tool_choice: { type: "any" } }).tool_choice).toEqual({ type: "auto" });
    expect(prepare({ model: "claude-sonnet-5-5", tool_choice: { type: "tool", name: "run", disable_parallel_tool_use: true } }).tool_choice)
      .toEqual({ type: "auto", disable_parallel_tool_use: true });
  });

  it("tidak menyentuh model lain", () => {
    const body = prepare({ model: "claude-sonnet-5", thinking: { type: "disabled" }, tool_choice: { type: "any" } });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  it("mencakup jalur passthrough native Claude end to end", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-5-5", {
      model: "claude-sonnet-5-5", max_tokens: 1000, thinking: { type: "disabled" }, tool_choice: { type: "any" },
      tools: [{ name: "run", input_schema: { type: "object", properties: {} } }],
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "claude");
    expect(out.thinking).toEqual({ type: "between_tools" });
    expect(out.tool_choice).toEqual({ type: "auto" });
  });

  it("mencakup jalur klien OpenAI end to end", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-5-5", {
      model: "claude-sonnet-5-5", reasoning_effort: "none", tool_choice: "required",
      tools: [{ type: "function", function: { name: "run", parameters: { type: "object", properties: {} } } }],
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "claude");
    expect(out.thinking).toEqual({ type: "between_tools" });
    expect(out.tool_choice.type).toBe("auto");
  });
});
