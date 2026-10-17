import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { getExecutor } from "../../open-sse/executors/index.js";
import {
  OPENCODE_SESSION_RE,
  generateSessionId,
  translateSessionId,
  stableSessionId,
} from "../../open-sse/executors/opencode.js";
import {
  generateSessionId as generateZenSessionId,
  translateSessionId as translateZenSessionId,
} from "../../open-sse/executors/opencode-zen.js";

function makeCredentials(overrides = {}) {
  return {
    connectionId: "conn_test",
    rawHeaders: {},
    ...overrides,
  };
}

function prepare(executor, overrides = {}) {
  const credentials = overrides.credentials || makeCredentials();
  const prepared = executor.prepareRequestCredentials({
    body: overrides.body || { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] },
    credentials,
    providerSessionId: overrides.providerSessionId ?? "conversation-a",
    clientTool: overrides.clientTool ?? "claude",
  });
  return { credentials, prepared };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

describe("OpenCode Free Session ID Format", () => {
  it("generates session IDs matching OpenCode canonical format (ses_ + 12 hex + 14 base62)", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(id).toMatch(OPENCODE_SESSION_RE);
      expect(id).toHaveLength(30);
    }
  });

  it("translates arbitrary sessions into valid OpenCode session format", () => {
    const inputs = [
      "claude:550e8400-e29b-41d4-a716-446655440000",
      "antigravity:conv-abc-123",
      "session-from-codex",
      "12345",
      "",
    ];
    for (const raw of inputs) {
      const translated = translateSessionId(raw, "claude");
      expect(translated).toMatch(OPENCODE_SESSION_RE);
      expect(translated).toHaveLength(30);
    }
  });

  // Upstream decodes the prefix as ~(time * 0x1000 + counter) and answers
  // 403 FreeTierError unless the counter is small; hash-filled prefixes failed (#4780).
  it("encodes a small counter in session prefixes so the free-tier gate accepts them (#4780)", () => {
    const counterOf = (id) => Number(~BigInt(`0x${id.slice(4, 16)}`) & 0xfffn);
    for (const translate of [translateSessionId, translateZenSessionId]) {
      for (const raw of ["claude:550e8400-e29b-41d4-a716-446655440000", "session-from-codex", "", "x".repeat(300)]) {
        const translated = translate(raw, "claude");
        expect(translated).toMatch(OPENCODE_SESSION_RE);
        // Fork translateSessionId() reuses the shared generateSessionId counter,
        // so the counter can exceed 1 within the same millisecond; the gate only
        // needs a small (12-bit) counter, which inverted-timestamp always gives.
        expect(counterOf(translated)).toBeGreaterThan(0);
        expect(counterOf(translated)).toBeLessThanOrEqual(0xfff);
        expect(translate(raw, "claude")).toBe(translated);
      }
    }
    expect(counterOf(generateZenSessionId(1_700_000_000_000))).toBe(1);
    expect(counterOf(generateSessionId(1_700_000_000_000))).toBeLessThanOrEqual(0xfff);
  });

  it("preserves already-valid OpenCode sessions without re-hashing", () => {
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    expect(translateSessionId(valid)).toBe(valid);
    expect(translateSessionId(`  ${valid}  `)).toBe(valid);
    expect(translateZenSessionId(valid)).toBe(valid);
  });
});

describe("OpenCode Free Executor Session Resolution (opencode-zen)", () => {
  it("uses request-local session credentials without mutating source credentials", async () => {
    const executor = await getExecutor("opencode-zen");
    const { credentials, prepared } = prepare(executor);

    expect(executor.constructor.name).toBe("OpenCodeZenExecutor");
    expect(prepared).not.toBe(credentials);
    expect(prepared._opencodeZenSession).toMatch(OPENCODE_SESSION_RE);
    expect(credentials).not.toHaveProperty("_opencodeZenSession");
  });

  it("translates conversation session deterministically", async () => {
    const executor = await getExecutor("opencode-zen");
    const first = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeZenSession;
    const second = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeZenSession;

    expect(first).toBe(second);
    expect(first).toMatch(OPENCODE_SESSION_RE);
  });

  it("isolates different conversations and tools", async () => {
    const executor = await getExecutor("opencode-zen");
    const convA = prepare(executor, { providerSessionId: "conversation-a" }).prepared._opencodeZenSession;
    const convB = prepare(executor, { providerSessionId: "conversation-b" }).prepared._opencodeZenSession;
    const toolClaude = prepare(executor, { providerSessionId: "same", clientTool: "claude" }).prepared._opencodeZenSession;
    const toolCodex = prepare(executor, { providerSessionId: "same", clientTool: "codex" }).prepared._opencodeZenSession;

    expect(convA).not.toBe(convB);
    expect(toolClaude).not.toBe(toolCodex);
  });

  it("adds the valid session header to fetch requests", async () => {
    const executor = await getExecutor("opencode-zen");
    const credentials = makeCredentials();
    const result = await executor.execute({
      model: "mimo-v2.6-flash-free",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials,
      providerSessionId: "conversation-fetch-test",
      clientTool: "claude",
    });

    expect(result.headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(fetchMock.mock.calls[0][1].headers["Authorization"]).toBe("Bearer public");
    expect(credentials).not.toHaveProperty("_opencodeZenSession");
  });

  it("falls back to a valid generated session in buildHeaders when called standalone", async () => {
    const executor = await getExecutor("opencode-zen");
    const headers = executor.buildHeaders({});

    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    // No model arg -> not free-tier -> Authorization untouched by #4784 gate.
    expect(headers["Authorization"]).toBe("Bearer undefined");
  });

  it("handles null or undefined body gracefully in transformRequest", async () => {
    const executor = await getExecutor("opencode-zen");
    expect(() => executor.transformRequest("muse-spark-1.3-contributor-free", null, false, {})).not.toThrow();
    expect(() => executor.transformRequest("mimo-v2.6-flash-free", undefined, false, {})).not.toThrow();
  });
});

describe("OpenCode Free User-Agent Validation", () => {
  it("defaults User-Agent to opencode/latest/2.0.29/cli for non-opencode downstream clients", async () => {
    const executor = await getExecutor("opencode-zen");
    const headersNoUa = executor.buildHeaders({});
    expect(headersNoUa["User-Agent"]).toBe("opencode/latest/2.0.29/cli");

    const headersClaude = executor.buildHeaders({ rawHeaders: { "user-agent": "Claude-Code/1.0" } });
    expect(headersClaude["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });

  it("upgrades outdated opencode versions (< 1.17) to prevent 426 Upgrade Required", async () => {
    const executor = await getExecutor("opencode-zen");
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/1.15.0" } });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });

  it("rewrites v2 desktop UA to the cli identity accepted by the free-tier gate", async () => {
    const executor = await getExecutor("opencode-zen");
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/latest/2.0.29/desktop" } });
    // Fork gate only trusts opencode/latest/<v>/cli verbatim; desktop is spoofed to cli.
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });
});

describe("OpenCode v2 free-tier headers (#4784 + #4842)", () => {
  it("mirrors session across four headers, drops x-opencode-request, defaults client to cli", async () => {
    const executor = await getExecutor("opencode-zen");
    const headers = executor.buildHeaders({});

    const session = headers["x-opencode-session"];
    expect(session).toMatch(OPENCODE_SESSION_RE);
    expect(headers["x-opencode-session-id"]).toBe(session);
    expect(headers["x-session-affinity"]).toBe(session);
    expect(headers["x-session-id"]).toBe(session);
    expect(headers["x-opencode-client"]).toBe("cli");
    expect(headers["x-opencode-request"]).toBeUndefined();
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });

  it("uses Bearer public for -free models and keeps the real key for paid ones (#4784)", async () => {
    const executor = await getExecutor("opencode-zen");
    const creds = { apiKey: "oc_sk_test_123", rawHeaders: {} };
    const hFree = executor.buildHeaders(creds, true, "https://opencode.ai/inference/v1/chat/completions", "mimo-v2.6-flash-free");
    const hPaid = executor.buildHeaders(creds, true, "https://opencode.ai/inference/v1/chat/completions", "glm-5.3-flash");
    expect(hFree["Authorization"]).toBe("Bearer public");
    expect(hPaid["Authorization"]).toBe("Bearer oc_sk_test_123");
  });

  it("routes only Muse Spark to /responses, everything else to chat completions (#4842)", async () => {
    const zen = await getExecutor("opencode-zen");
    expect(zen.buildUrl("muse-spark-1.3-contributor-free")).toBe(
      "https://opencode.ai/inference/v1/responses"
    );
    expect(zen.buildUrl("mimo-v2.6-flash-free")).toBe(
      "https://opencode.ai/inference/v1/chat/completions"
    );
    expect(zen.buildUrl("beam-free")).toBe(
      "https://opencode.ai/inference/v1/chat/completions"
    );

    // Fork: getExecutor("opencode") resolves to the production bridge
    // executor (bridge://opencode). Routing parity is asserted on the raw
    // OpenCodeExecutor class instead.
    const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");
    const oc = new OpenCodeExecutor();
    expect(oc.buildUrl("muse-spark-1.3-contributor-free")).toBe(
      "https://opencode.ai/inference/v1/responses"
    );
    expect(oc.buildUrl("nemotron-3-ultra-free")).toBe(
      "https://opencode.ai/inference/v1/chat/completions"
    );
  });

  it("chat lane keeps the chat body with chat-shaped fingerprint tools (#4842)", async () => {
    const zen = await getExecutor("opencode-zen");
    const chatBody = zen.transformRequest("mimo-v2.6-flash-free", {
      messages: [{ role: "user", content: "hi" }],
    }, false, {});
    expect(chatBody.messages).toBeDefined();
    expect(chatBody.input).toBeUndefined();
    expect(chatBody.stream).toBe(true);
    const names = chatBody.tools.map((t) => t.function?.name);
    expect(names).toEqual(expect.arrayContaining(["shell", "read"]));

    const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");
    const ocChat = new OpenCodeExecutor().transformRequest("nemotron-3-ultra-free", {
      messages: [{ role: "user", content: "hi" }],
    }, false, {});
    expect(ocChat.messages).toBeDefined();
    expect(ocChat.stream).toBe(true);
    expect(ocChat.tools.map((t) => t.function?.name)).toEqual(
      expect.arrayContaining(["shell", "read"])
    );
  });

  it("responses lane shapes a Responses body for Muse Spark (#4842)", async () => {
    const zen = await getExecutor("opencode-zen");
    const respBody = zen.transformRequest("muse-spark-1.3-contributor-free", {
      messages: [{ role: "user", content: "hi" }],
    }, false, {});
    expect(respBody.input).toBeDefined();
    // Fork keeps the upstream messages field alongside the Responses body
    // (upstream #4842 deletes it; harmless for muse-spark which upstream
    // deprecated with 410).
    expect(respBody.messages).toBeDefined();
    expect(respBody.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["shell", "read"])
    );

    const withModel = zen.transformRequest("muse-spark-1.3-contributor-free", {
      model: "muse-spark-1.3-contributor-free",
      messages: [{ role: "user", content: "hi" }],
    }, false, {});
    expect(withModel.input).toBeDefined();
    expect(withModel.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["shell", "read"])
    );
  });
});

describe("OpenCode Stable Session Reuse (429 follow-up)", () => {
  it("exposes the stable session helper directly", () => {
    const first = stableSessionId({ connectionId: "direct-conn" });
    expect(stableSessionId({ connectionId: "direct-conn" })).toBe(first);
    expect(first).toMatch(OPENCODE_SESSION_RE);
  });

  it("keeps prepareRequestCredentials stable per provider session", async () => {
    const executor = await getExecutor("opencode-zen");
    const first = prepare(executor, { providerSessionId: "conv-stable" }).prepared._opencodeZenSession;
    const second = prepare(executor, { providerSessionId: "conv-stable" }).prepared._opencodeZenSession;
    expect(first).toMatch(OPENCODE_SESSION_RE);
    expect(second).toBe(first);
  });

  it("declares forceStream on the opencode transport so chatCore serves SSE upstream", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    expect(PROVIDERS.opencode?.forceStream).toBe(true);
  });
});
