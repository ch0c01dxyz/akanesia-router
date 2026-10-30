export default {
  id: "unifically",
  priority: 120,
  alias: "unifically",
  display: {
    name: "Unifically",
    color: "#6366F1",
    textIcon: "UN",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.unifically.com/v1/chat/completions",
    // ?category=llm narrows /v1/models to chat models — carried verbatim.
    validateUrl: "https://api.unifically.com/v1/models?category=llm",
  },
  models: [],
  modelsFetcher: { url: "https://api.unifically.com/v1/models?category=llm", type: "openai" },
  passthroughModels: true,
};
