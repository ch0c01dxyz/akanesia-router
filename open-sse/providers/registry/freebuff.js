// freebuff — codebuff.com freebuff gateway (OmniRoute: freebuff).
// Session + agent-run flow handled by executors/freebuff.js.
export default {
  id: "freebuff",
  priority: 20,
  alias: "fb",
  uiAlias: "fb",
  display: {
    name: "Freebuff",
    icon: "savings",
    color: "#10B981",
    textIcon: "FB",
    website: "https://www.codebuff.com",
  },
  category: "free",
  authType: "apikey",
  transport: {
    baseUrls: ["https://www.codebuff.com/api/v1"],
    format: "openai",
    authHeader: "bearer",
  },
  models: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 131072, supportsReasoning: true },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 131072, supportsReasoning: true },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", contextLength: 131072, supportsReasoning: true },
    { id: "minimax/minimax-m3", name: "MiniMax M3", contextLength: 131072, supportsReasoning: true, supportsVision: true },
    { id: "mimo/mimo-v2.5", name: "MiMo v2.5", contextLength: 131072, supportsReasoning: true },
    { id: "z-ai/glm-5.2", name: "GLM 5.2", contextLength: 131072, supportsReasoning: true },
    { id: "crof/kimi-k3-eco", name: "Kimi K3 Eco", contextLength: 131072, supportsReasoning: true, supportsVision: true },
    { id: "anthropic/claude-fable-5", name: "Claude Fable 5", contextLength: 131072, supportsReasoning: true, supportsVision: true },
    { id: "meta/muse-spark-1.2-contributor", name: "Meta Muse Spark 1.2 Contributor", contextLength: 131072, supportsReasoning: true },
  ],
};
