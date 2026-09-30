export default {
  id: "void-ai",
  priority: 50,
  alias: "void-ai",
  display: {
    name: "Void Ai",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "VA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.voidai.app/v1/chat/completions",
    validateUrl: "https://api.voidai.app/v1/models",
  },
  passthroughModels: true,
  models: [],
};

