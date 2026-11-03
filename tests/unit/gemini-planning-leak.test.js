import { describe, it, expect } from "vitest";
import {
  isPlanningLeakPrefix,
  splitLeadingJsonObject,
  consumePlanningLeak,
  GeminiPlanningLeakFilter,
} from "../../open-sse/utils/geminiPlanningLeak.js";

const { geminiToOpenAIResponse } = await import(
  "../../open-sse/translator/response/gemini-to-openai.js"
);

// Gemini Flash sometimes leaks a leading planning JSON ({"thought":"…"})
// into visible text. The filter must strip exactly that — and nothing else.

function flashChunk(text, finishReason = undefined) {
  const candidate = { content: { parts: [{ text }] } };
  if (finishReason) candidate.finishReason = finishReason;
  return {
    response: {
      responseId: "resp_1",
      modelVersion: "gemini-2.5-flash",
      candidates: [candidate],
    },
  };
}

function visibleContents(results) {
  return (results || [])
    .flatMap((c) => c.choices || [])
    .map((ch) => ch.delta?.content)
    .filter((v) => v !== undefined);
}

describe("geminiPlanningLeak util", () => {
  it("detects the thought-key signature and rejects other keys", () => {
    expect(isPlanningLeakPrefix('{"thought":"plan"}Hello')).toBe(true);
    expect(isPlanningLeakPrefix('{"answer":42}Hello')).toBe(false);
    expect(isPlanningLeakPrefix("Hello world")).toBe(false);
    expect(isPlanningLeakPrefix('{"tho')).toBe(true);
    expect(isPlanningLeakPrefix('{"thoughts":"x"}')).toBe(false);
  });

  it("splits a leading JSON object honouring strings and nesting", () => {
    const split = splitLeadingJsonObject('{"thought":"a } b { c"}rest');
    expect(split.jsonText).toBe('{"thought":"a } b { c"}');
    expect(split.rest).toBe("rest");
    expect(splitLeadingJsonObject('{"thought":"unterminated')).toBeUndefined();
    expect(splitLeadingJsonObject("plain")).toBeUndefined();
  });

  it("consumePlanningLeak strips the leak and keeps the rest", () => {
    expect(consumePlanningLeak('{"thought":"plan"}Hello')).toEqual({
      kind: "leak",
      visibleText: "Hello",
    });
    expect(consumePlanningLeak("Hello")).toEqual({
      kind: "plain",
      visibleText: "Hello",
    });
    expect(consumePlanningLeak('{"thought":"pla')).toEqual({
      kind: "incomplete",
    });
    expect(consumePlanningLeak('{"thought":"pla', true)).toEqual({
      kind: "leak",
      visibleText: "",
    });
  });

  it("filter buffers split chunks until the leak resolves", () => {
    const filter = new GeminiPlanningLeakFilter();
    expect(filter.feed('{"thought":"pla')).toBe("");
    expect(filter.feed('nning"}Hello')).toBe("Hello");
    expect(filter.feed(" world")).toBe(" world");
    expect(filter.flush()).toBe("");
  });

  it("filter passes non-leak text through immediately", () => {
    const filter = new GeminiPlanningLeakFilter();
    expect(filter.feed("Hello ")).toBe("Hello ");
    expect(filter.feed("world")).toBe("world");
  });
});

describe("geminiToOpenAIResponse planning-leak wiring", () => {
  it("strips a leaked planning JSON from flash visible text", () => {
    const state = {};
    const results = geminiToOpenAIResponse(
      flashChunk('{"thought":"internal plan"}Hello'),
      state
    );
    expect(visibleContents(results)).toEqual(["Hello"]);
  });

  it("strips a leak split across streaming chunks", () => {
    const state = {};
    const first = geminiToOpenAIResponse(flashChunk('{"thought":"pla'), state);
    expect(visibleContents(first)).toEqual([]);
    const second = geminiToOpenAIResponse(flashChunk('nning"}Hello'), state);
    expect(visibleContents(second)).toEqual(["Hello"]);
  });

  it("does not strip anything for non-flash models", () => {
    const state = {};
    const chunk = flashChunk('{"thought":"plan"}Hello');
    chunk.response.modelVersion = "gemini-2.5-pro";
    const results = geminiToOpenAIResponse(chunk, state);
    expect(visibleContents(results)).toEqual(['{"thought":"plan"}Hello']);
  });

  it("does not strip JSON-mode text starting with another key", () => {
    const state = {};
    const results = geminiToOpenAIResponse(
      flashChunk('{"answer":42}Hello'),
      state
    );
    expect(visibleContents(results)).toEqual(['{"answer":42}Hello']);
  });

  it("drops a truncated trailing leak on finish", () => {
    const state = {};
    const results = geminiToOpenAIResponse(
      flashChunk('{"thought":"pla', "STOP"),
      state
    );
    expect(visibleContents(results)).toEqual([]);
  });
});
