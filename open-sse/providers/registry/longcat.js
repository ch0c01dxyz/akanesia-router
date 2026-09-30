export default {
  id: "longcat",
  priority: 120,
  alias: "lc",
  display: {
    name: "Longcat",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "LO",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.longcat.chat/openai/v1/chat/completions",
    validateUrl: "https://api.longcat.chat/openai/v1/models",
  },
  models: [
    {
      id: "LongCat-2.0",
      name: "LongCat 2.0 (10M tok free 🆓)",
      contextLength: 1048576,
    },
  ],
};

