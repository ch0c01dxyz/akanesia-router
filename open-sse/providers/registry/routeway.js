export default {
  id: "routeway",
  priority: 120,
  alias: "routeway",
  display: {
    name: "Routeway",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "RO",
    website: "https://routeway.ai",
    notice: {
      apiKeyUrl: "https://routeway.ai/dashboard/keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.routeway.ai/v1/chat/completions",
    validateUrl: "https://api.routeway.ai/v1/models",
    headers: {
      "User-Agent": "Mozilla/5.0 OmniRoute/1.0",
    },
  },
  passthroughModels: true,
  models: [
    {
      id: "llama-3.3-70b-instruct:free",
      name: "Llama 3.3 70B Instruct (free)",
      contextLength: 131072,
      toolCalling: true,
    },
    {
      id: "nemotron-3-nano-30b-a3b:free",
      name: "Nemotron 3 Nano 30B (free)",
      contextLength: 256000,
      toolCalling: true,
    },
    {
      id: "nemotron-nano-9b-v2:free",
      name: "Nemotron Nano 9B v2 (free)",
      contextLength: 128000,
      toolCalling: true,
    },
    {
      id: "step-3.7-flash:free",
      name: "Step 3.7 Flash (free)",
      contextLength: 256000,
      toolCalling: true,
      supportsVision: true,
    },
    {
      id: "step-3.5-flash:free",
      name: "Step 3.5 Flash (free)",
      contextLength: 65536,
      toolCalling: true,
    },
    {
      id: "laguna-m.1:free",
      name: "Laguna M.1 (free)",
      contextLength: 131072,
      toolCalling: true,
    },
    {
      id: "laguna-xs.2:free",
      name: "Laguna XS.2 (free)",
      contextLength: 131072,
      toolCalling: true,
    },
    {
      id: "llama-3.2-3b-instruct:free",
      name: "Llama 3.2 3B Instruct (free)",
      contextLength: 16000,
      toolCalling: true,
    },
  ],
};

