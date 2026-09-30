export default {
  id: "yi",
  priority: 50,
  alias: "yi",
  display: {
    name: "Yi",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "YI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.lingyiwanwu.com/v1/chat/completions",
    validateUrl: "https://api.lingyiwanwu.com/v1/models",
  },
  models: [
    { id: "yi-large", name: "Yi Large" },
  ],
};

