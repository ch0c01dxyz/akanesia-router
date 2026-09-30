export default {
  id: "poe",
  priority: 50,
  alias: "poe",
  display: {
    name: "Poe",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "PO",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.poe.com/v1/chat/completions",
    validateUrl: "https://api.poe.com/v1/models",
  },
  models: [
    { id: "gpt-5.2", name: "GPT-5.2" },
    {
      id: "claude-opus-4.8",
      name: "Claude Opus 4.8",
      targetFormat: "claude",
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","xhigh","max"],
    },
    { id: "gemini-3.0-pro", name: "Gemini 3.0 Pro" },
  ],
};

