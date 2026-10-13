import { describe, it, expect } from "vitest";
import { releaseAntigravityQuota } from "@/sse/services/antigravityQuota.js";

describe("releaseAntigravityQuota", () => {
  it("ada dan tidak throw untuk id tak dikenal", () => {
    expect(typeof releaseAntigravityQuota).toBe("function");
    expect(() => releaseAntigravityQuota("conn-tak-ada")).not.toThrow();
  });
});
