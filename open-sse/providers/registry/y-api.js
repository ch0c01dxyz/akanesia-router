export default {
  id: "y-api",
  priority: 120,
  alias: "y-api",
  display: {
    name: "Y-API",
    color: "#6366F1",
    textIcon: "YA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.y-api.bestvirtualgoods.com/v1/chat/completions",
    validateUrl: "https://api.y-api.bestvirtualgoods.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.y-api.bestvirtualgoods.com/v1/models", type: "openai" },
  passthroughModels: true,
};
