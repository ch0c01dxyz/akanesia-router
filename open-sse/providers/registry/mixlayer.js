export default {
  id: "mixlayer",
  priority: 50,
  alias: "mixlayer",
  display: {
    name: "Mixlayer",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "MI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://models.mixlayer.ai/v1/chat/completions",
    validateUrl: "https://models.mixlayer.ai/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "qwen/qwen3.5-4b-free", name: "Qwen 3.5 4B (free)" },
  ],
};

