export default {
  id: "helixmind",
  priority: 50,
  alias: "helixmind",
  display: {
    name: "Helixmind",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "HE",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://helixmind.online/v1/chat/completions",
    validateUrl: "https://helixmind.online/v1/models",
  },
  passthroughModels: true,
  models: [],
};

