/**
 * Model DeepSeek opencode-go pada passthrough claude→claude /messages butuh
 * penanganan thinking-block yang sama dengan provider deepseek resmi (#3332):
 * pertahankan thinking block yang ada apa adanya, dan inject placeholder
 * TANPA signature pada turn tool_use yang tidak punya thinking saat thinking
 * di-enable — upstream 400 dengan "The content[].thinking in the thinking
 * mode must be passed back to the API" jika tidak. Gate berbasis model
 * karena opencode-go juga melayani model non-DeepSeek via /messages
 * (minimax, qwen) yang harus tetap tak tersentuh.
 */
import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

function makeBody(model) {
  return {
    model,
    max_tokens: 2048,
    thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_weather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "18C" },
        ],
      },
    ],
  };
}

function firstBlock(body) {
  return body.messages[0].content[0];
}

describe("prepareClaudeRequest — pass-back thinking DeepSeek opencode-go", () => {
  it("inject placeholder thinking tanpa signature pada turn tool_use yang belum punya", () => {
    const out = prepareClaudeRequest(
      makeBody("opencode-go/deepseek-v4-pro(max)"),
      "opencode-go",
    );

    const block = firstBlock(out);
    expect(block.type).toBe("thinking");
    expect(block.signature).toBeUndefined();
    expect(out.messages[0].content).toHaveLength(2); // placeholder + tool_use
  });

  it("mempertahankan thinking block yang ada apa adanya (tanpa re-sign, tanpa duplikat)", () => {
    const body = makeBody("opencode-go/deepseek-v4-flash");
    const realThinking = {
      type: "thinking",
      thinking: "actual reasoning",
      signature: "sig_from_upstream",
    };
    body.messages[0].content.unshift(realThinking);

    const out = prepareClaudeRequest(body, "opencode-go");

    const thinking = out.messages[0].content.filter(
      (b) => b.type === "thinking",
    );
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toEqual(realThinking);
  });

  it("membiarkan model opencode-go non-DeepSeek tak tersentuh (minimax juga lewat /messages)", () => {
    const out = prepareClaudeRequest(
      makeBody("opencode-go/minimax-m3"),
      "opencode-go",
    );

    expect(out.messages[0].content).toHaveLength(1); // hanya tool_use
    expect(firstBlock(out).type).toBe("tool_use");
  });

  it("provider deepseek resmi tetap inject placeholder tanpa signature (regresi)", () => {
    const out = prepareClaudeRequest(makeBody("deepseek-v4-pro"), "deepseek");

    const block = firstBlock(out);
    expect(block.type).toBe("thinking");
    expect(block.signature).toBeUndefined();
  });

  it.todo(
    "inject placeholder reasoning ke item `input` Responses untuk model DeepSeek — " +
      "injectReasoningContent hanya menulis ulang body.messages, sehingga klien " +
      "format-responses yang me-replay sesi ber-reasoning lewat transport " +
      "openai-responses belum ter-cover",
  );
});
