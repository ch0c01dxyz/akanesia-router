export default {
  id: "maritalk",
  priority: 50,
  alias: "maritalk",
  display: {
    name: "Maritalk",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "MA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://chat.maritaca.ai/api",
  },
  models: [
    { id: "sabia-4", name: "sabia-4" },
    { id: "sabia-4-thinking", name: "sabia-4-thinking" },
    { id: "sabiazinho-4", name: "sabiazinho-4" },
  ],
};

