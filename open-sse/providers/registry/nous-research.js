export default {
  id: "nous-research",
  priority: 120,
  alias: "nous",
  display: {
    name: "Nous Research",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "NR",
    website: "https://nousresearch.com",
    notice: {
      apiKeyUrl: "https://portal.nousresearch.com",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    validateUrl: "https://inference-api.nousresearch.com/v1/models",
  },
  models: [
    { id: "Hermes-4-405B", name: "Hermes 4 405B (Nous Research)" },
    { id: "Hermes-4-70B", name: "Hermes 4 70B (Nous Research)" },
  ],
};

