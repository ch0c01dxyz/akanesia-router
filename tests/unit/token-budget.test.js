import { describe, expect, it } from "vitest";

import {
  MIN_ANSWER_TOKENS,
  THINKING_BUDGET,
  MIN_PLAIN_TOKENS,
  effectiveMaxTokens,
  isReasoningModel,
  isReasoningRequest,
} from "../../open-sse/utils/tokenBudget.js";

describe("token budget floor (P1)", () => {
  it("reasoning model kecil tidak pernah di bawah answer+thinking budget", () => {
    const got = effectiveMaxTokens(50, "opencode-go", "muse-spark-1.3-contributor-free", {});
    expect(got).toBe(MIN_ANSWER_TOKENS + THINKING_BUDGET);
  });

  it("nilai klien tidak pernah diturunkan", () => {
    const got = effectiveMaxTokens(8000, "opencode-go", "muse-spark-1.3-contributor-free", {});
    expect(got).toBe(8000 + THINKING_BUDGET);
  });

  it("non-reasoning model dapat floor minimal", () => {
    // model tanpa reasoning:true di capabilities
    const got = effectiveMaxTokens(10, "opencode-go", "definitely-not-a-real-model-xyz", {});
    expect(got).toBe(MIN_PLAIN_TOKENS);
  });

  it("reasoning_effort eksplisit memicu reasoning budget", () => {
    expect(isReasoningRequest({ reasoning_effort: "high" }, "opencode-go", "big-pickle")).toBe(true);
    expect(isReasoningRequest({ reasoning_effort: "none" }, "opencode-go", "definitely-not-a-real-model-xyz")).toBe(false);
    expect(isReasoningRequest({}, "opencode-go", "definitely-not-a-real-model-xyz")).toBe(false);
  });

  it("isReasoningModel baca dari capabilities", () => {
    expect(isReasoningModel("opencode-go", "muse-spark-1.3-contributor-free")).toBe(true);
    expect(isReasoningModel("opencode-go", "")).toBe(false);
  });

  it("dibatasi ceiling maxOutput model", () => {
    // big-pickle maxOutput 32000 di capabilities → tidak boleh lewat
    const got = effectiveMaxTokens(undefined, "opencode-go", "big-pickle", {});
    expect(got).toBeLessThanOrEqual(32000);
  });
});
