export default {
  id: "yolo-auto",
  priority: 50,
  alias: "yolo-auto",
  display: {
    name: "Yolo Auto",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "YA",
    website: "https://yolo-auto.com",
    notice: {
      apiKeyUrl: "https://yolo-auto.com/app",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://yolo-auto.com/v1/chat/completions",
    validateUrl: "https://yolo-auto.com/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "qwen3.6-35b-a3b", name: "Qwen 3.6 35B A3B" },
  ],
};

