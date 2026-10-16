export default {
  id: "typhoon",
  priority: 50,
  alias: "typhoon",
  display: {
    name: "Typhoon",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "TY",
    website: "https://opentyphoon.ai",
    notice: {
      apiKeyUrl: "https://playground.opentyphoon.ai/api-key",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.opentyphoon.ai/v1/chat/completions",
    validateUrl: "https://api.opentyphoon.ai/v1/models",
  },
  models: [
    {
      id: "typhoon-v2.5-30b-a3b-instruct",
      name: "Typhoon v2.5 30B A3B Instruct",
      contextLength: 131072,
    },
  ],
};

