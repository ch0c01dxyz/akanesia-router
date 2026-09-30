export default {
  id: "haiper",
  priority: 50,
  alias: "hp",
  display: {
    name: "Haiper",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "HA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.haiper.ai/v1",
  },
  models: [
    { id: "gen2", name: "Gen 2 Video" },
    { id: "gen2-image", name: "Gen 2 Image" },
  ],
};

