export default {
  id: "zerolimitai",
  priority: 50,
  alias: "zerolimitai",
  display: {
    name: "Zerolimitai",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "ZE",
    website: "https://www.zerolimitai.com",
    notice: {
      apiKeyUrl: "https://www.zerolimitai.com/developers",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://www.zerolimitai.com/api/v1/chat/completions",
    validateUrl: "https://www.zerolimitai.com/api/v1/models",
  },
  passthroughModels: true,
  models: [],
};

