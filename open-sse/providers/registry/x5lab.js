export default {
  id: "x5lab",
  priority: 50,
  alias: "x5lab",
  display: {
    name: "X5lab",
    icon: "smart_toy",
    color: "#C026D3",
    textIcon: "X5",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.x5lab.dev/v1/chat/completions",
    validateUrl: "https://api.x5lab.dev/v1/models",
  },
  passthroughModels: true,
  models: [],
};

