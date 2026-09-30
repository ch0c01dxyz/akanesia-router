export default {
  id: "hcnsec",
  priority: 50,
  alias: "hcnsec",
  display: {
    name: "Hcnsec",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "HC",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
    validateUrl: "https://api.hcnsec.cn/v1/models",
  },
  passthroughModels: true,
  models: [],
};

