// command-code — Command Code provider API (OmniRoute: command-code).
// NOTE: different provider from 9router's `commandcode` (CLI /alpha/generate shape);
// this one speaks the documented /provider/v1/chat/completions (OpenAI-format)
// endpoint and falls back to the CLI endpoint only on 403/404.
const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const r = (id, name, contextLength, maxOutputTokens, vision = false) => ({
  id,
  name,
  contextLength,
  maxOutputTokens,
  supportsReasoning: true,
  supportedThinkingEfforts: REASONING_EFFORTS,
  ...(vision ? { supportsVision: true } : {}),
  toolCalling: true,
});

export default {
  id: "command-code",
  alias: "cmd",
  uiAlias: "cmd",
  display: {
    name: "Command Code",
    icon: "smart_toy",
    color: "#000000",
    textIcon: "CC",
    website: "https://commandcode.ai",
    notice: {
      text: "Use your Command Code provider API key. Different provider from the legacy commandcode CLI entry.",
      apiKeyUrl: "https://commandcode.ai/studio",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.commandcode.ai",
    // Chat uses the documented /provider/v1/chat/completions (OpenAI-format)
    // endpoint — NOT the CLI-only /alpha/generate endpoint, which Command Code
    // version-gates and proxy-blocks for external callers.
    chatPath: "/provider/v1/chat/completions",
    format: "openai",
    authHeader: "Authorization",
    // Discovery targets the sibling /provider/v1/models endpoint. The discovery
    // response is a partial routing catalog; static entries omitted from it can
    // still be accepted by the gateway.
    modelsFetcher: { url: "https://api.commandcode.ai/provider/v1/models", type: "openai" },
    liveCatalogAuthoritative: false,
  },
  // Reasoning models exhaust small client budgets on thinking before emitting
  // content; default to a reasoning-safe budget.
  requestDefaults: { maxTokens: 16384 },
  // Console Go / Command Code gateways buffer entire generations — streaming needs
  // a headers-wait ceiling well above the global cap for long reasoning generations.
  fetchStartTimeoutCapMs: 600000,
  models: [
    r("claude-opus-4-7", "Claude Opus 4.7 (CC)", 200000, 32000, true),
    r("claude-opus-4-6", "Claude Opus 4.6 (CC)", 200000, 32000, true),
    r("claude-sonnet-4-6", "Claude Sonnet 4.6 (CC)", 200000, 16384, true),
    r("claude-haiku-4-5-20251001", "Claude Haiku 4.5 (CC)", 200000, 8192, true),
    r("gpt-5.5", "GPT-5.5 (CC)", 256000, 128000, true),
    r("gpt-5.4", "GPT-5.4 (CC)", 256000, 128000, true),
    r("gpt-5.3-codex", "GPT-5.3 Codex (CC)", 256000, 128000, true),
    r("gpt-5.4-mini", "GPT-5.4 Mini (CC)", 256000, 128000, true),
    r("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro (CC)", 1000000, 131072),
    r("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash (CC)", 1000000, 131072),
    r("moonshotai/Kimi-K2.6", "Kimi K2.6 (CC)", 262144, 65536, true),
    r("moonshotai/Kimi-K2.5", "Kimi K2.5 (CC)", 262144, 65536, true),
    r("zai-org/GLM-5.1", "GLM-5.1 (CC)", 200000, 32768),
    r("zai-org/GLM-5", "GLM-5 (CC)", 200000, 32768),
    r("MiniMaxAI/MiniMax-M2.7", "MiniMax M2.7 (CC)", 1048576, 65536),
    r("MiniMaxAI/MiniMax-M2.5", "MiniMax M2.5 (CC)", 1048576, 65536),
    r("Qwen/Qwen3.6-Max-Preview", "Qwen 3.6 Max (CC)", 1000000, 32768),
    r("Qwen/Qwen3.6-Plus", "Qwen 3.6 Plus (CC)", 1000000, 32768, true),
  ],
};
