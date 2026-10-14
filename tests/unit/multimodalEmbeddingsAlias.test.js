/**
 * Alias test: /v1/multimodal-embeddings must behave identically to /v1/embeddings.
 * The alias route re-exports the same handler references, so auth, validation
 * and behavior cannot drift.
 */
import { describe, it, expect } from "vitest";

import * as embeddingsRoute from "../../src/app/api/v1/embeddings/route.js";
import * as aliasRoute from "../../src/app/api/v1/multimodal-embeddings/route.js";

describe("POST/OPTIONS /v1/multimodal-embeddings alias", () => {
  it("re-exports the identical embeddings handlers (same references)", () => {
    expect(aliasRoute.POST).toBe(embeddingsRoute.POST);
    expect(aliasRoute.OPTIONS).toBe(embeddingsRoute.OPTIONS);
  });
});
