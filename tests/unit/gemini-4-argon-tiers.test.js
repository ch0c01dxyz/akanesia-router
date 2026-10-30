import { afterEach, describe, expect, it, vi } from "vitest";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Gemini 4 Argon Antigravity tier", () => {
  it.each([
    ["gemini-4-argon-high", "high"],
    ["gemini-4-argon-medium", "medium"],
    ["gemini-4-argon-low", "low"],
  ])("maps %s to the wire model with a %s thinking level", (modelId, expectedLevel) => {
    const upstreamModel = getModelUpstreamId("ag", modelId);
    expect(upstreamModel).toBe(`${modelId}(${expectedLevel})`);

    const body = {
      model: stripThinkingSuffix(upstreamModel),
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: {},
      },
    };

    applyThinking("antigravity", upstreamModel, body, "antigravity");
    const finalBody = new AntigravityExecutor().transformRequest(
      modelId,
      body,
      true,
      { projectId: "project", connectionId: "connection" }
    );

    expect(finalBody.model).toBe(modelId);
    expect(finalBody.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: expectedLevel, includeThoughts: true });
  });

  it.each([
    ["high effort", { reasoning_effort: "high" }, "gemini-4-argon-high(high)"],
    ["low effort", { reasoning_effort: "low" }, "gemini-4-argon-low(low)"],
    ["medium effort", { reasoning_effort: "medium" }, "gemini-4-argon-medium(medium)"],
  ])("resolves unadorned gemini-4-argon to %s based on client request", (_, body, expectedUpstream) => {
    // The bare base id is not itself a catalog entry, but the tiered
    // variant is — so tiered resolve finds it. Without a tier in the
    // request it falls back to the base id unchanged.
    const upstreamModel = getModelUpstreamId("ag", "gemini-4-argon", body);
    expect(upstreamModel).toBe(expectedUpstream);
  });

  it("falls back to the base id when no tier is requested", () => {
    expect(getModelUpstreamId("ag", "gemini-4-argon", {})).toBe("gemini-4-argon");
    expect(getModelUpstreamId("ag", "gemini-4-argon")).toBe("gemini-4-argon");
  });
});
