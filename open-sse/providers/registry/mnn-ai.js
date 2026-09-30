export default {
  id: "mnn-ai",
  priority: 50,
  alias: "mnn-ai",
  display: {
    name: "Mnn Ai",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "MA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.mnnai.ru/v1/chat/completions",
    validateUrl: "https://api.mnnai.ru/v1/models",
  },
  passthroughModels: true,
  models: [],
};

