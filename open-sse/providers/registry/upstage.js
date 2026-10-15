export default {
  id: "upstage",
  priority: 50,
  alias: "upstage",
  display: {
    name: "Upstage",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "UP",
    website: "https://www.upstage.ai",
    notice: {
      apiKeyUrl: "https://console.upstage.ai/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.upstage.ai/v1/chat/completions",
    validateUrl: "https://api.upstage.ai/v1/models",
  },
  models: [
    { id: "solar-pro3", name: "solar-pro3" },
    { id: "solar-mini", name: "solar-mini" },
  ],
};

