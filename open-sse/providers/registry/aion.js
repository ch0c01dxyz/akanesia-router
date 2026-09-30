export default {
  id: "aion",
  priority: 120,
  alias: "aion",
  display: {
    name: "Aion",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "AI",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.aionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.aionlabs.ai/v1/models",
  },
  passthroughModels: true,
  models: [
    {
      id: "aion-labs/aion-3.0",
      name: "Aion 3.0",
      contextLength: 131072,
    },
    {
      id: "aion-labs/aion-3.0-mini",
      name: "Aion 3.0 Mini",
      contextLength: 131072,
    },
    {
      id: "aion-labs/aion-2.5",
      name: "Aion 2.5",
      contextLength: 131072,
    },
    {
      id: "aion-labs/aion-2.0",
      name: "Aion 2.0",
      contextLength: 131072,
    },
    {
      id: "aion-labs/aion-rp-llama-3.1-8b",
      name: "Aion RP Llama 3.1 8B",
      contextLength: 32768,
    },
  ],
};

