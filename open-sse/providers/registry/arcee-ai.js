export default {
  id: "arcee-ai",
  priority: 120,
  alias: "arcee",
  display: {
    name: "Arcee Ai",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "AA",
    website: "https://arcee.ai",
    notice: {
      apiKeyUrl: "https://platform.arcee.ai/api/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.arcee.ai/api/v1/chat/completions",
    validateUrl: "https://api.arcee.ai/api/v1/models",
  },
  passthroughModels: true,
  models: [],
};

