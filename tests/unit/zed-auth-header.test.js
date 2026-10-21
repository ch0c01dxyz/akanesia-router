// cloud.zed.dev rejects any Authorization header that is not
// "<numeric user id> <token>" with a bare 401 "Invalid Authorization
// header". buildZedUserAuthHeader must keep well-formed credentials
// byte-identical and fail loudly (not send a guaranteed-rejected
// header) when the stored userId is not Zed's numeric id.
import { describe, it, expect } from "vitest";
import { buildZedUserAuthHeader } from "../../open-sse/shared/zedAuth.js";

describe("buildZedUserAuthHeader", () => {
  it("builds '<userId> <token>' for a numeric user id", () => {
    const header = buildZedUserAuthHeader({
      accessToken: "tok-abc",
      providerSpecificData: { userId: "12345" },
    });
    expect(header).toBe("12345 tok-abc");
  });

  it("accepts a numeric-typed userId and an apiKey fallback token", () => {
    const header = buildZedUserAuthHeader({
      apiKey: "tok-xyz",
      providerSpecificData: { userId: 678 },
    });
    expect(header).toBe("678 tok-xyz");
  });

  it("rejects a non-numeric stored userId with an actionable error", () => {
    expect(() =>
      buildZedUserAuthHeader({
        accessToken: "tok-abc",
        providerSpecificData: { userId: "user-123" },
      }),
    ).toThrow(/not a numeric Zed user id/);
  });

  it("still reports missing credentials as before", () => {
    expect(() => buildZedUserAuthHeader({ providerSpecificData: {} })).toThrow(
      /missing userId or accessToken/,
    );
  });
});
