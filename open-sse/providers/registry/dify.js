export default {
  id: "dify",
  priority: 50,
  alias: "dify",
  display: {
    name: "Dify",
    icon: "smart_toy",
    color: "#C026D3",
    textIcon: "DI",
    website: "https://dify.ai",
    notice: {
      apiKeyUrl: "https://cloud.dify.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.dify.ai",
  },
  models: [
    { id: "auto", name: "Auto" },
  ],
};

