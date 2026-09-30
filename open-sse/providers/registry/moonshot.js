// moonshot — Moonshot/Kimi OpenAI-compatible API (OmniRoute: moonshot).
// Kimi models need sampling-param/thinking normalization (see executors/moonshot.js).
export default {
  id: "moonshot",
  priority: 20,
  alias: "moonshot",
  uiAlias: "moonshot",
  display: {
    name: "Moonshot",
    icon: "dark_mode",
    color: "#8B5CF6",
    textIcon: "KM",
    website: "https://moonshot.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrls: ["https://api.moonshot.ai/v1/chat/completions"],
    format: "openai",
    authHeader: "bearer",
  },
  models: [
    { id: "kimi-k3", name: "Kimi K3", contextLength: 1048576, maxOutputTokens: 1048576, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", contextLength: 262144, maxOutputTokens: 262144, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code (High Speed)", contextLength: 262144, maxOutputTokens: 262144, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "kimi-k2.6", name: "Kimi K2.6", contextLength: 262144, maxOutputTokens: 262144, supportsReasoning: true, supportsVision: true, toolCalling: true },
  ],
};
