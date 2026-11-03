/**
 * Regression: Chat Completions custom tools wrapped as
 * { type: "custom", custom: { name, ... } } were forwarded to Claude raw
 * (the translator's passthrough branch pushes non-function tools unchanged),
 * and Claude rejects the unknown `custom` tool type.
 *
 * Fix (adapted from upstream #18314): unwrap `custom` when it is an object so
 * the tool converts to Claude shape like a function tool. A Claude-format tool
 * that merely declares type:"custom" with top-level fields (Claude Code v2.1+)
 * has no `custom` key and must keep its passthrough behavior.
 */

import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const baseBody = (extra = {}) => ({
  messages: [{ role: "user", content: "hi" }],
  ...extra,
});

describe("openai→claude: Chat Completions custom tools", () => {
  it("custom tool unwraps to Claude shape with its name and input_schema", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        {
          type: "custom",
          custom: {
            name: "get_time",
            description: "Current time",
            input_schema: { type: "object", properties: { zone: { type: "string" } } },
          },
        },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("get_time");
    expect(out.tools[0].description).toBe("Current time");
    expect(out.tools[0].input_schema).toEqual({ type: "object", properties: { zone: { type: "string" } } });
    // Claude shape: no wrapper `type`, no nested `custom`/`function`.
    expect(out.tools[0]).not.toHaveProperty("type");
    expect(out.tools[0]).not.toHaveProperty("custom");
    expect(out.tools[0]).not.toHaveProperty("function");
  });

  it("custom tool with parameters (not input_schema) converts via parameters", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { type: "custom", custom: { name: "echo", parameters: { type: "object" } } },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0].input_schema).toEqual({ type: "object" });
  });

  it("Claude-native type:'custom' tool without a custom key still passes through unchanged", () => {
    const native = { type: "custom", name: "computer_use", display_width_px: 1024 };
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [native],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toMatchObject(native);
  });

  it("function and built-in tools are unaffected", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { type: "function", function: { name: "echo", parameters: { type: "object" } } },
        { type: "web_search_20250305", name: "web_search" },
      ],
    }), false);

    expect(out.tools).toHaveLength(2);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0]).not.toHaveProperty("type");
    // The last tool always gains cache_control from the translator; match the
    // passthrough shape, not exact equality.
    expect(out.tools[1]).toMatchObject({ type: "web_search_20250305", name: "web_search" });
  });
});
