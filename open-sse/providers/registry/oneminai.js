export default {
  id: "oneminai",
  priority: 50,
  alias: "1min",
  display: {
    name: "Oneminai",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "ON",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.1min.ai/api/chat-with-ai",
  },
  passthroughModels: true,
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  ],
};

