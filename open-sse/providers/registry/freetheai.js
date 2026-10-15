export default {
  id: "freetheai",
  priority: 50,
  alias: "fta",
  display: {
    name: "Freetheai",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "FR",
    website: "https://freetheai.xyz",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.freetheai.xyz/v1/chat/completions",
    validateUrl: "https://api.freetheai.xyz/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "deepseek-chat", name: "DeepSeek Chat" },
  ],
};

