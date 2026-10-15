export default {
  id: "mmf",
  hidden: true,
  priority: 200,
  display: {
    name: "MMF",
    icon: "hub",
    color: "#6366F1",
    textIcon: "MF",
    website: "https://mimo.xiaomi.com",
    notice: {
      apiKeyUrl: "https://platform.xiaomimimo.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  models: [
    { id: "mimo-auto", name: "MiMo Auto" },
  ],
};
