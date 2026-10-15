export default {
  id: "chatanywhere",
  priority: 50,
  alias: "chatanywhere",
  display: {
    name: "Chatanywhere",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "CH",
    website: "https://github.com/chatanywhere/GPT_API_free",
    notice: {
      apiKeyUrl: "https://api.chatanywhere.org/v1/oauth/free/render",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.chatanywhere.org/v1/chat/completions",
    validateUrl: "https://api.chatanywhere.org/v1/models",
  },
  passthroughModels: true,
  models: [],
};

