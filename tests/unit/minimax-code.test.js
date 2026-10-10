// MiniMax Code (mcode) provider — refresh discipline (single-use tokens,
// spent-token dedup, invalid_grant classification) and quota-error
// normalization. Adapted from upstream tests/unit/minimax-code.test.js:
// the registry-wiring, capabilities/thinking-levels, wire-body and OAuth
// device-flow blocks are CUT — they belong to files ported by other agents
// (registry/index.js, capabilities.js, thinkingLevels.js, src/lib/oauth/*,
// executors/index.js). This file covers only what this port owns:
// open-sse/executors/minimax-code.js + the tokenRefresh refresh function.
import { afterEach, describe, expect, it, vi } from "vitest";

// ── executor under test (mock the heavy base + its refresh import) ──────────
class StubBase {
  constructor(provider) { this.provider = provider; }
  async execute() { return { response: new Response("{}", { status: 200 }) }; }
}
vi.mock("../../open-sse/executors/default.js", () => ({
  DefaultExecutor: StubBase,
}));
const refreshMiniMaxMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshMiniMaxCodeToken: refreshMiniMaxMock,
}));

const { MinimaxCodeExecutor, normalizeQuotaResponse } = await import("../../open-sse/executors/minimax-code.js");
// The real refresh handler (vi.importActual bypasses the mock above — it is
// only in place to intercept the executor's import).
const { refreshMiniMaxCodeToken } = await vi.importActual("../../open-sse/services/tokenRefresh.js");

describe("minimax-code refresh handler", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it("routes both providers through the single-use-token handler", async () => {
    const ex = new MinimaxCodeExecutor("minimax-code-global");
    refreshMiniMaxMock.mockResolvedValue({ accessToken: "a2", refreshToken: "r2", expiresIn: 3600 });
    const out = await ex.refreshCredentials({ refreshToken: "r1" });
    expect(refreshMiniMaxMock).toHaveBeenCalledWith("minimax-code-global", "r1", undefined);
    expect(out.accessToken).toBe("a2");
  });

  it("refreshMiniMaxCodeToken posts the mcode grant and rotates the refresh token", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: new URLSearchParams(init.body) });
      return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
    });
    const out = await refreshMiniMaxCodeToken("minimax-code", "r1");
    expect(calls[0].url).toBe("https://account.minimax.cn/oauth2/token");
    expect(calls[0].body.get("grant_type")).toBe("refresh_token");
    expect(calls[0].body.get("client_id")).toBe("mcode-public");
    expect(calls[0].body.get("scope")).toBe("agent.default");
    expect(calls[0].body.get("audience")).toBe("agent-backend");
    expect(out).toEqual({ accessToken: "a2", refreshToken: "r2", expiresIn: 3600 });
  });

  it("returns invalid_grant (the one sign-out answer) on 400 reuse", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const out = await refreshMiniMaxCodeToken("minimax-code", "spent");
    expect(out).toEqual({ error: "invalid_grant" });
  });

  it("returns null on transient failures (sign-in stays)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 502 }));
    expect(await refreshMiniMaxCodeToken("minimax-code", "r-transient")).toBeNull();
  });

  it("dedupes concurrent refreshes of the same refresh token", async () => {
    let hits = 0;
    globalThis.fetch = vi.fn(async () => {
      hits++;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
    });
    const [a, b] = await Promise.all([
      refreshMiniMaxCodeToken("minimax-code", "shared"),
      refreshMiniMaxCodeToken("minimax-code", "shared"),
    ]);
    expect(hits).toBe(1);
    expect(a).toEqual(b);
  });

  it("global site hits account.minimax.io", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
    });
    await refreshMiniMaxCodeToken("minimax-code-global", "r9");
    expect(calls[0]).toBe("https://account.minimax.io/oauth2/token");
  });
});

describe("minimax-code executor quota normalization", () => {
  const jsonResponse = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

  it("rewrites 402/403 credits refusals to 429 rate_limit_error", async () => {
    for (const status of [402, 403]) {
      const res = await normalizeQuotaResponse(jsonResponse(status, {
        error: { message: "积分不足，请充值或签到" },
      }));
      expect(res.status).toBe(429);
      const v = await res.json();
      expect(v.error.type).toBe("rate_limit_error");
      expect(v.error.message).toContain("积分不足");
    }
  });

  it("matches balance words in English and raw Chinese bodies", async () => {
    const a = await normalizeQuotaResponse(jsonResponse(403, { message: "insufficient balance" }));
    expect(a.status).toBe(429);
    const b = await normalizeQuotaResponse(jsonResponse(402, "额度已用完"));
    expect(b.status).toBe(429);
  });

  it("passes a real 403 auth refusal through with its status intact", async () => {
    const res = await normalizeQuotaResponse(jsonResponse(403, { error: { message: "invalid token" } }));
    expect(res.status).toBe(403);
    const v = await res.json();
    expect(v.error.message).toBe("invalid token");
  });

  it("passes 429 through unchanged in status", async () => {
    const res = await normalizeQuotaResponse(jsonResponse(429, { error: { message: "slow down" } }));
    expect(res.status).toBe(429);
  });

  it("ignores statuses outside the refusal set", async () => {
    const res = await normalizeQuotaResponse(jsonResponse(500, { error: { message: "x" } }));
    expect(res.status).toBe(500);
  });

  it("executor delegates refresh to the deduped handler by provider id", async () => {
    const ex = new MinimaxCodeExecutor("minimax-code");
    expect(ex.constructor.name).toBe("MinimaxCodeExecutor");
    expect(ex.provider).toBe("minimax-code");
    expect(await ex.refreshCredentials(null)).toBeNull();
    refreshMiniMaxMock.mockResolvedValue({ accessToken: "a2" });
    const out = await ex.refreshCredentials({ refreshToken: "r1" });
    expect(refreshMiniMaxMock).toHaveBeenCalledWith("minimax-code", "r1", undefined);
    expect(out.accessToken).toBe("a2");
  });
});
