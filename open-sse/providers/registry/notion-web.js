// notion-web — Notion AI Web via cookie-auth session (OmniRoute: notion-web).
// Reverse-engineered cookie-auth POST /api/v3/runInferenceTranscript. The
// credential is the `token_v2` cookie from app.notion.com (DevTools →
// Application → Cookies); optional `space_id` / `notion_user_id` cookie pairs
// pin the workspace, otherwise the executor resolves it via getSpaces.
// Seed catalog: offline fallback from the live AI picker; the executor can
// also discover the live catalog via getAvailableModels.
export default {
  id: "notion-web",
  alias: "nw",
  uiAlias: "nw",
  passthroughModels: true,
  display: {
    name: "Notion Web",
    icon: "description",
    color: "#000000",
    textIcon: "NW",
    website: "https://www.notion.so",
    notice: {
      text: "Paste your full notion.so / app.notion.com cookie string (must include token_v2) as the API key. Optionally add space_id=… to pin a workspace.",
      signupUrl: "https://www.notion.so",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://app.notion.com/api/v3/runInferenceTranscript",
    format: "openai",
    authHeader: "cookie",
  },
  models: [
    { id: "notion-ai", name: "Notion AI (default)" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", supportsReasoning: true },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", supportsReasoning: true },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", supportsReasoning: true },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", supportsReasoning: true },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", supportsReasoning: true },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", supportsReasoning: true },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", supportsReasoning: true },
    { id: "fable-5", name: "Claude Fable 5", supportsReasoning: true },
    { id: "opus-5", name: "Claude Opus 5", supportsReasoning: true },
    { id: "sonnet-5", name: "Claude Sonnet 5", supportsReasoning: true },
    { id: "haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "grok-4.6", name: "Grok 4.6", supportsReasoning: true },
    { id: "kimi-k3", name: "Kimi K3", supportsReasoning: true },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true },
    { id: "glm-5.2", name: "GLM 5.2", supportsReasoning: true },
  ],
};
