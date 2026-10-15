export default {
  id: "logfare",
  priority: 50,
  alias: "logfare",
  display: {
    name: "Logfare",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "LO",
    website: "https://logfare.ai",
    notice: {
      apiKeyUrl: "https://logfare.ai/register",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://logfare.ai/v1/chat/completions",
    validateUrl: "https://logfare.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

