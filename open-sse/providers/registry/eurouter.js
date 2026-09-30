export default {
  id: "eurouter",
  priority: 50,
  alias: "eurouter",
  display: {
    name: "Eurouter",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "EU",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.eurouter.ai/v1/chat/completions",
    validateUrl: "https://api.eurouter.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

