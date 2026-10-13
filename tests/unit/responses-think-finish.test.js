import { describe, it, expect } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

// Chunk terakhir yang masih inThinking (<think> tak pernah ditutup) tapi
// membawa finish_reason: finish_reason tidak boleh ditelan — response.completed
// harus tetap di-emit.
describe("responsesTransformer: think + finish_reason", () => {
  async function run(chunks) {
    const encoder = new TextEncoder();
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    const stream = new ReadableStream({
      start(c) { c.enqueue(encoder.encode(body)); c.close(); },
    });
    const out = stream.pipeThrough(createResponsesApiTransformStream(null));
    const reader = out.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += typeof value === "string" ? value : decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text.split("\n")
      .filter((l) => l.startsWith("data: ") && l.slice(6).trim() !== "[DONE]")
      .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
      .filter(Boolean);
  }

  it("finish_reason di chunk thinking → response.completed tetap di-emit", async () => {
    const events = await run([
      { choices: [{ index: 0, delta: { content: "<think>menalar dulu" } }] },
      { choices: [{ index: 0, delta: { content: "lanjut menalar" }, finish_reason: "stop" }] },
    ]);
    const completed = events.filter((e) => e.type === "response.completed");
    expect(completed.length).toBe(1);
  });

  it("tool_calls di chunk thinking → function_call tetap di-emit", async () => {
    const events = await run([
      { choices: [{ index: 0, delta: { content: "<think>pilih tool" } }] },
      {
        choices: [{
          index: 0,
          delta: {
            content: "",
            tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        }],
      },
    ]);
    const fnCalls = events.filter((e) => e.type === "response.output_item.added" && e.item?.type === "function_call");
    expect(fnCalls.length).toBe(1);
    const completed = events.filter((e) => e.type === "response.completed");
    expect(completed.length).toBe(1);
  });
});
