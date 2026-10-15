export default {
  id: "sparkdesk",
  priority: 120,
  alias: "sparkdesk",
  display: {
    name: "Sparkdesk",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "SP",
    website: "https://www.xfyun.cn",
    notice: {
      apiKeyUrl: "https://console.xfyun.cn/",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://spark-api-open.xf-yun.com/v1/chat/completions",
    validateUrl: "https://spark-api-open.xf-yun.com/v1/models",
  },
  models: [
    {
      id: "4.0Ultra",
      name: "Spark 4.0 Ultra",
      contextLength: 32768,
    },
    {
      id: "generalv3",
      name: "Spark Pro",
      contextLength: 8192,
    },
    {
      id: "pro-128k",
      name: "Spark Pro 128K",
      contextLength: 131072,
    },
    {
      id: "lite",
      name: "Spark Lite",
      contextLength: 4096,
    },
  ],
};

