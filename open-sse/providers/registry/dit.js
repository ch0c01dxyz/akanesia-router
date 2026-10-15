export default {
  id: "dit",
  priority: 50,
  alias: "dai",
  display: {
    name: "Dit",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "DI",
    website: "https://dit.ai",
    notice: {
      apiKeyUrl: "https://dit.ai/register",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.dit.ai/v1/chat/completions",
    validateUrl: "https://api.dit.ai/v1/models",
  },
  models: [
    {
      id: "gpt-5.4",
      name: "GPT-5.4 (DIT.ai)",
      contextLength: 400000,
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (DIT.ai)",
      contextLength: 200000,
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportedThinkingEfforts: ["low","medium","high","max"],
    },
  ],
};

