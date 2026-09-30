export default {
  id: "opper",
  priority: 50,
  alias: "opper",
  display: {
    name: "Opper",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "OP",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.opper.ai/v3/compat/chat/completions",
    validateUrl: "https://api.opper.ai/v3/compat/models",
  },
  passthroughModels: true,
  models: [],
};

