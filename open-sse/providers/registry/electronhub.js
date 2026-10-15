export default {
  id: "electronhub",
  priority: 50,
  alias: "electronhub",
  display: {
    name: "Electronhub",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "EL",
    website: "https://electronhub.ai",
    notice: {
      apiKeyUrl: "https://playground.electronhub.ai/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.electronhub.ai/v1/chat/completions",
    validateUrl: "https://api.electronhub.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

