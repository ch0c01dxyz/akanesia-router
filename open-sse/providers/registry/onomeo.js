export default {
  id: "onomeo",
  priority: 120,
  alias: "onomeo",
  display: {
    name: "Onomeo",
    color: "#6366F1",
    textIcon: "ON",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://onomeo.com/v1/chat/completions",
    validateUrl: "https://onomeo.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://onomeo.com/v1/models", type: "openai" },
  passthroughModels: true,
};
