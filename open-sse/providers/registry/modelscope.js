export default {
  id: "modelscope",
  priority: 120,
  alias: "ms",
  display: {
    name: "Modelscope",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "MO",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.cn/v1/models",
  },
  passthroughModels: true,
  models: [],
};

