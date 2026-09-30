export default {
  id: "unorouter",
  priority: 50,
  alias: "unorouter",
  display: {
    name: "Unorouter",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "UN",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.unorouter.com/v1/chat/completions",
    validateUrl: "https://api.unorouter.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

