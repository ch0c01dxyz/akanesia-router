export default {
  id: "sealion",
  priority: 120,
  alias: "sealion",
  display: {
    name: "Sealion",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "SE",
    website: "https://sea-lion.ai",
    notice: {
      apiKeyUrl: "https://playground.sea-lion.ai/key-manager",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.sea-lion.ai/v1/chat/completions",
    validateUrl: "https://api.sea-lion.ai/v1/models",
  },
  models: [
    {
      id: "aisingapore/Llama-SEA-LION-v3.5-70B-R",
      name: "Llama SEA-LION v3.5 70B R",
      contextLength: 131072,
    },
    {
      id: "aisingapore/Llama-SEA-LION-v3-70B-IT",
      name: "Llama SEA-LION v3 70B IT",
      contextLength: 131072,
    },
    {
      id: "aisingapore/Gemma-SEA-LION-v4-27B-IT",
      name: "Gemma SEA-LION v4 27B IT",
      contextLength: 131072,
    },
    {
      id: "aisingapore/Qwen-SEA-LION-v4.5-27B-IT",
      name: "Qwen SEA-LION v4.5 27B IT",
      contextLength: 32768,
    },
    {
      id: "aisingapore/Qwen-SEA-LION-v4-32B-IT",
      name: "Qwen SEA-LION v4 32B IT",
      contextLength: 32768,
    },
  ],
};

