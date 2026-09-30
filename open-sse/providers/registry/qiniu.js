export default {
  id: "qiniu",
  priority: 50,
  alias: "qiniu",
  display: {
    name: "Qiniu",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "QI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.qnaigc.com/v1/chat/completions",
    validateUrl: "https://api.qnaigc.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

