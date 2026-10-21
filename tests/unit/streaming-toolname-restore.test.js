// Regression test for upstream #4986 (local variant): when the opencode
// fingerprint conceals tool names by capitalization (Read -> read), the
// streaming path used to forward chunks raw for same-format (openai->openai)
// requests, so the client received tool calls for names it never declared.
// buildTransformStream must route through the translator when a rename map
// exists so names are restored per chunk; without a map, passthrough stays.
import { describe, it, expect } from "vitest";
import { buildTransformStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const TOOL_CHUNK = {
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "muse-spark-1.3-contributor-free",
  choices: [
    {
      index: 0,
      delta: {
        role: "assistant",
        tool_calls: [
          { index: 0, id: "call_1", type: "function", function: { name: "read", arguments: "" } },
        ],
      },
      finish_reason: null,
    },
  ],
};

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += typeof value === "string" ? value : decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function sseStream(chunks) {
  const encoder = new TextEncoder();
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

async function run(toolNameMap) {
  const transform = buildTransformStream({
    provider: "opencode",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    toolNameMap,
  });
  const text = await drain(sseStream([TOOL_CHUNK]).pipeThrough(transform));
  const events = text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.slice(6).trim() !== "[DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  return events[0]?.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name;
}

describe("streaming tool name restore (same-format)", () => {
  it("restores concealed tool names when a rename map exists", async () => {
    const name = await run(new Map([["read", "Read"]]));
    expect(name).toBe("Read");
  });

  it("keeps passthrough behavior when no rename happened", async () => {
    const name = await run(null);
    expect(name).toBe("read");
  });
});
