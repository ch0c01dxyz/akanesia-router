export default {
  id: "greenpt",
  priority: 50,
  alias: "greenpt",
  display: {
    name: "Greenpt",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "GR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.greenpt.ai/v1/chat/completions",
    validateUrl: "https://api.greenpt.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

