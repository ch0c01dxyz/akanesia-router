export default {
  id: "plamo",
  priority: 50,
  alias: "plamo",
  display: {
    name: "Plamo",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "PL",
    website: "https://plamo.preferredai.jp",
    notice: { apiKeyUrl: "https://plamo.preferredai.jp" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.platform.preferredai.jp/v1/chat/completions",
    validateUrl: "https://api.platform.preferredai.jp/v1/models",
  },
  models: [
    {
      id: "plamo-3.0-prime",
      name: "PLaMo 3.0 Prime",
      contextLength: 262144,
      maxOutputTokens: 20000,
    },
  ],
};

