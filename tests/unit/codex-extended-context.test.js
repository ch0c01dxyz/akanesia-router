import { describe, expect, it } from "vitest";

import codex from "../../open-sse/providers/registry/codex.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripModelContextMarker } from "../../open-sse/utils/modelMarkers.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const EXTENDED_IDS = ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

describe("codex extended context models", () => {
  it.each(EXTENDED_IDS)("%s[1m] resolves ke upstream id dengan window 872k", (id) => {
    const extended = `${id}[1m]`;
    expect(codex.models.find((model) => model.id === extended)?.upstreamModelId).toBe(id);
    expect(getModelUpstreamId("cx", extended)).toBe(id);
    expect(getCapabilitiesForModel("codex", extended).contextWindow).toBe(872000);
    expect(getCapabilitiesForModel("cx", extended).contextWindow).toBe(872000);
    expect(stripModelContextMarker(`cx/${extended}`)).toEqual({ model: `cx/${id}`, contextMarker: "1m" });
  });

  it("fallback akun codex untuk model yang tidak didukung akun ChatGPT", () => {
    const unsupported = "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.";
    expect(checkFallbackError(400, unsupported, 0, "codex").shouldFallback).toBe(true);
    expect(checkFallbackError(400, "Invalid JSON body", 0, "codex").shouldFallback).toBe(false);
  });
});
