export default {
  id: "ainetcafe",
  priority: 120,
  alias: "ainetcafe",
  display: {
    name: "Ainetcafe",
    color: "#6366F1",
    textIcon: "AI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // NOTE: the host is "microquickjs.com", not "ainetcafe.com".
    // That is verbatim from the source — do not "fix" it.
    baseUrl: "https://microquickjs.com/v1/chat/completions",
    validateUrl: "https://microquickjs.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://microquickjs.com/v1/models", type: "openai" },
  passthroughModels: true,
};
