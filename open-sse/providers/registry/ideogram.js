export default {
  id: "ideogram",
  priority: 50,
  alias: "ideo",
  display: {
    name: "Ideogram",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "ID",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ideogram.ai",
  },
  models: [
    { id: "V_3", name: "Ideogram V3" },
    { id: "V_2A", name: "Ideogram V2A" },
  ],
};

