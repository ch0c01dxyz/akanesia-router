export default {
  id: "zylo-api",
  priority: 50,
  alias: "zylo",
  display: {
    name: "Zylo Api",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "ZA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.zyloai.net/v1/chat/completions",
    validateUrl: "https://api.zyloai.net/v1/models",
  },
  passthroughModels: true,
  models: [],
};

