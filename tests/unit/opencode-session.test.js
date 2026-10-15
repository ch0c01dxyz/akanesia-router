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

  it("preserves already-valid OpenCode sessions without re-hashing", () => {
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    expect(translateSessionId(valid)).toBe(valid);
    expect(translateSessionId(`  ${valid}  `)).toBe(valid);
  });
});

describe("OpenCode Free Executor Session Resolution", () => {
  it("uses request-local session credentials without mutating source credentials", async () => {
    const executor = await getExecutor("opencode");
    const { credentials, prepared } = prepare(executor);

    expect(executor.constructor.name).toBe("OpenCodeExecutor");
    expect(prepared).not.toBe(credentials);
    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(credentials).not.toHaveProperty("_opencodeSession");
    expect(executor).not.toHaveProperty("_currentSessionId");
  });

  it("preserves valid native x-opencode-session header case-insensitively", async () => {
    const executor = await getExecutor("opencode");
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "X-OpenCode-Session": ` ${valid} ` } }),
    });

    expect(prepared._opencodeSession).toBe(valid);
  });

  it("translates invalid native x-opencode-session header into a valid session", async () => {
    const executor = await getExecutor("opencode");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "x-opencode-session": "invalid-session-uuid" } }),
    });

    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(prepared._opencodeSession).not.toBe("invalid-session-uuid");
  });

  it("translates conversation session deterministically", async () => {
    const executor = await getExecutor("opencode");
    const first = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeSession;
    const second = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeSession;

    expect(first).toBe(second);
    expect(first).toMatch(OPENCODE_SESSION_RE);
  });

  it("isolates different conversations and tools", async () => {
    const executor = await getExecutor("opencode");
    const convA = prepare(executor, { providerSessionId: "conversation-a" }).prepared._opencodeSession;
    const convB = prepare(executor, { providerSessionId: "conversation-b" }).prepared._opencodeSession;
    const toolClaude = prepare(executor, { providerSessionId: "same", clientTool: "claude" }).prepared._opencodeSession;
    const toolCodex = prepare(executor, { providerSessionId: "same", clientTool: "codex" }).prepared._opencodeSession;

    expect(convA).not.toBe(convB);
    expect(toolClaude).not.toBe(toolCodex);
  });

  it("adds the valid session header to fetch requests", async () => {
    const executor = await getExecutor("opencode");
    const credentials = makeCredentials();
    const result = await executor.execute({
      model: "muse-spark-1.3-contributor-free",
      body: { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] },
      stream: false,
      credentials,
      providerSessionId: "conversation-fetch-test",
      clientTool: "claude",
    });

    expect(result.headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(fetchMock.mock.calls[0][1].headers["Authorization"]).toBe("Bearer public");
    expect(credentials).not.toHaveProperty("_opencodeSession");
  });

  it("falls back to a valid generated session in buildHeaders when called standalone", async () => {
    const executor = await getExecutor("opencode");
    const headers = executor.buildHeaders({});

    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(headers["Authorization"]).toBe("Bearer public");
  });
  it("handles null or undefined body gracefully in transformRequest", async () => {
    const executor = await getExecutor("opencode");
    expect(() => executor.transformRequest("muse-spark-1.3-contributor-free", null, false, {})).not.toThrow();
    expect(() => executor.transformRequest("big-pickle", undefined, false, {})).not.toThrow();
  });
});

describe("OpenCode Free User-Agent Validation", () => {
  it("defaults User-Agent to opencode/latest/2.0.29/cli for non-opencode downstream clients", async () => {
    const executor = await getExecutor("opencode");
    const headersNoUa = executor.buildHeaders({});
    expect(headersNoUa["User-Agent"]).toBe("opencode/latest/2.0.29/cli");

    const headersClaude = executor.buildHeaders({ rawHeaders: { "user-agent": "Claude-Code/1.0" } });
    expect(headersClaude["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });

  it("replaces bare opencode with versioned opencode/latest/2.0.29/cli to prevent 403 FreeTierError", async () => {
    const executor = await getExecutor("opencode");
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode" } });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });

  it("upgrades outdated opencode versions (< 1.17) to prevent 426 Upgrade Required", async () => {
    const executor = await getExecutor("opencode");
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/1.15.0" } });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/cli");
  });

  it("preserves valid opencode versions (>= 1.17)", async () => {
    const executor = await getExecutor("opencode");
    const headers118 = executor.buildHeaders({
      rawHeaders: { "user-agent": "opencode/latest/2.0.29/cli ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14" },
    });
    expect(headers118["User-Agent"]).toBe("opencode/latest/2.0.29/cli ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14");

    const headersFuture = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/1.19.0" } });
    expect(headersFuture["User-Agent"]).toBe("opencode/1.19.0");
  });
});

describe("OpenCode Stable Session Reuse (429 follow-up)", () => {
  function anonymousCredentials(auth) {
    return makeCredentials({ connectionId: undefined, rawHeaders: { authorization: `Bearer ${auth}` } });
  }

  it("reuses one stable upstream session instead of minting a new one per request", async () => {
    const executor = await getExecutor("opencode");
    const body = { messages: [{ role: "user", content: "hello" }] };
    const first = executor.prepareRequestCredentials({
      body,
      credentials: anonymousCredentials("stable-key-1"),
      providerSessionId: null,
      clientTool: "claude",
    });
    const second = executor.prepareRequestCredentials({
      body,
      credentials: anonymousCredentials("stable-key-1"),
      providerSessionId: null,
      clientTool: "claude",
    });

    expect(first._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(second._opencodeSession).toBe(first._opencodeSession);
  });

  it("isolates stable sessions by downstream identity", async () => {
    const executor = await getExecutor("opencode");
    const body = { messages: [{ role: "user", content: "hello" }] };
    const forKey = (auth) => executor.prepareRequestCredentials({
      body,
      credentials: anonymousCredentials(auth),
      providerSessionId: null,
      clientTool: "claude",
    })._opencodeSession;

    expect(forKey("user-A")).not.toBe(forKey("user-B"));
    expect(forKey("user-A")).toMatch(OPENCODE_SESSION_RE);
  });

  it("exposes the stable session helper directly", () => {
    const first = stableSessionId({ connectionId: "direct-conn" });
    expect(stableSessionId({ connectionId: "direct-conn" })).toBe(first);
    expect(first).toMatch(OPENCODE_SESSION_RE);
  });

  it("keeps the standalone buildHeaders session stable across calls", async () => {
    const executor = await getExecutor("opencode");
    const first = executor.buildHeaders({})["x-opencode-session"];
    const second = executor.buildHeaders({})["x-opencode-session"];
    expect(first).toMatch(OPENCODE_SESSION_RE);
    expect(second).toBe(first);
  });

  it("does NOT inject fingerprint tools (MITM-proven plain body)", async () => {
  const executor = await getExecutor("opencode");

  const chatNoTools = executor.transformRequest("nemotron-3-ultra-free", {
    messages: [{ role: "user", content: "hi" }],
  });
  expect(chatNoTools.stream).toBe(true);
  // MITM capture: no tools injected, no tool_choice set.
  expect(chatNoTools.tool_choice).toBeUndefined();
  expect(chatNoTools.tools).toBeUndefined();

  const chatWithTools = executor.transformRequest("nemotron-3-ultra-free", {
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { type: "function", function: { name: "Shell", description: "Claude Code tool" } },
      { type: "function", function: { name: "Glob", description: "Claude Code tool" } },
      { type: "function", function: { name: "Grep", description: "Claude Code tool" } },
      { type: "function", function: { name: "Read", description: "Claude Code tool" } },
    ],
    tool_choice: "auto",
  });
  // MITM capture: no fingerprint injection — user tools pass through unchanged.
  expect(chatWithTools.tool_choice).toBe("auto");
  expect(chatWithTools.tools.map((t) => t.name)).toEqual([
    "Shell", "Glob", "Grep", "Read",
  ]);

  const chatPartial = executor.transformRequest("nemotron-3-ultra-free", {
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { type: "function", function: { name: "bash", description: "existing" } },
      { type: "function", function: { name: "read", description: "existing" } },
    ],
  });
  // MITM capture: no fingerprint injection — user tools pass through unchanged.
  expect(chatPartial.tools.map((t) => t.name)).toEqual([
    "bash", "read",
  ]);
  expect(chatPartial.tools[0].description).toBe("existing");
});

  it("passes through user tools without fingerprint injection", async () => {
    const executor = await getExecutor("opencode");
    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free(xhigh)", {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{
        type: "function",
        name: "zcode_search",
        description: "client-provided tool",
        parameters: { type: "object", properties: {} },
      }],
      tool_choice: "auto",
      reasoning_effort: "xhigh",
    }, true, {});

    expect(transformed.stream).toBe(true);
    expect(transformed.reasoning?.effort).toBe("xhigh");
    const names = transformed.tools.map((tool) => tool.name);
    expect(names).toContain("zcode_search");
    // MITM capture: no fingerprint tools injected.
    expect(names).not.toContain("shell");
    expect(names).not.toContain("read");
  });

  it("declares forceStream on the opencode transport so chatCore serves SSE upstream", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    expect(PROVIDERS.opencode?.forceStream).toBe(true);
  });

describe("OpenCode v2 free-tier headers", () => {
  it("mirrors session across four headers, drops x-opencode-request, defaults client to cli", async () => {
    const executor = await getExecutor("opencode");
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

  it("builds /inference/v1 URLs for all model routes", async () => {
    const executor = await getExecutor("opencode");
    // MITM capture: ALL free models go to /responses.
    expect(executor.buildUrl("muse-spark-1.3-contributor-free")).toBe(
      "https://opencode.ai/inference/v1/responses"
    );
    expect(executor.buildUrl("union-alpha")).toBe(
      "https://opencode.ai/inference/v1/responses"
    );
    expect(executor.buildUrl("some-other-model")).toBe(
      "https://opencode.ai/inference/v1/responses"
    );
  });
});
});
