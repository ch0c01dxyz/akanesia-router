export default {
  id: "kenari",
  priority: 50,
  alias: "kenari",
  display: {
    name: "Kenari",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "KE",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://kenari.id/v1/chat/completions",
    validateUrl: "https://kenari.id/v1/models",
  },
  passthroughModels: true,
  models: [],
};

