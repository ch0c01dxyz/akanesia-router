export default {
  id: "seekai",
  priority: 50,
  alias: "ska",
  display: {
    name: "Seekai",
    icon: "smart_toy",
    color: "#C026D3",
    textIcon: "SE",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://seekai.cc/v1/chat/completions",
    validateUrl: "https://seekai.cc/v1/models",
  },
  passthroughModels: true,
  models: [],
};

