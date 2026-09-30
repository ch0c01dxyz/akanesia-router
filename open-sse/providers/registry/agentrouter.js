export default {
  id: "agentrouter",
  priority: 120,
  alias: "agentrouter",
  display: {
    name: "Agentrouter",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "AG",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  passthroughModels: true,
  models: [
    {
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","xhigh","max"],
    },
    {
      id: "claude-opus-5",
      name: "Claude Opus 5",
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","xhigh","max"],
    },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  ],
};

