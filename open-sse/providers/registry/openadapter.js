export default {
  id: "openadapter",
  priority: 50,
  alias: "oad",
  display: {
    name: "Openadapter",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "OP",
    website: "https://dashboard.openadapter.in",
    notice: {
      apiKeyUrl: "https://dashboard.openadapter.in/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.openadapter.in/v1/chat/completions",
    validateUrl: "https://api.openadapter.in/v1/models",
  },
  models: [
    {
      id: "glm-4.7",
      name: "GLM 4.7 (OpenAdapter)",
      contextLength: 128000,
      toolCalling: true,
    },
  ],
};

