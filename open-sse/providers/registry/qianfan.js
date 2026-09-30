export default {
  id: "qianfan",
  priority: 50,
  alias: "qianfan",
  display: {
    name: "Qianfan",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "QI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://qianfan.baidubce.com/v2/chat/completions",
    validateUrl: "https://qianfan.baidubce.com/v2/models",
  },
  models: [
    { id: "ernie-5.1", name: "ERNIE 5.1" },
    { id: "ernie-5.0-thinking-latest", name: "ERNIE 5.0 Thinking Latest" },
    {
      id: "ernie-x1.1",
      name: "ERNIE X1.1",
      contextLength: 64000,
    },
  ],
};

