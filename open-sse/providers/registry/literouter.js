export default {
  id: "literouter",
  priority: 50,
  alias: "literouter",
  display: {
    name: "Literouter",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "LI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.literouter.com/v1/chat/completions",
    validateUrl: "https://api.literouter.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

