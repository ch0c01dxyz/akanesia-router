export default {
  id: "nube",
  priority: 50,
  alias: "nube",
  display: {
    name: "Nube",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "NU",
    website: "https://nube.sh",
    notice: {
      apiKeyUrl: "https://nube.sh/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://ai.nube.sh/api/v1/chat/completions",
    validateUrl: "https://ai.nube.sh/api/v1/models",
  },
  passthroughModels: true,
  models: [],
};

