export default {
  id: "monsterapi",
  priority: 120,
  alias: "monster",
  display: {
    name: "Monsterapi",
    icon: "smart_toy",
    color: "#C026D3",
    textIcon: "MO",
    website: "https://monsterapi.ai",
    notice: {
      apiKeyUrl: "https://monsterapi.ai/user/dashboard",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.monsterapi.ai/v1/chat/completions",
    validateUrl: "https://api.monsterapi.ai/v1/models",
  },
  models: [
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
  ],
};

