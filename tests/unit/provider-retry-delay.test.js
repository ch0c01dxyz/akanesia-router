import { describe, it, expect } from "vitest";

import {
  normalizeRetryDelaySeconds,
  resolveProviderRetryDelayMs,
} from "../../src/sse/services/providerRetryDelay.js";

describe("provider retry delay override", () => {
  it("normalize: hanya angka positif yang valid", () => {
    expect(normalizeRetryDelaySeconds(30)).toBe(30);
    expect(normalizeRetryDelaySeconds("60")).toBe(60);
    expect(normalizeRetryDelaySeconds(45.9)).toBe(45);
    expect(normalizeRetryDelaySeconds(0)).toBeNull();
    expect(normalizeRetryDelaySeconds(-5)).toBeNull();
    expect(normalizeRetryDelaySeconds("auto")).toBeNull();
    expect(normalizeRetryDelaySeconds(undefined)).toBeNull();
  });

  it("resolve: map kosong / provider tak diatur -> null (backoff bawaan)", () => {
    expect(resolveProviderRetryDelayMs({}, ["openai"])).toBeNull();
    expect(resolveProviderRetryDelayMs(null, ["openai"])).toBeNull();
    expect(resolveProviderRetryDelayMs({ openai: 30 }, ["anthropic"])).toBeNull();
  });

  it("resolve: detik diubah ke milidetik; id kanonis menang atas mentah", () => {
    expect(resolveProviderRetryDelayMs({ openai: 30 }, ["openai"])).toBe(30000);
    expect(resolveProviderRetryDelayMs({ openai: 30, oc: 120 }, ["openai", "oc"])).toBe(30000);
    expect(resolveProviderRetryDelayMs({ oc: 120 }, ["openai", "oc"])).toBe(120000);
    expect(resolveProviderRetryDelayMs({ openai: 0 }, ["openai"])).toBeNull();
  });
});
