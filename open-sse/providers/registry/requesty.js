export default {
  id: "requesty",
  priority: 120,
  alias: "requesty",
  display: {
    name: "Requesty",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "RE",
    website: "https://www.requesty.ai",
    notice: {
      apiKeyUrl: "https://app.requesty.ai/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://router.requesty.ai/v1/chat/completions",
    validateUrl: "https://router.requesty.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

