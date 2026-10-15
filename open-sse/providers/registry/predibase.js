export default {
  id: "predibase",
  priority: 120,
  alias: "predibase",
  display: {
    name: "Predibase",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "PR",
    website: "https://predibase.com",
    notice: { apiKeyUrl: "https://app.predibase.com" },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://serving.app.predibase.com/v1/chat/completions",
    validateUrl: "https://serving.app.predibase.com/v1/models",
  },
  models: [
    { id: "llama-3.3-70b", name: "llama-3.3-70b" },
  ],
};

