// zenmux-free — ZenMux free-tier gateway via browser session cookies (OmniRoute: zenmux-free).
// POSTs to the Anthropic-compatible SSE endpoint; response translated to OpenAI chunks.
export default {
  id: "zenmux-free",
  priority: 20,
  alias: "zmf",
  uiAlias: "zmf",
  display: {
    name: "ZenMux Free",
    icon: "savings",
    color: "#14B8A6",
    textIcon: "ZM",
    website: "https://zenmux.ai",
    notice: {
      text: "Paste your full zenmux.ai cookie string (must include ctoken) as the API key.",
    },
  },
  category: "free",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrls: ["https://zenmux.ai/api/anthropic/v1/messages"],
    format: "openai",
    authHeader: "cookie",
  },
  models: [
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3.2 (Non-thinking)" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek V3.2 (Thinking)", supportsReasoning: true },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true },
    { id: "kuaishou/kat-coder-pro-v1-free", name: "KAT Coder Pro V1 Free" },
    { id: "z-ai/glm-4.7-flash-free", name: "GLM 4.7 Flash Free" },
    { id: "stepfun/step-3.5-flash-free", name: "Step 3.5 Flash Free" },
    { id: "inclusionai/ling-1t", name: "Ling 1T" },
    { id: "inclusionai/ling-mini-2.0", name: "Ling Mini 2.0" },
    { id: "inclusionai/ring-1t", name: "Ring 1T" },
    { id: "sapiens-ai/agnes-1.5-lite", name: "Agnes 1.5 Lite" },
    { id: "sapiens-ai/agnes-1.5-pro", name: "Agnes 1.5 Pro" },
  ],
};
