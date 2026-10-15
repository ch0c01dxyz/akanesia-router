export default {
  id: "speka",
  priority: 50,
  alias: "speka",
  display: {
    name: "Speka",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "SP",
    website: "https://speka.me",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://speka.me/v1/chat/completions",
    validateUrl: "https://speka.me/v1/models",
  },
  passthroughModels: true,
  models: [],
};

