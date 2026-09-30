export default {
  id: "helyxai",
  priority: 50,
  alias: "helyxai",
  display: {
    name: "Helyxai",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "HE",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://helyxai.space/v1/chat/completions",
    validateUrl: "https://helyxai.space/v1/models",
  },
  passthroughModels: true,
  models: [],
};

