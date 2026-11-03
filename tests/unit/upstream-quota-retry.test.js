import { afterEach, describe, expect, it, vi } from "vitest";
import { upstreamRetryResetMs } from "../../open-sse/utils/upstreamHeaders.js";
import { createErrorResult, parseUpstreamError } from "../../open-sse/utils/error.js";

const now = Date.parse("2026-11-03T10:00:00Z");
afterEach(() => vi.useRealTimers());

describe("upstream retry windows", () => {
  it("reads seconds and HTTP dates from Retry-After before a body hint", () => {
    expect(upstreamRetryResetMs(new Headers({ "Retry-After": "113" }), { retry_after: 2 }, now)).toBe(now + 113000);
    expect(upstreamRetryResetMs(new Headers({ "Retry-After": "Tue, 03 Nov 2026 10:02:00 GMT" }), null, now)).toBe(now + 120000);
  });

  it("reads numeric body hints and rejects invalid or expired hints", () => {
    expect(upstreamRetryResetMs(new Headers(), { retry_after: 113 }, now)).toBe(now + 113000);
    expect(upstreamRetryResetMs(new Headers({ "Retry-After": "invalid" }), { error: { retry_after: "30" } }, now)).toBe(now + 30000);
    for (const retry_after of [null, undefined, true, [], {}, "", "soon", -1, Infinity]) {
      expect(upstreamRetryResetMs(new Headers(), { retry_after }, now)).toBeNull();
    }
    expect(upstreamRetryResetMs(new Headers({ "Retry-After": "Mon, 02 Nov 2026 10:00:00 GMT" }), null, now)).toBeNull();
  });

  it("preserves retry metadata when a generic executor parses the error", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const res = Response.json({ error: { message: "quota reached" } }, { status: 429, headers: { "Retry-After": "113" } });
    const parsed = await parseUpstreamError(res, { parseError: (r, text) => ({ status: r.status, message: text }) });
    expect(parsed.resetsAtMs).toBe(now + 113000);
    const result = createErrorResult(parsed.statusCode, parsed.message, parsed.resetsAtMs);
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("113");
  });

  it("preserves a provider-specific reset over a generic Retry-After", async () => {
    const precise = now + 300000;
    const res = Response.json({ error: "quota" }, { status: 429, headers: { "Retry-After": "2" } });
    expect((await parseUpstreamError(res, { parseError: () => ({ status: 429, resetsAtMs: precise }) })).resetsAtMs).toBe(precise);
  });

  it("keeps body retry_after when no executor or HTTP hint is present", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const parsed = await parseUpstreamError(Response.json({ error: "all_keys_cooling", retry_after: 113 }, { status: 503 }));
    expect(parsed).toMatchObject({ statusCode: 503, resetsAtMs: now + 113000 });
  });

  it("does not turn a malformed request into a quota cooldown", async () => {
    const parsed = await parseUpstreamError(Response.json({ error: "bad input", retry_after: 30 }, {
      status: 400, headers: { "Retry-After": "30" },
    }));
    expect(parsed.resetsAtMs).toBeUndefined();
  });
});
