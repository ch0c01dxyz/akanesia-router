export default {
  id: "naga-ai",
  priority: 50,
  alias: "naga-ai",
  display: {
    name: "Naga Ai",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "NA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.naga.ac/v1/chat/completions",
    validateUrl: "https://api.naga.ac/v1/models",
  },
  passthroughModels: true,
  models: [],
};

