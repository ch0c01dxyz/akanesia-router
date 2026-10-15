export default {
  id: "ai21",
  priority: 120,
  alias: "ai21",
  display: {
    name: "Ai21",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "AI",
    website: "https://www.ai21.com",
    notice: { apiKeyUrl: "https://studio.ai21.com/account/api-key" },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    validateUrl: "https://api.ai21.com/studio/v1/models",
  },
  models: [
    { id: "jamba-large-1.7", name: "jamba-large-1.7" },
    { id: "jamba-mini-2", name: "jamba-mini-2" },
  ],
};

