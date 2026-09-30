export default {
  id: "tabitoken",
  priority: 50,
  alias: "tabitoken",
  display: {
    name: "Tabitoken",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "TA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://tabitoken.com/v1/messages",
    format: "claude",
    validateUrl: "https://tabitoken.com/v1/models",
    headers: {
      "Anthropic-Version": "2023-06-01",
    },
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  passthroughModels: true,
  models: [
    {
      id: "claude-opus-5",
      name: "Claude Opus 5",
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","xhigh","max"],
    },
    { id: "claude-opus-5-thinking", name: "Claude Opus 5 (Thinking)" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4-8-thinking", name: "Claude Opus 4.8 (Thinking)" },
  ],
};

