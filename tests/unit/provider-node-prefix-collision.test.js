import { describe, it, expect } from "vitest";
import { isReservedProviderPrefix, RESERVED_PROVIDER_PREFIXES } from "@/sse/services/model.js";

describe("isReservedProviderPrefix", () => {
  it("menolak prefix yang sama dengan id provider bawaan (kasus tokenharbor)", () => {
    expect(RESERVED_PROVIDER_PREFIXES.has("tokenharbor")).toBe(true);
    expect(isReservedProviderPrefix("tokenharbor")).toBe(true);
  });

  it("menolak alias provider bawaan", () => {
    // "th" adalah alias resmi provider tokenharbor di registry
    expect(isReservedProviderPrefix("th")).toBe(true);
    expect(isReservedProviderPrefix("openai")).toBe(true);
  });

  it("menerima prefix kustom yang tidak bertabrakan", () => {
    expect(isReservedProviderPrefix("tokenharbor-custom")).toBe(false);
    expect(isReservedProviderPrefix("oc-prod")).toBe(false);
  });

  it("trim spasi dan tolak input bukan string", () => {
    expect(isReservedProviderPrefix("  tokenharbor  ")).toBe(true);
    expect(isReservedProviderPrefix(undefined)).toBe(false);
    expect(isReservedProviderPrefix(null)).toBe(false);
    expect(isReservedProviderPrefix("")).toBe(false);
  });
});
