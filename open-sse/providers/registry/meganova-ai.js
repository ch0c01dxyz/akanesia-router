export default {
  id: "meganova-ai",
  priority: 50,
  alias: "meganova-ai",
  display: {
    name: "Meganova Ai",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "MA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.meganova.ai/v1/chat/completions",
    validateUrl: "https://api.meganova.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

