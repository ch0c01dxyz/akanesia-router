export default {
  id: "nimble-search",
  alias: "nimble",
  display: {
    name: "Nimble",
    icon: "manage_search",
    color: "#8B5CF6",
    textIcon: "NB",
    website: "https://nimbleway.com",
    notice: {
      apiKeyUrl: "https://nimbleway.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch",
    "webFetch"
  ],
  searchConfig: {
    baseUrl: "https://sdk.nimbleway.com/v1/search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    searchTypes: [
      "web",
      "news"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 10000,
    cacheTTLMs: 300000
  },
  fetchConfig: {
    baseUrl: "https://sdk.nimbleway.com/v1/extract",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    formats: [
      "markdown",
      "html"
    ],
    timeoutMs: 30000
  }
};
