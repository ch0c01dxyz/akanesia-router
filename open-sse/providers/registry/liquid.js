export default {
  id: "liquid",
  priority: 120,
  alias: "liquid",
  display: {
    name: "Liquid",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "LI",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.liquid.ai/v1/chat/completions",
    validateUrl: "https://inference.liquid.ai/v1/models",
  },
  models: [
    { id: "liquid-lfm-40b", name: "Liquid LFM 40B" },
  ],
};

