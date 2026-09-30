export default {
  id: "chat-oripe",
  priority: 50,
  alias: "chat-oripe",
  display: {
    name: "Chat Oripe",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "CO",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.oriper.com/v1/chat/completions",
    validateUrl: "https://api.oriper.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

