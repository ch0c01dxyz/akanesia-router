import { describe, expect, it, vi } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { ensureTranslatorsForRequest } from "../../open-sse/translator/index.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// A chat->responses stream defers response.completed when finish_reason arrives
// without usage (PR #4476). If the upstream then stalls — no usage trailer, no
// [DONE], connection held open — that deferral must not wait forever: the
// watchdog flushes the terminal event after PENDING_COMPLETION_FLUSH_MS.
const encoder = new TextEncoder();

const FINISH_CHUNK = {
  id: "chatcmpl-1",
  choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }],
};

const USAGE_TRAILER = { id: "chatcmpl-1", choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } };

function completedResponses(text) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.includes('"type":"response.completed"'))
    .map((l) => JSON.parse(l.slice(6)).response);
}

async function readAll(reader) {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function pipe() {
  let source;
  const input = new ReadableStream({ start(c) { source = c; } });
  // Translator di-load lazy (lihat ensureTranslatorsForRequest di chatCore):
  // pastikan pasangan response ter-register sebelum stream sinkron dipakai.
  await ensureTranslatorsForRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
  const output = input.pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "test", null, null, "gpt-test"),
  );
  return { source, reader: output.getReader() };
}

describe("pending response.completed watchdog", () => {
  it("flushes the deferred completion when the upstream stalls after finish_reason", async () => {
    vi.useFakeTimers();
    try {
      const { source, reader } = await pipe();
      source.enqueue(encoder.encode(`data: ${JSON.stringify(FINISH_CHUNK)}\n\n`));
      await vi.advanceTimersByTimeAsync(20);

      // No trailer, no [DONE] — only the watchdog can close this out.
      await vi.advanceTimersByTimeAsync(3000);
      source.close();

      const completed = completedResponses(await readAll(reader));
      expect(completed.length, "exactly one response.completed").toBe(1);
      expect(completed[0].status).toBe("completed");
      expect(completed[0].usage, "no usage was ever reported").toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire after the real usage trailer already completed the stream", async () => {
    vi.useFakeTimers();
    try {
      const { source, reader } = await pipe();
      source.enqueue(encoder.encode(`data: ${JSON.stringify(FINISH_CHUNK)}\n\n`));
      await vi.advanceTimersByTimeAsync(20);
      source.enqueue(encoder.encode(`data: ${JSON.stringify(USAGE_TRAILER)}\n\n`));
      await vi.advanceTimersByTimeAsync(20);

      // Well past the watchdog window: nothing more may be emitted.
      await vi.advanceTimersByTimeAsync(10000);
      source.close();

      const completed = completedResponses(await readAll(reader));
      expect(completed.length, "exactly one response.completed").toBe(1);
      expect(completed[0].usage).toMatchObject({ input_tokens: 120, output_tokens: 30 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("watchdog dinamis per model", () => {
  it("model resmi (claude/gpt/gemini/grok) memakai 3 detik", async () => {
    const { getCompletionFlushMs } = await import("../../open-sse/utils/stream.js");
    expect(getCompletionFlushMs("claude-opus-4-6")).toBe(3000);
    expect(getCompletionFlushMs("gpt-5.4")).toBe(3000);
    expect(getCompletionFlushMs("codex/gpt-6-sol[1m]")).toBe(3000);
    expect(getCompletionFlushMs("gemini-3-pro")).toBe(3000);
    expect(getCompletionFlushMs("grok-4-1")).toBe(3000);
    expect(getCompletionFlushMs("o3-mini")).toBe(3000);
  });

  it("model lain (deepseek/glm/...) memakai 10 detik", async () => {
    const { getCompletionFlushMs } = await import("../../open-sse/utils/stream.js");
    expect(getCompletionFlushMs("deepseek-v4")).toBe(10000);
    expect(getCompletionFlushMs("deepseek-v4.1-flash")).toBe(10000);
    expect(getCompletionFlushMs("glm-4.6")).toBe(10000);
    expect(getCompletionFlushMs("kimi-k2")).toBe(10000);
    expect(getCompletionFlushMs(null)).toBe(10000);
    expect(getCompletionFlushMs(undefined)).toBe(10000);
  });
});
