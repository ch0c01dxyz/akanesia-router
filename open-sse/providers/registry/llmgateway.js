export default {
  id: "llmgateway",
  priority: 50,
  alias: "llmgateway",
  display: {
    name: "Llmgateway",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "LL",
    website: "https://llmgateway.io",
    notice: {
      apiKeyUrl: "https://docs.llmgateway.io/quick-start",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.llmgateway.io/v1/chat/completions",
    validateUrl: "https://api.llmgateway.io/v1/models",
  },
  passthroughModels: true,
  models: [],
};

