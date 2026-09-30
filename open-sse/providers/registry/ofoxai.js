export default {
  id: "ofoxai",
  priority: 50,
  alias: "ofoxai",
  display: {
    name: "Ofoxai",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "OF",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ofox.ai/v1/chat/completions",
    validateUrl: "https://api.ofox.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

