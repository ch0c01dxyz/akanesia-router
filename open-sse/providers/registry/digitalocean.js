export default {
  id: "digitalocean",
  priority: 50,
  alias: "digitalocean",
  display: {
    name: "Digitalocean",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "DI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.do-ai.run/v1/chat/completions",
    validateUrl: "https://inference.do-ai.run/v1/models",
  },
  passthroughModels: true,
  models: [],
};

