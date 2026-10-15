export default {
  id: "free-ai",
  priority: 50,
  alias: "free-ai",
  display: {
    name: "Free Ai",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "FA",
    website: "https://free.ai",
    notice: {
      apiKeyUrl: "https://free.ai/api/",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.free.ai/v1/chat/",
    validateUrl: "https://api.free.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

