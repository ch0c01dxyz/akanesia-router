export default {
  id: "baichuan",
  priority: 120,
  alias: "baichuan",
  display: {
    name: "Baichuan",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "BA",
    website: "https://www.baichuan-ai.com",
    notice: { apiKeyUrl: "https://www.baichuan-ai.com" },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.baichuan-ai.com/v1/chat/completions",
    validateUrl: "https://api.baichuan-ai.com/v1/models",
  },
  models: [
    {
      id: "Baichuan4-Turbo",
      name: "Baichuan 4 Turbo",
      contextLength: 32768,
    },
    {
      id: "Baichuan4-Air",
      name: "Baichuan 4 Air",
      contextLength: 32768,
    },
    { id: "Baichuan4", name: "Baichuan 4" },
    {
      id: "Baichuan3-Turbo",
      name: "Baichuan 3 Turbo",
      contextLength: 32768,
    },
    {
      id: "Baichuan3-Turbo-128k",
      name: "Baichuan 3 Turbo 128k",
      contextLength: 131072,
    },
  ],
};

