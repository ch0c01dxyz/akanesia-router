export default {
  id: "tokenreply",
  priority: 50,
  alias: "tokenreply",
  display: {
    name: "Tokenreply",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "TO",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.tokenreply.com/v1/chat/completions",
    validateUrl: "https://api.tokenreply.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

