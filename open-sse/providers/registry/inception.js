export default {
  id: "inception",
  priority: 50,
  alias: "inception",
  display: {
    name: "Inception",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "IN",
    website: "https://www.inceptionlabs.ai",
    notice: { apiKeyUrl: "https://platform.inceptionlabs.ai" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.inceptionlabs.ai/v1/models",
  },
  models: [
    {
      id: "mercury-2",
      name: "Mercury 2",
      contextLength: 128000,
      maxOutputTokens: 50000,
    },
  ],
};

