export default {
  id: "reka",
  priority: 120,
  alias: "reka",
  display: {
    name: "Reka",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "RE",
    website: "https://www.reka.ai",
    notice: {
      apiKeyUrl: "https://platform.reka.ai/",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.reka.ai/v1/chat/completions",
    validateUrl: "https://api.reka.ai/v1/models",
  },
  models: [
    {
      id: "reka-flash-3",
      name: "Reka Flash 3",
      supportsReasoning: true,
      alwaysReasons: true,
      maxOutputTokens: 8192,
    },
    { id: "reka-flash", name: "Reka Flash" },
    { id: "reka-edge-2603", name: "Reka Edge 2603" },
  ],
};

