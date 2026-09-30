export default {
  id: "ant-ling",
  priority: 50,
  alias: "ling",
  display: {
    name: "Ant Ling",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "AL",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ant-ling.com/v1/chat/completions",
    validateUrl: "https://api.ant-ling.com/v1/models",
  },
  models: [
    { id: "Ling-2.6-1T", name: "Ling 2.6 1T" },
    { id: "Ring-2.6-1T", name: "Ring 2.6 1T" },
    { id: "Ling-2.6-flash", name: "Ling 2.6 Flash" },
  ],
};

