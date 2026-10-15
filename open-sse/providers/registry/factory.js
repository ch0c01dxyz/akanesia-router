export default {
  id: "factory",
  priority: 50,
  alias: "factory",
  display: {
    name: "Factory",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "FA",
    website: "https://factory.ai",
    notice: { apiKeyUrl: "https://docs.factory.ai" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.factory.ai/v1/chat/completions",
    validateUrl: "https://api.factory.ai/v1/models",
  },
  models: [
    { id: "auto", name: "Factory Auto (best model)" },
  ],
};

