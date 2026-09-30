export default {
  id: "galadriel",
  priority: 50,
  alias: "galadriel",
  display: {
    name: "Galadriel",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "GA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.galadriel.ai/v1/chat/completions",
    validateUrl: "https://api.galadriel.ai/v1/models",
  },
  models: [
    { id: "galadriel-latest", name: "galadriel-latest" },
  ],
};

