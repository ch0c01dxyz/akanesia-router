export default {
  id: "beatapi",
  priority: 120,
  alias: "beatapi",
  display: {
    name: "Beatapi",
    color: "#6366F1",
    textIcon: "BE",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.beatapi.io/v1/chat/completions",
    validateUrl: "https://api.beatapi.io/v1/models",
    // DefaultExecutor does not route via responsesBaseUrl (see apmix.js).
    // Kept verbatim from the OmniRoute source for future executors.
    responsesBaseUrl: "https://api.beatapi.io/v1/responses",
  },
  models: [],
  modelsFetcher: { url: "https://api.beatapi.io/v1/models", type: "openai" },
  passthroughModels: true,
};
