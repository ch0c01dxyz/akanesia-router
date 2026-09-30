export default {
  id: "udio",
  priority: 50,
  alias: "udio",
  display: {
    name: "Udio",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "UD",
  },
  category: "apikey",
  authType: "cookie",
  transport: {
    baseUrl: "https://www.udio.com/api/generate-proxy",
  },
  models: [
    { id: "udio-default", name: "Udio Default" },
  ],
};

