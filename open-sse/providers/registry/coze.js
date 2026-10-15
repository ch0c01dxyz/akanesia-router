export default {
  id: "coze",
  priority: 120,
  alias: "coze",
  display: {
    name: "Coze",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "CO",
    website: "https://www.coze.com",
    notice: {
      apiKeyUrl: "https://www.coze.com/open/oauth/pats",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.coze.com/v1/chat/completions",
    validateUrl: "https://api.coze.com/v1/models",
  },
  models: [
    { id: "claude-3-7-sonnet-20250514", name: "Claude 3.7 Sonnet" },
  ],
};

