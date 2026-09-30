export default {
  id: "freeinference",
  priority: 50,
  alias: "freeinference",
  display: {
    name: "Freeinference",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "FR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://freeinference.org/v1/chat/completions",
    validateUrl: "https://freeinference.org/v1/models",
  },
  passthroughModels: true,
  models: [],
};

