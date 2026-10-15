export default {
  id: "cloudcode-one",
  priority: 50,
  alias: "cloudcode-one",
  display: {
    name: "Cloudcode One",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "CO",
    website: "https://cloudcode.one",
    notice: {
      apiKeyUrl: "https://cloudcode.one",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.cloudcode.one/v1/chat/completions",
    validateUrl: "https://api.cloudcode.one/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "glm-4.6v-flash", name: "GLM 4.6V Flash" },
  ],
};

