export default {
  id: "regolo",
  priority: 50,
  alias: "regolo",
  display: {
    name: "Regolo",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "RE",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.regolo.ai",
  },
  passthroughModels: true,
  models: [
    { id: "regolo-chat", name: "Regolo Chat" },
    { id: "regolo-fast", name: "Regolo Fast" },
  ],
};

