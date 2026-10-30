export default {
  id: "gisoo",
  priority: 120,
  alias: "gisoo",
  display: {
    name: "Gisoo",
    color: "#6366F1",
    textIcon: "GI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://gisoo.pro/api/v1/chat/completions",
    // /v1/models is public (no key), so as a validator it only proves
    // reachability — it cannot tell a bad key from a good one. No billing
    // URL exists in the source to use instead, and none was invented.
    validateUrl: "https://gisoo.pro/api/v1/models",
  },
  // Seed verified 2026-10-25 in the OmniRoute source against the public
  // /v1/models endpoint (all type "chat"); kept small on purpose.
  models: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-flash", name: "DeepSeek Flash" },
  ],
  modelsFetcher: { url: "https://gisoo.pro/api/v1/models", type: "openai" },
  passthroughModels: true,
};
