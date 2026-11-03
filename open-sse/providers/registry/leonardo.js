export default {
  id: "leonardo",
  priority: 50,
  alias: "leo",
  display: {
    name: "Leonardo",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "LE",
    website: "https://leonardo.ai",
    notice: {
      apiKeyUrl: "https://app.leonardo.ai/api-access",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://cloud.leonardo.ai/api/rest/v1",
  },
  models: [
    { id: "phoenix", name: "Phoenix", kind: "image" },
    { id: "sdxl", name: "SDXL", kind: "image" },
  ],
  serviceKinds: ["image"],
};

