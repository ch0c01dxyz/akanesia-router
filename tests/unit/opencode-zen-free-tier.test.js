import { describe, expect, it } from "vitest";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";
import { OPENCODE_SESSION_RE } from "../../open-sse/executors/opencode-zen.js";
import { isOpencodeFreeTierModel } from "../../open-sse/providers/models/helpers.js";

// Upstream 403s free-tier models on the keyed lane when the request carries a
// real oc_sk_* key (FreeTierError: "can only be used from within OpenCode").
// The executor must switch those to the attested `Bearer public` identity.

function preparedCredentials(executor, overrides = {}) {
  const body = { messages: [{ role: "user", content: "hi" }] };
  const credentials = {
    apiKey: "oc_sk_test_key",
    rawHeaders: {},
    connectionId: "conn_test",
    ...overrides,
  };
  return executor.prepareRequestCredentials({
    body,
    credentials,
    providerSessionId: "conversation-a",
    clientTool: "test",
  });
}

function headersFor(model, overrides) {
  const executor = new OpenCodeZenExecutor();
  const credentials = preparedCredentials(executor, overrides);
  return executor.buildHeaders(credentials, true, "https://opencode.ai/zen/v1/chat/completions", model);
}

describe("isOpencodeFreeTierModel", () => {
  it("detects -free suffixed ids", () => {
    for (const m of [
      "mimo-v2.6-flash-free",
      "muse-spark-1.3-contributor-free",
      "big-pickle-free",
      "deepseek-v4-flash-free",
      "jev-1.13-free",
    ]) {
      expect(isOpencodeFreeTierModel(m)).toBe(true);
    }
  });

  it("ignores paid models", () => {
    for (const m of ["big-pickle", "muse-spark-1.3", "gpt-5.5", "claude-opus-5", "kimi-k3"]) {
      expect(isOpencodeFreeTierModel(m)).toBe(false);
    }
  });

  it("strips thinking suffixes and provider prefixes before matching", () => {
    expect(isOpencodeFreeTierModel("mimo-v2.6-flash-free(xhigh)")).toBe(true);
    expect(isOpencodeFreeTierModel("muse-spark-1.3-contributor-free(1m)")).toBe(true);
    expect(isOpencodeFreeTierModel("ocfree/mimo-v2.6-flash-free")).toBe(true);
    expect(isOpencodeFreeTierModel("big-pickle(max)")).toBe(false);
    expect(isOpencodeFreeTierModel("")).toBe(false);
    expect(isOpencodeFreeTierModel(null)).toBe(false);
  });
});

describe("OpenCodeZenExecutor free-tier auth", () => {
  it("sends Bearer public + mirrored session ids for free-tier models (fork v2 fingerprint)", () => {
    const headers = headersFor("mimo-v2.6-flash-free");
    expect(headers["Authorization"]).toBe("Bearer public");
    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    // v2 gate: session mirrored across four headers; x-opencode-request is
    // rejected with 403 and never sent.
    expect(headers["x-opencode-session-id"]).toBe(headers["x-opencode-session"]);
    expect(headers["x-session-affinity"]).toBe(headers["x-opencode-session"]);
    expect(headers["x-session-id"]).toBe(headers["x-opencode-session"]);
    expect(headers["x-opencode-request"]).toBeUndefined();
    expect(headers["x-opencode-client"]).toBe("cli");
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });

  it("does the same for responses-endpoint free models", () => {
    const headers = headersFor(
      "muse-spark-1.3-contributor-free",
      {},
    );
    expect(headers["Authorization"]).toBe("Bearer public");
    expect(headers["x-opencode-request"]).toBeUndefined();
    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
  });

  it("keeps the connection key for paid models", () => {
    const headers = headersFor("big-pickle");
    expect(headers["Authorization"]).toBe("Bearer oc_sk_test_key");
    expect(headers["x-opencode-request"]).toBeUndefined();
    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
  });

  it("routes non-muse free models to chat completions and muse-spark to responses (#4842)", () => {
    const executor = new OpenCodeZenExecutor();
    expect(executor.buildUrl("mimo-v2.6-flash-free")).toBe("https://opencode.ai/inference/v1/chat/completions");
    expect(executor.buildUrl("muse-spark-1.3-contributor-free")).toBe("https://opencode.ai/inference/v1/responses");
  });

  it("keeps the chat body on the chat lane with chat-shaped fingerprint tools (#4842)", () => {
    const executor = new OpenCodeZenExecutor();
    const out = executor.transformRequest("beam-free", {
      messages: [{ role: "user", content: "hi" }],
    }, false, {});
    expect(out.messages).toBeDefined();
    expect(out.stream).toBe(true);
    expect(out.tools.map((t) => t.function?.name)).toEqual(expect.arrayContaining(["shell", "read"]));
  });
});
