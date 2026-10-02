// Regression: provider "muse" (Meta Muse, upstream 28809807) tidak boleh
// membajak id "muse-code" milik provider lokal muse-code.js (dari merge OmniRoute).
// Alias "muse-code" SENGAJA dibuang dari registry/muse.js karena
// ALIAS_TO_PROVIDER_ID dibangun berurutan dan aliases menimpa id.
import { describe, it, expect } from "vitest";
import { resolveProviderAlias } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

const museEntry = REGISTRY.find((p) => p.id === "muse");
const museCodeEntry = REGISTRY.find((p) => p.id === "muse-code");

describe("muse vs muse-code tidak saling bajak", () => {
  it("kedua provider terdaftar sebagai id terpisah", () => {
    expect(museEntry).toBeTruthy();
    expect(museCodeEntry).toBeTruthy();
    expect(museEntry.id).not.toBe(museCodeEntry.id);
  });

  it('"muse-code" tidak ada di aliases registry muse', () => {
    expect(museEntry.aliases || []).not.toContain("muse-code");
  });

  it('resolveProviderAlias("muse-code") tetap "muse-code"', () => {
    expect(resolveProviderAlias("muse-code")).toBe("muse-code");
  });

  it('alias muse tetap resolve ke "muse"', () => {
    expect(resolveProviderAlias("muse")).toBe("muse");
    expect(resolveProviderAlias("muse-ai")).toBe("muse");
    expect(resolveProviderAlias("muse-subscription")).toBe("muse");
  });
});
