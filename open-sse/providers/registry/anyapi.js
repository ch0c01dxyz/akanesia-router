export default {
  id: "anyapi",
  priority: 50,
  alias: "anyapi",
  display: {
    name: "Anyapi",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "AN",
    website: "https://anyapi.ai",
    notice: { apiKeyUrl: "https://dash.anyapi.ai/" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.anyapi.ai/v1/chat/completions",
    validateUrl: "https://api.anyapi.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
};

