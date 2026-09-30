export default {
  id: "chenzk",
  priority: 50,
  alias: "chenzk",
  display: {
    name: "Chenzk",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "CH",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://chenzk.top/v1/chat/completions",
    validateUrl: "https://chenzk.top/v1/models",
  },
  passthroughModels: true,
  models: [],
};

