export default {
  id: "lyceum",
  priority: 50,
  alias: "lyceum",
  display: {
    name: "Lyceum",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "LY",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.lyceum.technology/openai/v1/chat/completions",
    validateUrl: "https://api.lyceum.technology/openai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

