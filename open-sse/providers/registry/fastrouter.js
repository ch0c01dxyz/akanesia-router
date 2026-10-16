export default {
  id: "fastrouter",
  priority: 50,
  alias: "fastrouter",
  display: {
    name: "Fastrouter",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "FA",
    website: "https://fastrouter.ai",
    notice: {
      apiKeyUrl: "https://fastrouter.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.fastrouter.ai/api/v1/chat/completions",
    validateUrl: "https://api.fastrouter.ai/api/v1/models",
  },
  passthroughModels: true,
  models: [],
};

