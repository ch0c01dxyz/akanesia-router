// tool_choice "none" tidak boleh dijatuhkan ke "auto" di kedua arah translator.
import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("tool_choice none dipertahankan", () => {
  it("openai -> claude: string \"none\" menjadi { type: \"none\" }", () => {
    const out = openaiToClaudeRequest("claude-x", { model: "claude-x", messages: [], tool_choice: "none" }, false);
    expect(out.tool_choice).toEqual({ type: "none" });
  });

  it("claude -> openai: { type: \"none\" } menjadi \"none\"", () => {
    const out = claudeToOpenAIRequest("gpt-x", { model: "gpt-x", messages: [], tool_choice: { type: "none" } }, false);
    expect(out.tool_choice).toBe("none");
  });
});
