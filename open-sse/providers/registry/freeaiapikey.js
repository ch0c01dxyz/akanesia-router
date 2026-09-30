export default {
  id: "freeaiapikey",
  priority: 50,
  alias: "faik",
  display: {
    name: "Freeaiapikey",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "FR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.freeaiapikey.com/v1/chat/completions",
    validateUrl: "https://api.freeaiapikey.com/v1/models",
  },
  models: [
    { id: "openai/gpt-4o", name: "GPT-4o (via FreeAIAPIKey)" },
    { id: "openai/gpt-5.4", name: "GPT-5.4 (via FreeAIAPIKey)" },
    { id: "openai/gpt-5.5", name: "GPT-5.5 (via FreeAIAPIKey)" },
    { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol (via FreeAIAPIKey)" },
    {
      id: "anthropic/claude-opus-4.6",
      name: "Claude Opus 4.6 (via FreeAIAPIKey)",
      contextLength: 1000000,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","max"],
    },
    { id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7 (via FreeAIAPIKey)" },
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8 (via FreeAIAPIKey)" },
    { id: "anthropic/claude-opus-5", name: "Claude Opus 5 (via FreeAIAPIKey)" },
    {
      id: "anthropic/claude-sonnet-4.6",
      name: "Claude Sonnet 4.6 (via FreeAIAPIKey)",
      contextLength: 1000000,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","max"],
    },
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5 (via FreeAIAPIKey)" },
  ],
};

