// codex-app-server — OpenAI Codex driven through the Codex CLI's own
// `codex app-server` over JSON-RPC/WebSocket (OmniRoute: codex-app-server).
// Sibling of the `codex` provider (direct OAuth to the Responses API).
// The app-server process OWNS and self-refreshes its OpenAI auth
// (~/.codex/auth.json), exactly like an interactive `codex` session — 9router
// never receives or replays a token, so there is no OAuth block: authType "none".
// The connection target (ws:// URL + capability token) is supplied per-connection
// via providerSpecificData (codexAppServerUrl / codexAppServerToken[File]) and
// resolved by the executor — NOT from `baseUrl` below, which is a documentation
// sentinel only. Models are shared with the `codex` provider (same underlying
// ChatGPT Codex backend); the capability blocks below mirror the source
// GPT_5_6_CODEX_CAPABILITIES / GPT_5_5_CODEX_CAPABILITIES so the two stay in lockstep.

// Mirrors OmniRoute's GPT_5_6_CODEX_CAPABILITIES.
const R56 = {
  targetFormat: "openai-responses",
  toolCalling: true,
  supportsReasoning: true,
  supportsVision: true,
  contextLength: 872000,
  maxInputTokens: 872000,
  maxOutputTokens: 128000,
};
// Mirrors OmniRoute's GPT_5_5_CODEX_CAPABILITIES.
const R55 = {
  targetFormat: "openai-responses",
  toolCalling: true,
  supportsReasoning: true,
  supportsVision: true,
  contextLength: 1050000,
};
// gpt-5.5 codex OAuth backend caps context at 400K (not the public-API 1.05M).
const R55_OAUTH = { ...R55, contextLength: 400000, maxInputTokens: 272000, maxOutputTokens: 128000 };
// #6354: reasoning-heavy tier — more header-wait room than the global default.
const LONG_TIMEOUT = 1200000;

const m = (id, name, caps, extra = {}) => ({ id, name, ...caps, ...extra });

export default {
  id: "codex-app-server",
  alias: "cxa",
  uiAlias: "cxa",
  display: {
    name: "Codex App Server",
    icon: "code",
    color: "#3B82F6",
    textIcon: "CXA",
    website: "https://chatgpt.com/codex",
    notice: {
      text: "Drives a local `codex app-server` over WebSocket. Set codexAppServerUrl + codexAppServerToken (or ...TokenFile) in providerSpecificData, or the OMNIROUTE_CODEX_APPSERVER_WS* env vars.",
    },
  },
  category: "free",
  noAuth: true,
  authType: "none",
  authModes: [],
  transport: {
    // Sentinel: the executor dials the WebSocket app-server URL from
    // providerSpecificData, not this baseUrl. Kept for catalog/debug display.
    baseUrl: "codex-app-server://cli/websocket",
    format: "openai-responses",
    authHeader: "none",
    reasoningTransport: "opaque",
  },
  models: [
    m("gpt-6-astra", "GPT 6 Astra", R56),
    m("gpt-6-astra-ultra", "GPT 6 Astra (Ultra)", R56),
    m("gpt-6-astra-max", "GPT 6 Astra (Max)", R56),
    m("gpt-6-astra-xhigh", "GPT 6 Astra (xHigh)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-6-astra-high", "GPT 6 Astra (High)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-6-astra-medium", "GPT 6 Astra (Medium)", R56),
    m("gpt-6-astra-low", "GPT 6 Astra (Low)", R56),
    m("gpt-6-sol", "GPT 6 Sol", R56),
    m("gpt-6-sol-ultra", "GPT 6 Sol (Ultra)", R56),
    m("gpt-6-sol-max", "GPT 6 Sol (Max)", R56),
    m("gpt-6-sol-xhigh", "GPT 6 Sol (xHigh)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-6-sol-high", "GPT 6 Sol (High)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-6-sol-medium", "GPT 6 Sol (Medium)", R56),
    m("gpt-6-sol-low", "GPT 6 Sol (Low)", R56),
    m("gpt-6-luna", "GPT 6 Luna", R56),
    m("gpt-6-luna-max", "GPT 6 Luna (Max)", R56),
    m("gpt-6-luna-xhigh", "GPT 6 Luna (xHigh)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-6-luna-high", "GPT 6 Luna (High)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-6-luna-medium", "GPT 6 Luna (Medium)", R56),
    m("gpt-6-luna-low", "GPT 6 Luna (Low)", R56),
    m("gpt-5.6-sol", "GPT 5.6 Sol", R56),
    m("gpt-5.6-sol-ultra", "GPT 5.6 Sol (Ultra)", R56),
    m("gpt-5.6-sol-max", "GPT 5.6 Sol (Max)", R56),
    m("gpt-5.6-sol-xhigh", "GPT 5.6 Sol (xHigh)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.6-sol-high", "GPT 5.6 Sol (High)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.6-sol-medium", "GPT 5.6 Sol (Medium)", R56),
    m("gpt-5.6-sol-low", "GPT 5.6 Sol (Low)", R56),
    m("gpt-5.6-terra", "GPT 5.6 Terra", R56),
    m("gpt-5.6-terra-ultra", "GPT 5.6 Terra (Ultra)", R56),
    m("gpt-5.6-terra-max", "GPT 5.6 Terra (Max)", R56),
    m("gpt-5.6-terra-xhigh", "GPT 5.6 Terra (xHigh)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.6-terra-high", "GPT 5.6 Terra (High)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.6-terra-medium", "GPT 5.6 Terra (Medium)", R56),
    m("gpt-5.6-terra-low", "GPT 5.6 Terra (Low)", R56),
    m("gpt-5.6-luna", "GPT 5.6 Luna", R56),
    m("gpt-5.6-luna-max", "GPT 5.6 Luna (Max)", R56),
    m("gpt-5.6-luna-xhigh", "GPT 5.6 Luna (xHigh)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.6-luna-high", "GPT 5.6 Luna (High)", R56, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.6-luna-medium", "GPT 5.6 Luna (Medium)", R56),
    m("gpt-5.6-luna-low", "GPT 5.6 Luna (Low)", R56),
    m("gpt-5.5", "GPT 5.5", R55_OAUTH),
    m("gpt-5.5-xhigh", "GPT 5.5 (xHigh)", R55_OAUTH, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.5-high", "GPT 5.5 (High)", R55_OAUTH, { timeoutMs: LONG_TIMEOUT }),
    m("gpt-5.5-medium", "GPT 5.5 (Medium)", R55_OAUTH),
    m("gpt-5.5-low", "GPT 5.5 (Low)", R55_OAUTH),
    m("gpt-5.3-codex-spark", "GPT 5.3 Codex Spark", {}),
  ],
};
