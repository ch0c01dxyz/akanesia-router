import { describe, expect, it } from "vitest";

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { applyThinking, captureThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

async function runPassthrough(input, onComplete) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const out = stream.pipeThrough(
    createPassthroughStreamWithLogger(
      "openai",
      null,
      "gpt-4o",
      "conn-1",
      { model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] },
      onComplete,
      null,
    ),
  );
  const reader = out.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const openaiChunk = (delta, extra = {}) => JSON.stringify({
  id: "chatcmpl-abc12345",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "gpt-4o",
  choices: [{ index: 0, delta, finish_reason: extra.finish_reason ?? null }],
  ...(extra.usage ? { usage: extra.usage } : {}),
});

describe("stream usage + safety-block fixes (deep scan area A)", () => {
  it("R1: passthrough keeps usage from an empty-delta usage-only chunk", async () => {
    let completedUsage = null;
    const out = await runPassthrough(
      [
        `data: ${openaiChunk({ role: "assistant", content: "hi" })}`,
        `data: ${openaiChunk({}, { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}`,
        `data: ${openaiChunk({}, { finish_reason: "stop" })}`,
        "data: [DONE]",
        "",
      ].join("\n"),
      (_content, usage) => { completedUsage = usage; },
    );
    expect(out).toContain("hi");
    expect(completedUsage?.prompt_tokens).toBe(100);
    expect(completedUsage?.completion_tokens).toBe(50);
  });

  it("R2: passthrough flush drops a truncated non-JSON tail line", async () => {
    const out = await runPassthrough(`data: ${openaiChunk({ role: "assistant", content: "hi" })}\n` + `data: {"id": broken`, () => {});
    expect(out).toContain("hi");
    expect(out).toContain("[DONE]");
    expect(out).not.toContain("broken");
  });

  it("R3: claude message_stop keeps cached tokens in prompt_tokens", () => {
    const state = {
      messageId: null, model: null, textBlockStarted: false, thinkingBlockStarted: false,
      inThinkingBlock: false, currentBlockIndex: null, toolCalls: new Map(),
    };
    claudeToOpenAIResponse({
      type: "message_start",
      message: {
        id: "msg_1", model: "claude-x",
        usage: { input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200, output_tokens: 1 },
      },
    }, state);
    const stopped = claudeToOpenAIResponse({ type: "message_stop" }, state);
    expect(stopped).toHaveLength(1);
    expect(stopped[0].usage.prompt_tokens).toBe(5300);
    expect(stopped[0].usage.prompt_tokens_details.cached_tokens).toBe(5000);
  });

  it("R4a: gemini safety block streams a content_filter finish chunk instead of silence", () => {
    const state = {};
    const out = geminiToOpenAIResponse({
      response: {
        responseId: "resp-1",
        modelVersion: "gemini-2.0-flash",
        promptFeedback: { blockReason: "SAFETY" },
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0, totalTokenCount: 12 },
      },
    }, state);
    expect(out).not.toBeNull();
    const finish = out.find((c) => c.choices?.[0]?.finish_reason);
    expect(finish?.choices[0].finish_reason).toBe("content_filter");
    expect(finish?.usage?.prompt_tokens).toBe(12);
  });

  it("R4b: gemini safety block returns a content_filter completion for non-streaming", () => {
    const out = translateNonStreamingResponse({
      response: {
        responseId: "resp-1",
        modelVersion: "gemini-2.0-flash",
        promptFeedback: { blockReason: "SAFETY" },
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0, totalTokenCount: 12 },
      },
    }, FORMATS.GEMINI, FORMATS.OPENAI);
    expect(out.choices?.[0]?.finish_reason).toBe("content_filter");
    expect(out.choices?.[0]?.message?.content).toBe("");
  });

  it("R5: responses reasoning summary none is preserved, not forced to auto", () => {
    const body = { model: "muse-spark-1.3", reasoning: { effort: "high", summary: "none" }, messages: [] };
    const intent = captureThinking(body);
    applyThinking(FORMATS.OPENAI_RESPONSES, "muse-spark-1.3", body, "muse", intent);
    expect(body.reasoning.summary).toBe("none");
  });
});
