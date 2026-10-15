export default {
  id: "poixe-ai",
  priority: 50,
  alias: "poixe-ai",
  display: {
    name: "Poixe Ai",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "PA",
    website: "https://poixe.com",
    notice: {
      apiKeyUrl: "https://poixe.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.poixe.com/v1/chat/completions",
    validateUrl: "https://api.poixe.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

