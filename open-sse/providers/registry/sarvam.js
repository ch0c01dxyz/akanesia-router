export default {
  id: "sarvam",
  priority: 50,
  alias: "sarvam",
  display: {
    name: "Sarvam",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "SA",
    website: "https://www.sarvam.ai",
    notice: {
      apiKeyUrl: "https://dashboard.sarvam.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.sarvam.ai/v1/chat/completions",
    validateUrl: "https://api.sarvam.ai/v1/models",
  },
  models: [
    {
      id: "sarvam-105b",
      name: "Sarvam 105B",
      contextLength: 131072,
    },
    {
      id: "sarvam-30b",
      name: "Sarvam 30B",
      contextLength: 65536,
    },
  ],
};

