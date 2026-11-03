// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { checkFallbackError, isModelLockActive, getEarliestModelLockUntil, MODEL_LOCK_ALL, getModelLockKey } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — request-scoped vs account-scoped failures", () => {
  it("does not cool the account down for a 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});

describe("isModelLockActive — independent account and model cooldowns", () => {
  const future = () => new Date(Date.now() + 60000).toISOString();
  const past = () => new Date(Date.now() - 60000).toISOString();

  it("honors the account cooldown when the model cooldown expired", () => {
    expect(isModelLockActive({ [getModelLockKey("m")]: past(), [MODEL_LOCK_ALL]: future() }, "m")).toBe(true);
  });

  it("honors the account cooldown when the model expiry is malformed", () => {
    expect(isModelLockActive({ [getModelLockKey("m")]: "invalid", [MODEL_LOCK_ALL]: future() }, "m")).toBe(true);
  });

  it("honors a model cooldown independently and releases expired locks", () => {
    expect(isModelLockActive({ [getModelLockKey("m")]: future(), [MODEL_LOCK_ALL]: past() }, "m")).toBe(true);
    expect(isModelLockActive({ [getModelLockKey("m")]: past(), [MODEL_LOCK_ALL]: past() }, "m")).toBe(false);
    expect(isModelLockActive({}, "m")).toBe(false);
  });
});

describe("retry timing for the requested model", () => {
  it("ignores other models and waits for both model and account locks", () => {
    const near = new Date(Date.now() + 10000).toISOString();
    const model = new Date(Date.now() + 120000).toISOString();
    const account = new Date(Date.now() + 240000).toISOString();
    const connection = { modelLock_other: near, modelLock_requested: model, [MODEL_LOCK_ALL]: account };
    expect(getEarliestModelLockUntil(connection, "requested")).toBe(account);
    expect(getEarliestModelLockUntil(connection)).toBe(near);
    expect(getEarliestModelLockUntil({ modelLock_requested: model, modelLock_other: near }, "requested")).toBe(model);
  });

  it("ignores invalid dates and returns no requested lock for an unrelated model", () => {
    expect(getEarliestModelLockUntil({ modelLock_bad: "invalid" })).toBeNull();
    expect(getEarliestModelLockUntil({ modelLock_other: new Date(Date.now() + 10000).toISOString() }, "requested")).toBeNull();
  });
});
