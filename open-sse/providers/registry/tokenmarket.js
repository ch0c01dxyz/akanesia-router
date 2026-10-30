export default {
  id: "tokenmarket",
  priority: 120,
  alias: "tokenmarket",
  display: {
    name: "Token Market",
    color: "#6366F1",
    textIcon: "TM",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // NOTE: the id is "tokenmarket" but the domain is "tokensmarket.ai"
    // (with an 's'). That is verbatim from the source — do not "fix" it.
    baseUrl: "https://api.tokensmarket.ai/v1/chat/completions",
    validateUrl: "https://api.tokensmarket.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.tokensmarket.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
