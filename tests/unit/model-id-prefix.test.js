import { describe, expect, it } from "vitest";
import { collapseProviderPrefix } from "../../src/lib/modelIdPrefix.js";

describe("collapseProviderPrefix", () => {
  it("leaves ids without a slash untouched", () => {
    expect(collapseProviderPrefix("gpt-4o", ["bansos"])).toBe("gpt-4o");
  });

  it("leaves upstream ids with legitimate slashes untouched", () => {
    expect(collapseProviderPrefix("opc/big-pickle", ["bansos"])).toBe("opc/big-pickle");
  });

  it("strips a single leading copy of the node's own prefix", () => {
    expect(collapseProviderPrefix("bansos/gpt-image-1", ["bansos"])).toBe("gpt-image-1");
  });

  it("collapses a repeated stack of the node's own prefix", () => {
    expect(collapseProviderPrefix("bansos/bansos/bansos/gpt-image-1", ["bansos"])).toBe("gpt-image-1");
  });

  it("collapses mixed stacks of the node's own identifiers", () => {
    expect(
      collapseProviderPrefix("bansos/openai-compatible-chat-1/gpt-image-1", [
        "bansos",
        "openai-compatible-chat-1",
      ])
    ).toBe("gpt-image-1");
  });

  it("does not strip a canonical provider's own name segment", () => {
    // Scoping rule: callers only pass compatible-node prefixes, so a
    // canonical id is never in the candidate list in the first place.
    expect(collapseProviderPrefix("moonshotai/Kimi-K3.1-Pro", ["bansos"])).toBe(
      "moonshotai/Kimi-K3.1-Pro"
    );
  });

  it("matches prefixes case-sensitively and never strips to an empty id", () => {
    expect(collapseProviderPrefix("Bansos/gpt-image-1", ["bansos"])).toBe("Bansos/gpt-image-1");
    expect(collapseProviderPrefix("bansos/", ["bansos"])).toBe("bansos/");
  });

  it("is idempotent", () => {
    const once = collapseProviderPrefix("bansos/bansos/model-x", ["bansos"]);
    expect(collapseProviderPrefix(once, ["bansos"])).toBe(once);
  });
});
