export default {
  id: "sumopod",
  priority: 50,
  alias: "sumopod",
  display: {
    name: "Sumopod",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "SU",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://ai.sumopod.com/v1/chat/completions",
    validateUrl: "https://ai.sumopod.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

