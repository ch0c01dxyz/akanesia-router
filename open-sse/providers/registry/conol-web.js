// conol-web — conol.ai browser-session chat (OmniRoute: conol-web).
// Session-based protocol: POST /api/sessions to create, POST /model to pin
// preset/model/effort, POST /messages to submit, GET /messages?logDeltas=1
// for the cumulative NDJSON answer stream. Cookie authentication via
// __Secure-better-auth.session_token.
export default {
  id: "conol-web",
  alias: "cnl",
  uiAlias: "cnl",
  display: {
    name: "Conol Web",
    icon: "chat",
    color: "#6366F1",
    textIcon: "CN",
    website: "https://conol.ai",
    notice: {
      text: "Paste your full conol.ai cookie string (must include __Secure-better-auth.session_token) as the API key.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://conol.ai/api/sessions",
    format: "openai",
    authHeader: "cookie",
  },
  passthroughModels: true,
  models: [
    { id: "claude-opus-5", name: "Claude Opus 5", supportsVision: true, efforts: ["low", "medium", "high", "xhigh"] },
    { id: "claude-opus-4-8", name: "Claude Opus 4 8", supportsVision: true, efforts: ["low", "medium", "high", "xhigh"] },
    { id: "claude-fable-5", name: "Claude Fable 5", supportsVision: true, efforts: ["low", "medium", "high", "xhigh"] },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", supportsVision: true, efforts: ["low", "medium", "high"] },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4 6", supportsVision: true, efforts: ["low", "medium", "high"] },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4 5", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "gpt-5.5", name: "GPT 5.5", supportsVision: true, efforts: ["low", "medium", "high", "xhigh"] },
    { id: "gpt-5.5-pro", name: "GPT 5.5 Pro", supportsVision: true, efforts: ["medium", "high", "xhigh"] },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol", supportsVision: true, efforts: ["low", "medium", "high", "xhigh"] },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra", supportsVision: true, efforts: ["low", "medium", "high", "xhigh"] },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", supportsVision: true, efforts: ["low", "medium", "high", "xhigh"] },
    { id: "deepseek/deepseek-v4-pro", name: "Deepseek V4 Pro", supportsVision: false, efforts: ["high", "xhigh"] },
    { id: "openrouter/fusion", name: "Fusion", supportsVision: false, efforts: [] },
    { id: "z-ai/glm-5.2", name: "GLM 5.2", supportsVision: false, efforts: ["minimal", "low", "medium", "high"] },
    { id: "tencent/hy3", name: "Hy3", supportsVision: false, efforts: ["minimal", "low", "medium", "high"] },
    { id: "moonshotai/kimi-k3", name: "Kimi K3", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "qwen/qwen3.7-plus", name: "Qwen3.7 Plus", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "qwen/qwen3.7-max", name: "Qwen3.7 Max", supportsVision: false, efforts: ["minimal", "low", "medium", "high"] },
    { id: "minimax/minimax-m3", name: "Minimax M3", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "stepfun/step-3.7-flash", name: "Step 3.7 Flash", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "x-ai/grok-4.3", name: "Grok 4.3", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "deepseek/deepseek-v4-flash", name: "Deepseek V4 Flash", supportsVision: false, efforts: ["high", "xhigh"] },
    { id: "xiaomi/mimo-v2.5", name: "Mimo V2.5", supportsVision: true, efforts: ["minimal", "low", "medium", "high"] },
    { id: "xiaomi/mimo-v2.5-pro", name: "Mimo V2.5 Pro", supportsVision: false, efforts: ["minimal", "low", "medium", "high"] },
  ],
};
