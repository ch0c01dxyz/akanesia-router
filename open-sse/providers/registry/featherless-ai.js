export default {
  id: "featherless-ai",
  priority: 50,
  // No alias: "featherless" belongs to the featherless provider (id == alias).
  // A duplicate alias here overwrote its PROVIDER_MODELS entry and broke
  // alias→id resolution order-dependently.
  display: {
    name: "Featherless Ai",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "FA",
    website: "https://featherless.ai",
    notice: {
      apiKeyUrl: "https://featherless.ai/account/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.featherless.ai/v1/chat/completions",
    validateUrl: "https://api.featherless.ai/v1/models",
  },
  models: [
    { id: "featherless-ai/Qwerky-72B", name: "featherless-ai/Qwerky-72B" },
    { id: "featherless-ai/Qwerky-QwQ-32B", name: "featherless-ai/Qwerky-QwQ-32B" },
  ],
};

