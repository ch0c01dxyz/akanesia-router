export default {
  id: "dxnt",
  priority: 50,
  alias: "dxnt",
  display: {
    name: "Dxnt",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "DX",
    website: "https://www.dxnt.com",
    notice: { apiKeyUrl: "https://www.dxnt.com" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://www.dxnt.com/v1/chat/completions",
    validateUrl: "https://www.dxnt.com/v1/models",
  },
  passthroughModels: true,
  models: [],
};

