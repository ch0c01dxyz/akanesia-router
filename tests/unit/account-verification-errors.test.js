import { describe, expect, it } from "vitest";
import { buildErrorBody } from "../../open-sse/utils/error.js";
import { isAccountVerificationError } from "../../open-sse/config/errorConfig.js";

describe("account verification errors", () => {
  it("preserves a distinct actionable code instead of claiming quota exhaustion", () => {
    expect(buildErrorBody(403, "Verify your email address to use the API").error).toMatchObject({
      code: "email_verification_required", type: "permission_error",
    });
    expect(buildErrorBody(403).error).toMatchObject({ code: "permission_denied", message: "Access denied by upstream provider" });
  });
  it("does not interpret policy refusals or rate limits as account verification failures", () => {
    expect(isAccountVerificationError(403, "Content policy denied")).toBe(false);
    expect(isAccountVerificationError(429, "verify your email address")).toBe(false);
    expect(isAccountVerificationError(403, { error: "email_verification_required" })).toBe(false);
    expect(buildErrorBody(429).error.code).toBe("rate_limit_exceeded");
  });
});
