export default {
  id: "auriko",
  priority: 50,
  alias: "auriko",
  display: {
    name: "Auriko",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "AU",
    website: "https://www.auriko.ai",
    notice: {
      apiKeyUrl: "https://auriko.ai/signup",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.auriko.ai/v1/chat/completions",
    validateUrl: "https://api.auriko.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

