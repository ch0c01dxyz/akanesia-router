/**
 * Leonardo and Ideogram are image-only providers, but their registry entries
 * declared no serviceKinds and their models no kind — so /v1/models kind
 * gating (which defaults a provider/model without kinds to "llm") treated
 * them as chat models (upstream #18683 fixed the same misclassification).
 *
 * The marking below mirrors fal-ai: serviceKinds ["image"] on the provider
 * plus kind "image" on every model. The getProvidersByKind assertions prove
 * the marking takes effect through the shared constants layer, not just in
 * the registry files: image lists include them, llm lists exclude them.
 */

import { describe, it, expect } from "vitest";
import leonardo from "../../open-sse/providers/registry/leonardo.js";
import ideogram from "../../open-sse/providers/registry/ideogram.js";
import { getProvidersByKind } from "@/shared/constants/providers";

describe("Leonardo/Ideogram are image-only providers", () => {
  it.each([
    ["leonardo", leonardo],
    ["ideogram", ideogram],
  ])("%s declares serviceKinds [image] and image-kind models", (_id, entry) => {
    expect(entry.serviceKinds).toEqual(["image"]);
    expect(entry.models.length).toBeGreaterThan(0);
    for (const model of entry.models) {
      expect(model.kind).toBe("image");
    }
  });

  it("appears in image providers but not in llm providers", () => {
    const imageIds = getProvidersByKind("image").map((p) => p.id);
    const llmIds = getProvidersByKind("llm").map((p) => p.id);
    expect(imageIds).toContain("leonardo");
    expect(imageIds).toContain("ideogram");
    expect(llmIds).not.toContain("leonardo");
    expect(llmIds).not.toContain("ideogram");
  });
});
